import { useState, useEffect, useRef } from 'react'
import { Search as SearchIcon, Plus, Pencil, Trash2, User, X, Folder, ArrowLeft, ChevronRight, Recycle, RotateCcw } from 'lucide-react'
import { cn } from '@/utils/cn'
import { formatDate, formatStudentYear } from '@/utils/format'
import PageHeader from '@/components/ui/PageHeader'
import Pagination from '@/components/ui/Pagination'
import SortHeader from '@/components/ui/SortHeader'
import { useToast } from '@/components/ui/Toast'
import EmptyState from '@/components/ui/EmptyState'
import DocumentViewerModal from '@/components/DocumentViewerModal'
import ConfirmDialog from '@/components/ConfirmDialog'
import type { PageProps, Student, ArchiveDocument } from '@/types'
import { PAGINATION } from '@/constants/pagination'
import { getErrorMessage } from '@/utils/error'

// Canonical program levels (H6). Merged with any legacy values already stored
// so the filter dropdown never hides an existing record's level.
const PROGRAM_LEVELS = ['College', 'Graduate School', 'Medicine', 'Law']

function Students({ user }: PageProps) {
  const [students, setStudents] = useState<Student[]>([])
  const [searchTerm, setSearchTerm] = useState('')
  const [isLoading, setIsLoading] = useState(false)

  // Server-side pagination + sorting for the student directory
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [sortBy, setSortBy] = useState('last_name')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const { showError } = useToast()

  // H1: live typeahead suggestions (mirrors the Search Documents experience)
  const [showAutocomplete, setShowAutocomplete] = useState(false)
  const [autocompleteResults, setAutocompleteResults] = useState<Student[]>([])
  const autocompleteRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  // H6: advanced filters beside the search bar
  const [schoolYearFilter, setSchoolYearFilter] = useState('')
  const [programLevelFilter, setProgramLevelFilter] = useState('')
  const [filterOptions, setFilterOptions] = useState<{ schoolYears: string[]; programLevels: string[] }>({ schoolYears: [], programLevels: [] })

  // H3: recycle bin for soft-deleted students
  const [showRecycleBin, setShowRecycleBin] = useState(false)
  const [deletedStudents, setDeletedStudents] = useState<Student[]>([])
  const [isLoadingDeleted, setIsLoadingDeleted] = useState(false)
  const [deletedPage, setDeletedPage] = useState(1)
  const [deletedTotal, setDeletedTotal] = useState(0)

  const [showModal, setShowModal] = useState(false)
  const [editingStudent, setEditingStudent] = useState<Student | null>(null)
  const [message, setMessage] = useState({ type: '', text: '' })
  const [isSaving, setIsSaving] = useState(false)
  // Set when the server flags a possible duplicate; the next submit bypasses
  // that check only if the user confirms "Add anyway?"
  const [pendingForce, setPendingForce] = useState(false)

  // In-app student directory browser
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null)
  const [studentDocs, setStudentDocs] = useState<ArchiveDocument[]>([])
  const [isLoadingDocs, setIsLoadingDocs] = useState(false)
  const [openTypeFolder, setOpenTypeFolder] = useState<string | null>(null)

  // Dedicated document-viewing interface (separate from the directory view)
  const [viewingDoc, setViewingDoc] = useState<ArchiveDocument | null>(null)
  // Pending destructive action awaiting in-app confirmation
  const [confirmDialog, setConfirmDialog] = useState<{ title: string; message: string; confirmLabel: string; action: () => void } | null>(null)
  // Form state
  const [formData, setFormData] = useState({
    student_id: '',
    first_name: '',
    last_name: '',
    middle_name: '',
    school_year: '',
    program_level: ''
  })

  const updateField = (field: keyof typeof formData, value: string) => {
    // Editing the form re-arms the duplicate check
    setPendingForce(false)
    setFormData({ ...formData, [field]: value })
  }

  useEffect(() => {
    loadStudents()
    loadFilterOptions()

    const handleClickOutside = (event: MouseEvent) => {
      if (autocompleteRef.current && !autocompleteRef.current.contains(event.target as Node) &&
          searchInputRef.current && !searchInputRef.current.contains(event.target as Node)) {
        setShowAutocomplete(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // H1: debounced typeahead — suggest matching students from 2 characters
  useEffect(() => {
    if (searchTerm.trim().length < 2) {
      setShowAutocomplete(false)
      setAutocompleteResults([])
      return
    }
    const timeoutId = setTimeout(async () => {
      const result = await window.electronAPI.searchStudents(searchTerm, { limit: 6 })
      if (result.success) {
        setAutocompleteResults(result.students)
        setShowAutocomplete(result.students.length > 0)
      }
    }, 300)
    return () => clearTimeout(timeoutId)
  }, [searchTerm])

  const loadFilterOptions = async () => {
    const result = await window.electronAPI.getStudentFilterOptions()
    if (result.success) {
      setFilterOptions({ schoolYears: result.schoolYears, programLevels: result.programLevels })
    }
  }

  const fetchStudents = async (opts?: { page?: number; sortBy?: string; sortDir?: 'asc' | 'desc'; term?: string; schoolYear?: string; programLevel?: string }) => {
    const p = opts?.page ?? page
    const sb = opts?.sortBy ?? sortBy
    const sd = opts?.sortDir ?? sortDir
    const term = opts?.term !== undefined ? opts.term : searchTerm
    const sy = opts?.schoolYear !== undefined ? opts.schoolYear : schoolYearFilter
    const pl = opts?.programLevel !== undefined ? opts.programLevel : programLevelFilter

    setIsLoading(true)
    const pageOpts: { limit: number; offset: number; sortBy: string; sortDir: 'asc' | 'desc'; schoolYear?: string; programLevel?: string } = {
      limit: PAGINATION.STUDENT_PAGE_SIZE,
      offset: (p - 1) * PAGINATION.STUDENT_PAGE_SIZE,
      sortBy: sb,
      sortDir: sd
    }
    if (sy) pageOpts.schoolYear = sy
    if (pl) pageOpts.programLevel = pl
    const result = term.trim()
      ? await window.electronAPI.searchStudents(term, pageOpts)
      : await window.electronAPI.getAllStudents(pageOpts)
    if (result.success) {
      setStudents(result.students)
      setTotal(result.total ?? result.students.length)
      setPage(p)
      setSortBy(sb)
      setSortDir(sd)
    }
    setIsLoading(false)
  }

  // Refresh the current page (used after create/update/delete).
  const loadStudents = async () => {
    await fetchStudents()
  }

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault()
    await fetchStudents({ page: 1 })
  }

  const handleSort = (column: string) => {
    if (column === sortBy) {
      fetchStudents({ page: 1, sortBy, sortDir: sortDir === 'asc' ? 'desc' : 'asc' })
    } else {
      fetchStudents({ page: 1, sortBy: column, sortDir: 'asc' })
    }
  }

  // H6: filter dropdown handlers — apply immediately and restart at page 1
  const handleSchoolYearFilter = (value: string) => {
    setSchoolYearFilter(value)
    fetchStudents({ page: 1, schoolYear: value })
  }

  const handleProgramLevelFilter = (value: string) => {
    setProgramLevelFilter(value)
    fetchStudents({ page: 1, programLevel: value })
  }

  const clearFilters = () => {
    setSearchTerm('')
    setSchoolYearFilter('')
    setProgramLevelFilter('')
    fetchStudents({ page: 1, term: '', schoolYear: '', programLevel: '' })
  }

  // H1: choosing a suggestion fills the bar and runs the search
  const selectAutocomplete = (student: Student) => {
    const term = `${student.first_name} ${student.last_name}`
    setSearchTerm(term)
    setShowAutocomplete(false)
    fetchStudents({ page: 1, term })
  }

  // H3: recycle bin — load, restore, and permanently delete soft-deleted students
  const loadDeletedStudents = async (p = deletedPage) => {
    setIsLoadingDeleted(true)
    const result = await window.electronAPI.getDeletedStudents(user.id, {
      limit: PAGINATION.STUDENT_PAGE_SIZE,
      offset: (p - 1) * PAGINATION.STUDENT_PAGE_SIZE
    })
    if (result.success) {
      const total = result.total ?? result.students.length
      if (result.students.length === 0 && p > 1 && total > 0) {
        setIsLoadingDeleted(false)
        await loadDeletedStudents(p - 1)
        return
      }
      setDeletedStudents(result.students)
      setDeletedTotal(total)
      setDeletedPage(p)
    } else {
      showError(result.error || 'Failed to load the recycle bin')
    }
    setIsLoadingDeleted(false)
  }

  const openRecycleBin = () => {
    setSelectedStudent(null)
    setShowRecycleBin(true)
    loadDeletedStudents(1)
  }

  const closeRecycleBin = () => {
    setShowRecycleBin(false)
    setDeletedStudents([])
    setDeletedPage(1)
    setDeletedTotal(0)
  }

  const handleRestore = async (student: Student) => {
    const result = await window.electronAPI.restoreStudent(student.id, user.id)
    if (result.success) {
      await loadDeletedStudents()
      loadStudents()
      await window.electronAPI.addLog({
        userId: user.id,
        action: 'student_restored',
        targetType: 'student',
        targetId: student.id,
        details: `${student.first_name} ${student.last_name}`
      })
    } else {
      showError(result.error || 'Failed to restore student')
    }
  }

  const handlePurge = (student: Student) => {
    setConfirmDialog({
      title: 'Delete Permanently',
      message: `Permanently delete ${student.first_name} ${student.last_name}?\n\nThis cannot be undone.`,
      confirmLabel: 'Delete Forever',
      action: () => executePurgeStudent(student)
    })
  }

  const executePurgeStudent = async (student: Student) => {
    const result = await window.electronAPI.purgeStudent(student.id, user.id)
    if (result.success) {
      await loadDeletedStudents()
      await window.electronAPI.addLog({
        userId: user.id,
        action: 'student_purged',
        targetType: 'student',
        targetId: student.id,
        details: `${student.first_name} ${student.last_name}`
      })
    } else {
      showError(result.error || 'Failed to delete student permanently')
    }
  }

  const openAddModal = () => {
    setEditingStudent(null)
    setFormData({ student_id: '', first_name: '', last_name: '', middle_name: '', school_year: '', program_level: '' })
    setShowModal(true)
    setMessage({ type: '', text: '' })
  }

  const openEditModal = (student: Student) => {
    setEditingStudent(student)
    setFormData({
      student_id: student.student_id || '',
      first_name: student.first_name,
      last_name: student.last_name,
      middle_name: student.middle_name || '',
      school_year: student.school_year || '',
      program_level: student.program_level || ''
    })
    setShowModal(true)
    setMessage({ type: '', text: '' })
  }

  const closeModal = () => {
    setShowModal(false)
    setEditingStudent(null)
    setFormData({ student_id: '', first_name: '', last_name: '', middle_name: '', school_year: '', program_level: '' })
    setMessage({ type: '', text: '' })
    setPendingForce(false)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (isSaving) return
    setMessage({ type: '', text: '' })

    // Validation — student_id is optional; school year and program level are required
    if (!formData.first_name.trim() || !formData.last_name.trim()) {
      setMessage({ type: 'error', text: 'First Name and Last Name are required' })
      return
    }
    if (!formData.school_year.trim()) {
      setMessage({ type: 'error', text: 'School Year is required (e.g., 1996-1997)' })
      return
    }
    if (!formData.program_level) {
      setMessage({ type: 'error', text: 'Program Level is required' })
      return
    }

    setIsSaving(true)
    try {
      const payload = pendingForce ? { ...formData, force: true } : formData
      let result
      let logTargetId = editingStudent?.id
      if (editingStudent) {
        result = await window.electronAPI.updateStudent(editingStudent.id, payload, user.id)
      } else {
        result = await window.electronAPI.createStudent(payload, user.id)
        logTargetId = result.id
      }

      if (result.success) {
        const successText = editingStudent ? 'Student updated successfully!' : 'Student added successfully!'
        closeModal()
        loadStudents()
        setMessage({ type: 'success', text: successText })

        // Log activity
        await window.electronAPI.addLog({
          userId: user.id,
          action: editingStudent ? 'student_updated' : 'student_created',
          targetType: 'student',
          targetId: logTargetId,
          details: `${formData.first_name} ${formData.last_name}`
        })
      } else if ('possibleDuplicate' in result && result.possibleDuplicate) {
        setPendingForce(true)
        setMessage({ type: 'error', text: result.error || 'A possible duplicate exists.' })
      } else {
        setPendingForce(false)
        console.error('Student save failed:', result.error)
        showError(result.error || 'Failed to save student')
      }
    } catch (error) {
      console.error('Student save threw:', error)
      showError('An error occurred while saving the student.')
    } finally {
      setIsSaving(false)
    }
  }

  const handleDelete = (student: Student) => {
    setConfirmDialog({
      title: 'Delete Student',
      message: `Move ${student.first_name} ${student.last_name} to the Recycle Bin?\n\nYou can restore this record later from the Recycle Bin.`,
      confirmLabel: 'Delete',
      action: () => executeDeleteStudent(student)
    })
  }

  const executeDeleteStudent = async (student: Student) => {
    const result = await window.electronAPI.deleteStudent(student.id, user.id)
    if (result.success) {
      setMessage({ type: 'success', text: 'Student moved to the Recycle Bin' })
      loadStudents()

      // Log activity
      await window.electronAPI.addLog({
        userId: user.id,
        action: 'student_deleted',
        targetType: 'student',
        targetId: student.id,
        details: `${student.first_name} ${student.last_name}`
      })

      setTimeout(() => setMessage({ type: '', text: '' }), 3000)
    } else {
      showError(result.error || 'Failed to delete student')
    }
  }

  const openStudentFolder = async (student: Student) => {
    setSelectedStudent(student)
    setOpenTypeFolder(null)
    setViewingDoc(null)
    setIsLoadingDocs(true)
    const result = await window.electronAPI.searchDocuments({ studentId: student.id })
    if (result.success) {
      setStudentDocs(result.documents)
    } else {
      showError(result.error || 'Failed to load documents')
      setStudentDocs([])
    }
    setIsLoadingDocs(false)
  }

  const backToStudentList = () => {
    setSelectedStudent(null)
    setStudentDocs([])
    setOpenTypeFolder(null)
    setViewingDoc(null)
  }

  // Group documents by type: single-document types render as plain document
  // rows; types with multiple documents render as a document-type directory.
  const docsByType = new Map<string, ArchiveDocument[]>()
  for (const doc of studentDocs) {
    const list = docsByType.get(doc.document_type) || []
    list.push(doc)
    docsByType.set(doc.document_type, list)
  }
  const sortedTypes = Array.from(docsByType.keys()).sort((a, b) => a.localeCompare(b))
  const folderDocs = openTypeFolder ? docsByType.get(openTypeFolder) || [] : []

  // Documents are archived one-per-document-type-folder, so a row click opens
  // the dedicated viewer instead of expanding an inline preview here
  const openDocumentViewer = (doc: ArchiveDocument) => {
    setViewingDoc(doc)
  }

  const closeDocumentViewer = () => {
    setViewingDoc(null)
  }

  const showInFolder = async (filePath: string) => {
    try {
      const result = await window.electronAPI.showFileInFolder(filePath)
      if (!result.success) {
        showError(`Failed to show folder: ${result.error}`)
      }
    } catch (error) {
      showError(`Failed to show folder: ${getErrorMessage(error)}`)
    }
  }

  const handleDeleteDoc = (doc: ArchiveDocument) => {
    setConfirmDialog({
      title: 'Delete Document',
      message: `Delete this document?\n\nFile: ${doc.file_name}\n\nThis cannot be undone.`,
      confirmLabel: 'Delete',
      action: () => executeDeleteDoc(doc)
    })
  }

  const executeDeleteDoc = async (doc: ArchiveDocument) => {
    const result = await window.electronAPI.deleteDocument(doc.id, user.id)
    if (result.success) {
      closeDocumentViewer()
      if (selectedStudent) openStudentFolder(selectedStudent)
    } else {
      showError(result.error || 'Failed to delete document')
    }
  }

  const renderDocRow = (doc: ArchiveDocument) => (
    <div 
      key={doc.id} 
      onClick={() => openDocumentViewer(doc)}
      className="px-5 py-4 hover:bg-[#fbfcfd] transition cursor-pointer"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-[#dceafb] text-[#24558d]">
            {doc.document_type}
          </span>
          <div className="mono mt-1.5 text-xs font-semibold text-[#263950] truncate">
            {doc.file_name}
          </div>
          <div className="mt-1 text-[10px] text-[#8a95a5]">
            {formatDate(doc.created_at)}
          </div>
        </div>

        {user.role === 'admin' && (
          <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => showInFolder(doc.file_path)}
              className="rounded p-1.5 text-[#617084] hover:bg-[#f4f6f8] transition"
              title="Show in folder"
            >
              <Folder size={16} />
            </button>
            <button
              onClick={() => handleDeleteDoc(doc)}
              className="rounded p-1.5 text-[#b94843] hover:bg-[#fff0ef] transition"
              title="Delete document"
            >
              <Trash2 size={16} />
            </button>
          </div>
        )}
      </div>
    </div>
  )

  return (
    <div className="mx-auto max-w-[1420px] p-5 sm:p-7">
      <PageHeader
        eyebrow="Student Management"
        title="Student Records"
        description="Manage student information for the archive system."
        actions={
          user.role === 'admin' ? (
            <>
              <button
                onClick={openRecycleBin}
                className="inline-flex items-center justify-center gap-2 rounded-md px-3.5 py-2 text-xs font-bold transition focus-ring border border-[#d7dde5] bg-white text-[#34445a] hover:bg-[#f4f6f8]"
              >
                <Recycle size={14} />
                Recycle Bin
              </button>
              <button
                onClick={openAddModal}
                className="inline-flex items-center justify-center gap-2 rounded-md px-3.5 py-2 text-xs font-bold transition focus-ring bg-[#24558d] text-white hover:bg-[#1d4778]"
              >
                <Plus size={14} />
                Add Student
              </button>
            </>
          ) : undefined
        }
      />

      {/* Message Alert */}
      {message.text && (
        <div className={cn(
          'mb-5 rounded-md px-4 py-3 text-xs',
          message.type === 'success' && 'bg-[#e5f5ee] text-[#2b9b72]',
          message.type === 'error' && 'bg-[#fff0ef] text-[#b94843]'
        )}>
          {message.text}
        </div>
      )}

      {/* Student Directory Browser */}
      {selectedStudent ? (
        <section className="surface-card rounded-lg">
          <div className="flex items-center justify-between border-b border-[#e8ebef] px-5 py-4">
            <div className="flex items-center gap-3">
              <button
                onClick={backToStudentList}
                className="inline-flex items-center gap-1.5 rounded-md border border-[#d7dde5] bg-white px-2.5 py-1.5 text-xs font-bold text-[#34445a] transition hover:bg-[#f4f6f8]"
              >
                <ArrowLeft size={14} />
                Back to student list
              </button>
              <div>
                <h2 className="text-sm font-bold text-[#1c2f47]">
                  {selectedStudent.last_name}, {selectedStudent.first_name} {selectedStudent.middle_name || ''}
                </h2>
                <p className="mono mt-0.5 text-[11px] text-[#8a95a5]">
                  {formatStudentYear(selectedStudent)} — Documents
                </p>
              </div>
            </div>
          </div>

          {isLoadingDocs ? (
            <div className="flex items-center justify-center py-14">
              <div className="text-center">
                <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-[#24558d] border-r-transparent"></div>
                <p className="mt-3 text-sm text-[#8490a0]">Loading documents...</p>
              </div>
            </div>
          ) : openTypeFolder ? (
            <>
              {/* Document-type directory listing */}
              <div className="flex items-center gap-3 border-b border-[#e8ebef] px-5 py-3">
                <button
                  onClick={() => setOpenTypeFolder(null)}
                  className="inline-flex items-center gap-1.5 rounded-md border border-[#d7dde5] bg-white px-2.5 py-1.5 text-xs font-bold text-[#34445a] transition hover:bg-[#f4f6f8]"
                >
                  <ArrowLeft size={14} />
                  Back
                </button>
                <Folder size={16} className="text-[#315c87]" />
                <div className="text-xs font-bold text-[#1c2f47]">{openTypeFolder}</div>
                <div className="text-[10px] text-[#8a95a5]">
                  {folderDocs.length} document{folderDocs.length !== 1 ? 's' : ''}
                </div>
              </div>

              {folderDocs.length > 0 ? (
                <div className="divide-y divide-[#edf0f3]">
                  {folderDocs.map(renderDocRow)}
                </div>
              ) : (
                <EmptyState
                  icon={User}
                  title="No documents found"
                  body="This document folder is empty."
                />
              )}
            </>
          ) : studentDocs.length > 0 ? (
            <div className="divide-y divide-[#edf0f3]">
              {sortedTypes.map((typeName) => {
                const docs = docsByType.get(typeName)!
                if (docs.length === 1) {
                  // Single document of this type — show it directly
                  return renderDocRow(docs[0])
                }
                // Multiple documents of this type — show as a directory
                return (
                  <button
                    key={typeName}
                    type="button"
                    onClick={() => setOpenTypeFolder(typeName)}
                    className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left transition hover:bg-[#fbfcfd]"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-[#eaf0f7] text-[#315c87]">
                        <Folder size={18} />
                      </div>
                      <div className="min-w-0">
                        <div className="truncate text-xs font-bold text-[#263950]">
                          {typeName}
                        </div>
                        <div className="mt-0.5 text-[10px] text-[#8a95a5]">
                          {docs.length} documents — open to view all
                        </div>
                      </div>
                    </div>
                    <ChevronRight size={16} className="shrink-0 text-[#8a95a5]" />
                  </button>
                )
              })}
            </div>
          ) : (
            <EmptyState
              icon={User}
              title="No documents found"
              body="This student has no documents in the archive yet."
            />
          )}
        </section>
      ) : showRecycleBin ? (
        <section className="surface-card rounded-lg">
          <div className="flex items-center justify-between border-b border-[#e8ebef] px-5 py-4">
            <div className="flex items-center gap-3">
              <button
                onClick={closeRecycleBin}
                className="inline-flex items-center gap-1.5 rounded-md border border-[#d7dde5] bg-white px-2.5 py-1.5 text-xs font-bold text-[#34445a] transition hover:bg-[#f4f6f8]"
              >
                <ArrowLeft size={14} />
                Back to student list
              </button>
              <div>
                <h2 className="flex items-center gap-2 text-sm font-bold text-[#1c2f47]">
                  <Recycle size={16} className="text-[#315c87]" />
                  Recycle Bin
                </h2>
                <p className="mt-0.5 text-[11px] text-[#8a95a5]">
                  {deletedTotal} deleted student{deletedTotal !== 1 ? 's' : ''} — restore or delete permanently
                </p>
              </div>
            </div>
          </div>

          {isLoadingDeleted ? (
            <div className="flex items-center justify-center py-14">
              <div className="text-center">
                <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-[#24558d] border-r-transparent"></div>
                <p className="mt-3 text-sm text-[#8490a0]">Loading recycle bin...</p>
              </div>
            </div>
          ) : deletedStudents.length > 0 ? (
            <div className="divide-y divide-[#edf0f3]">
              {deletedStudents.map((student) => (
                <div key={student.id} className="flex items-center justify-between gap-4 px-5 py-3.5">
                  <div className="min-w-0">
                    <div className="truncate text-xs font-semibold text-[#263950]">
                      {student.last_name}, {student.first_name} {student.middle_name || ''}
                    </div>
                    <div className="mono mt-0.5 text-[10px] text-[#8a95a5]">
                      {formatStudentYear(student)}
                      {student.deleted_at ? ` — deleted ${formatDate(student.deleted_at)}` : ''}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      onClick={() => handleRestore(student)}
                      className="inline-flex items-center gap-1.5 rounded-md border border-[#cfe6da] bg-[#e5f5ee] px-2.5 py-1.5 text-[11px] font-bold text-[#22735a] transition hover:bg-[#d3eee2]"
                      title="Restore student"
                    >
                      <RotateCcw size={14} />
                      Restore
                    </button>
                    <button
                      onClick={() => handlePurge(student)}
                      className="rounded p-1.5 text-[#b94843] hover:bg-[#fff0ef] transition"
                      title="Delete permanently"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
              ))}
              {deletedTotal > PAGINATION.STUDENT_PAGE_SIZE && (
                <div className="border-t border-[#e8ebef] px-5 py-3">
                  <Pagination
                    page={deletedPage}
                    pageSize={PAGINATION.STUDENT_PAGE_SIZE}
                    total={deletedTotal}
                    onPageChange={(p) => loadDeletedStudents(p)}
                  />
                </div>
              )}
            </div>
          ) : (
            <EmptyState
              icon={Trash2}
              title="Recycle bin is empty"
              body="Deleted students will appear here and can be restored at any time."
            />
          )}
        </section>
      ) : (
      <>
      {/* Search Bar */}
      <div className="surface-card rounded-lg p-5 mb-5">
        <form onSubmit={handleSearch} className="flex flex-wrap items-start gap-2">
          <div className="relative min-w-[240px] flex-1">
            <SearchIcon size={15} className="absolute left-3 top-2.5 text-[#8a97a7]" />
            <input
              ref={searchInputRef}
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search by name, school year, or student ID..."
              className="h-9 w-full rounded-md border border-[#d9dfe7] bg-white pl-9 pr-3 text-xs outline-none focus:border-[#5688bd] focus:ring-2 focus:ring-[#dceafb]"
            />
            {showAutocomplete && autocompleteResults.length > 0 && (
              <div
                ref={autocompleteRef}
                className="absolute z-50 mt-1 w-full rounded-md border border-[#d9dfe7] bg-white shadow-lg"
              >
                {autocompleteResults.map(student => (
                  <button
                    key={student.id}
                    type="button"
                    onClick={() => selectAutocomplete(student)}
                    className="w-full border-b border-[#edf0f3] px-3 py-2 text-left last:border-0 hover:bg-[#f8fafc]"
                  >
                    <div className="text-xs font-bold text-[#263950]">
                      {student.first_name} {student.middle_name ? student.middle_name + ' ' : ''}{student.last_name}
                    </div>
                    <div className="mono mt-0.5 text-[10px] text-[#8995a4]">
                      {formatStudentYear(student)}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* H6: advanced filters */}
          <select
            value={schoolYearFilter}
            onChange={(e) => handleSchoolYearFilter(e.target.value)}
            className="h-9 rounded-md border border-[#d9dfe7] bg-white px-2 text-xs text-[#47576b] outline-none focus:border-[#5688bd] focus:ring-2 focus:ring-[#dceafb]"
          >
            <option value="">All School Years</option>
            {filterOptions.schoolYears.map(sy => (
              <option key={sy} value={sy}>{sy}</option>
            ))}
          </select>
          <select
            value={programLevelFilter}
            onChange={(e) => handleProgramLevelFilter(e.target.value)}
            className="h-9 rounded-md border border-[#d9dfe7] bg-white px-2 text-xs text-[#47576b] outline-none focus:border-[#5688bd] focus:ring-2 focus:ring-[#dceafb]"
          >
            <option value="">All Program Levels</option>
            {Array.from(new Set([...PROGRAM_LEVELS, ...filterOptions.programLevels])).map(pl => (
              <option key={pl} value={pl}>{pl}</option>
            ))}
          </select>

          <button
            type="submit"
            disabled={isLoading}
            className="inline-flex items-center justify-center gap-2 rounded-md px-3.5 py-2 text-xs font-bold transition focus-ring disabled:opacity-50 bg-[#24558d] text-white hover:bg-[#1d4778]"
          >
            <SearchIcon size={14} />
            {isLoading ? 'Searching...' : 'Search'}
          </button>
          {(searchTerm || schoolYearFilter || programLevelFilter) && (
            <button
              type="button"
              onClick={clearFilters}
              className="inline-flex items-center justify-center gap-2 rounded-md px-3.5 py-2 text-xs font-bold transition focus-ring border border-[#d7dde5] bg-white text-[#34445a] hover:bg-[#f4f6f8]"
            >
              Clear
            </button>
          )}
        </form>
      </div>

      {/* Students Table */}
      <section className="surface-card rounded-lg">
        <div className="flex items-center justify-between border-b border-[#e8ebef] px-5 py-4">
          <div>
            <h2 className="text-sm font-bold text-[#1c2f47]">All Students</h2>
            <p className="mt-0.5 text-[11px] text-[#8a95a5]">
              {total} student{total !== 1 ? 's' : ''} registered
            </p>
          </div>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-14">
            <div className="text-center">
              <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-[#24558d] border-r-transparent"></div>
              <p className="mt-3 text-sm text-[#8490a0]">Loading students...</p>
            </div>
          </div>
        ) : students.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead>
                <tr className="border-b border-[#e8ebef] bg-[#fafbfc] text-[10px] uppercase tracking-[.1em] text-[#8a96a5]">
                  <SortHeader label="Student" column="last_name" sort={{ sortBy, sortDir }} onSort={handleSort} className="px-5 py-3 font-bold" />
                  <SortHeader label="School Year" column="school_year" sort={{ sortBy, sortDir }} onSort={handleSort} className="px-4 py-3 font-bold" />
                  <SortHeader label="Program Level" column="program_level" sort={{ sortBy, sortDir }} onSort={handleSort} className="px-4 py-3 font-bold" />
                  <SortHeader label="Date Added" column="created_at" sort={{ sortBy, sortDir }} onSort={handleSort} className="px-4 py-3 font-bold" />
                  {user.role === 'admin' && (
                    <th className="px-5 py-3 font-bold text-right">Actions</th>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-[#edf0f3]">
                {students.map((student) => (
                  <tr
                    key={student.id}
                    onClick={() => openStudentFolder(student)}
                    className="group cursor-pointer hover:bg-[#fbfcfd]"
                  >
                    <td className="px-5 py-3.5">
                      <div className="text-xs font-semibold text-[#263950]">
                        {student.last_name}, {student.first_name} {student.middle_name || ''}
                      </div>
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="mono text-xs font-semibold text-[#263950]">
                        {student.school_year || '—'}
                      </div>
                    </td>
                    <td className="px-4 py-3.5 text-xs text-[#617084]">
                      {student.program_level || '—'}
                    </td>
                    <td className="px-4 py-3.5 text-xs text-[#718096]">
                      {formatDate(student.created_at)}
                    </td>
                    {user.role === 'admin' && (
                      <td className="px-5 py-3.5 text-right">
                        <div className="flex justify-end gap-1">
                          <button
                            onClick={(e) => { e.stopPropagation(); openEditModal(student) }}
                            className="rounded p-1.5 text-[#24558d] hover:bg-[#eef5fb] transition"
                            title="Edit student"
                          >
                            <Pencil size={16} />
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleDelete(student) }}
                            className="rounded p-1.5 text-[#b94843] hover:bg-[#fff0ef] transition"
                            title="Delete student"
                          >
                            <Trash2 size={16} />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            icon={User}
            title="No students found"
            body="Add students to the system or try a different search term."
          />
        )}

        {total > 0 && (
          <div className="border-t border-[#e8ebef] px-5 py-3">
            <Pagination
              page={page}
              pageSize={PAGINATION.STUDENT_PAGE_SIZE}
              total={total}
              onPageChange={(p) => fetchStudents({ page: p })}
            />
          </div>
        )}
      </section>

      </>
      )}

      {/* Add/Edit Modal */}
      {showModal && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center bg-[#0f1b2d]/45 p-4 backdrop-blur-[2px]"
          onClick={closeModal}
        >
          <div 
            className="slide-in max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-[#e7eaf0] px-6 py-4">
              <h2 className="text-base font-bold text-[#172a43]">
                {editingStudent ? 'Edit Student' : 'Add New Student'}
              </h2>
              <button 
                onClick={closeModal}
                className="rounded p-1 text-[#8a95a5] hover:bg-[#f1f4f7] hover:text-[#1f2e43]"
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              {message.text && (
                <div className={cn(
                  'rounded-md px-3 py-2 text-[11px]',
                  message.type === 'success' && 'bg-[#e5f5ee] text-[#2b9b72]',
                  message.type === 'error' && 'bg-[#fff0ef] text-[#b94843]'
                )}>
                  {message.text}
                  {pendingForce && (
                    <div className="mt-2 flex gap-2">
                      <button
                        type="submit"
                        disabled={isSaving}
                        className="rounded border border-[#b94843] px-2.5 py-1 text-[10px] font-bold text-[#b94843] hover:bg-[#b94843] hover:text-white transition disabled:opacity-50"
                      >
                        Add anyway?
                      </button>
                      <button
                        type="button"
                        onClick={closeModal}
                        className="rounded border border-[#d7dde5] bg-white px-2.5 py-1 text-[10px] font-bold text-[#34445a] hover:bg-[#f4f6f8] transition"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </div>
              )}

              <div>
                <label className="label-caps mb-1.5 block">
                  Student ID
                </label>
                <input
                  type="text"
                  value={formData.student_id}
                  onChange={(e) => updateField('student_id', e.target.value)}
                  placeholder="e.g., 2024-00001 (optional)"
                  className="h-10 w-full rounded-md border border-[#d9dfe7] bg-white px-3 text-sm text-[#1f2e43] placeholder:text-[#a4adba] outline-none transition focus:border-[#5688bd] focus:ring-2 focus:ring-[#dceafb]"
                />
              </div>

              <div>
                <label className="label-caps mb-1.5 block">
                  First Name <span className="text-[#b94843]">*</span>
                </label>
                <input
                  type="text"
                  value={formData.first_name}
                  onChange={(e) => updateField('first_name', e.target.value)}
                  required
                  placeholder="Juan"
                  className="h-10 w-full rounded-md border border-[#d9dfe7] bg-white px-3 text-sm text-[#1f2e43] placeholder:text-[#a4adba] outline-none transition focus:border-[#5688bd] focus:ring-2 focus:ring-[#dceafb]"
                />
              </div>

              <div>
                <label className="label-caps mb-1.5 block">
                  Last Name <span className="text-[#b94843]">*</span>
                </label>
                <input
                  type="text"
                  value={formData.last_name}
                  onChange={(e) => updateField('last_name', e.target.value)}
                  required
                  placeholder="Dela Cruz"
                  className="h-10 w-full rounded-md border border-[#d9dfe7] bg-white px-3 text-sm text-[#1f2e43] placeholder:text-[#a4adba] outline-none transition focus:border-[#5688bd] focus:ring-2 focus:ring-[#dceafb]"
                />
              </div>

              <div>
                <label className="label-caps mb-1.5 block">
                  Middle Name
                </label>
                <input
                  type="text"
                  value={formData.middle_name}
                  onChange={(e) => updateField('middle_name', e.target.value)}
                  placeholder="Santos (optional)"
                  className="h-10 w-full rounded-md border border-[#d9dfe7] bg-white px-3 text-sm text-[#1f2e43] placeholder:text-[#a4adba] outline-none transition focus:border-[#5688bd] focus:ring-2 focus:ring-[#dceafb]"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label-caps mb-1.5 block">
                    School Year <span className="text-[#b94843]">*</span>
                  </label>
                  <input
                    type="text"
                    value={formData.school_year}
                    onChange={(e) => updateField('school_year', e.target.value)}
                    required
                    placeholder="e.g., 1996-1997"
                    className="h-10 w-full rounded-md border border-[#d9dfe7] bg-white px-3 text-sm text-[#1f2e43] placeholder:text-[#a4adba] outline-none transition focus:border-[#5688bd] focus:ring-2 focus:ring-[#dceafb]"
                  />
                </div>
                <div>
                  <label className="label-caps mb-1.5 block">
                    Program Level <span className="text-[#b94843]">*</span>
                  </label>
                  <select
                    value={formData.program_level}
                    onChange={(e) => updateField('program_level', e.target.value)}
                    required
                    className="h-10 w-full rounded-md border border-[#d9dfe7] bg-white px-3 text-sm text-[#1f2e43] outline-none transition focus:border-[#5688bd] focus:ring-2 focus:ring-[#dceafb]"
                  >
                    <option value="">Select...</option>
                    <option value="College">College</option>
                    <option value="Graduate School">Graduate School</option>
                    <option value="Medicine">Medicine</option>
                    <option value="Law">Law</option>
                  </select>
                </div>
              </div>

              <div className="flex gap-2 pt-4">
                <button
                  type="button"
                  onClick={closeModal}
                  className="flex-1 inline-flex items-center justify-center gap-2 rounded-md px-3.5 py-2 text-xs font-bold transition focus-ring border border-[#d7dde5] bg-white text-[#34445a] hover:bg-[#f4f6f8]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="flex-1 inline-flex items-center justify-center gap-2 rounded-md px-3.5 py-2 text-xs font-bold transition focus-ring bg-[#24558d] text-white hover:bg-[#1d4778] disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSaving
                    ? 'Saving...'
                    : pendingForce
                      ? 'Confirm Add'
                      : editingStudent
                        ? 'Update Student'
                        : 'Add Student'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Dedicated document-viewing interface */}
      {viewingDoc && (
        <DocumentViewerModal
          doc={viewingDoc}
          siblings={docsByType.get(viewingDoc.document_type)}
          userId={user.id}
          userRole={user.role}
          onClose={closeDocumentViewer}
          onDelete={user.role === 'admin' ? handleDeleteDoc : undefined}
          onUpdate={selectedStudent ? () => openStudentFolder(selectedStudent) : undefined}
        />
      )}

      {confirmDialog && (
        <ConfirmDialog
          title={confirmDialog.title}
          message={confirmDialog.message}
          confirmLabel={confirmDialog.confirmLabel}
          danger
          onConfirm={() => {
            const action = confirmDialog.action
            setConfirmDialog(null)
            action()
          }}
          onCancel={() => setConfirmDialog(null)}
        />
      )}
    </div>
  )
}

export default Students
