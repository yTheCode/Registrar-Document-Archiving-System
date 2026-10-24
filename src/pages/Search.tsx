import { useState, useEffect, useRef } from 'react'
import { Search as SearchIcon, Trash2, Folder, ArrowUpDown, Recycle, RotateCcw } from 'lucide-react'
import { cn } from '@/utils/cn'
import { formatDate, formatStudentYear } from '@/utils/format'
import PageHeader from '@/components/ui/PageHeader'
import Pagination from '@/components/ui/Pagination'
import { useToast } from '@/components/ui/Toast'
import EmptyState from '@/components/ui/EmptyState'
import DocumentViewerModal from '@/components/DocumentViewerModal'
import ConfirmDialog from '@/components/ConfirmDialog'
import type {
  PageProps,
  ArchiveDocument,
  DocumentType,
  Student
} from '@/types'
import type { DocumentSearchFilters } from '@/types/electron'
import { PAGINATION } from '@/constants/pagination'
import { getErrorMessage } from '@/utils/error'

const SORT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'created_at', label: 'Date Added' },
  { value: 'file_name', label: 'File Name' },
  { value: 'document_type', label: 'Document Type' },
  { value: 'student', label: 'Student' }
]

function Search({ user }: PageProps) {
  const [searchTerm, setSearchTerm] = useState('')
  const [documentTypeFilter, setDocumentTypeFilter] = useState('')
  const [yearFilter, setYearFilter] = useState('')

  const [documents, setDocuments] = useState<ArchiveDocument[]>([])
  const [documentTypes, setDocumentTypes] = useState<DocumentType[]>([])
  const [viewingDoc, setViewingDoc] = useState<ArchiveDocument | null>(null)
  // Pending destructive action awaiting in-app confirmation
  const [confirmDialog, setConfirmDialog] = useState<{ title: string; message: string; confirmLabel: string; action: () => void } | null>(null)
  
  const [isLoading, setIsLoading] = useState(false)
  const [hasSearched, setHasSearched] = useState(false)
  const [message, setMessage] = useState({ type: '', text: '' })
  const { showError } = useToast()

  // Server-side pagination + sorting
  const [page, setPage] = useState(1)
  const [total, setTotal] = useState(0)
  const [sortBy, setSortBy] = useState('created_at')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  
  // Document Recycle Bin
  const [showRecycleBin, setShowRecycleBin] = useState(false)
  const [deletedDocuments, setDeletedDocuments] = useState<ArchiveDocument[]>([])
  const [isLoadingDeleted, setIsLoadingDeleted] = useState(false)
  const [deletedPage, setDeletedPage] = useState(1)
  const [deletedTotal, setDeletedTotal] = useState(0)
  
  // Autocomplete
  const [showAutocomplete, setShowAutocomplete] = useState(false)
  const [autocompleteResults, setAutocompleteResults] = useState<Student[]>([])
  const autocompleteRef = useRef<HTMLDivElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)

  const handleAutocomplete = async () => {
    if (searchTerm.length < 2) return
    
    const result = await window.electronAPI.searchStudents(searchTerm)
    
    if (result.success) {
      setAutocompleteResults(result.students)
      setShowAutocomplete(result.students.length > 0)
    }
  }

  // Recycle Bin handlers
  const loadDeletedDocuments = async (pageNum = 1) => {
    setIsLoadingDeleted(true)
    const result = await window.electronAPI.getDeletedDocuments({
      userId: user.id,
      limit: PAGINATION.SEARCH_PAGE_SIZE,
      offset: (pageNum - 1) * PAGINATION.SEARCH_PAGE_SIZE,
      sortDir: 'desc'
    })
    if (result.success) {
      setDeletedDocuments(result.documents)
      setDeletedTotal(result.total ?? result.documents.length)
      setDeletedPage(pageNum)
    } else {
      showError(result.error || 'Failed to load the recycle bin')
    }
    setIsLoadingDeleted(false)
  }

  const openRecycleBin = () => {
    setShowRecycleBin(true)
    loadDeletedDocuments(1)
  }

  const closeRecycleBin = () => {
    setShowRecycleBin(false)
    setDeletedDocuments([])
    setDeletedPage(1)
    setDeletedTotal(0)
  }

  const handleRestoreDocument = async (doc: ArchiveDocument) => {
    const result = await window.electronAPI.restoreDocument(doc.id, user.id)
    if (result.success) {
      await loadDeletedDocuments(deletedPage)
      // Refresh active search if it was already performed
      if (hasSearched) {
        handleSearch()
      }
    } else {
      showError(result.error || 'Failed to restore document')
    }
  }

  const handlePurgeDocument = (doc: ArchiveDocument) => {
    const studentName = doc.first_name && doc.last_name
      ? `${doc.first_name} ${doc.last_name}`
      : 'None — general document'

    setConfirmDialog({
      title: 'Delete Permanently',
      message: `Permanently delete this document?\n\nFile: ${doc.file_name}\nStudent: ${studentName}\n\nThis cannot be undone.`,
      confirmLabel: 'Delete Forever',
      action: () => executePurgeDocument(doc)
    })
  }

  const executePurgeDocument = async (doc: ArchiveDocument) => {
    const result = await window.electronAPI.purgeDocument(doc.id, user.id)
    if (result.success) {
      await loadDeletedDocuments(deletedPage)
    } else {
      showError(result.error || 'Failed to delete document permanently')
    }
  }

  useEffect(() => {
    loadDocumentTypes()
    
    const handleClickOutside = (event: MouseEvent) => {
      if (autocompleteRef.current && !autocompleteRef.current.contains(event.target as Node) &&
          searchInputRef.current && !searchInputRef.current.contains(event.target as Node)) {
        setShowAutocomplete(false)
      }
    }
    
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  useEffect(() => {
    if (searchTerm.length >= 2) {
      const timeoutId = setTimeout(() => {
        handleAutocomplete()
      }, 300)
      return () => clearTimeout(timeoutId)
    } else {
      setShowAutocomplete(false)
      setAutocompleteResults([])
    }
  }, [searchTerm])

  const loadDocumentTypes = async () => {
    const result = await window.electronAPI.getDocumentTypes()
    if (result.success) {
      setDocumentTypes(result.types)
    }
  }

  const selectAutocomplete = (student: Student) => {
    setSearchTerm(`${student.first_name} ${student.last_name}`)
    setShowAutocomplete(false)
    // Auto-search after selecting
    setTimeout(() => handleSearch(), 100)
  }

  const runSearch = async (opts?: { page?: number; sortBy?: string; sortDir?: 'asc' | 'desc' }) => {
    const p = opts?.page ?? page
    const sb = opts?.sortBy ?? sortBy
    const sd = opts?.sortDir ?? sortDir

    setIsLoading(true)
    setHasSearched(true)
    setMessage({ type: '', text: '' })

    const filters: DocumentSearchFilters = {
      limit: PAGINATION.SEARCH_PAGE_SIZE,
      offset: (p - 1) * PAGINATION.SEARCH_PAGE_SIZE,
      sortBy: sb,
      sortDir: sd
    }
    if (searchTerm) filters.studentName = searchTerm
    if (documentTypeFilter) filters.documentType = parseInt(documentTypeFilter)
    if (yearFilter.trim()) filters.year = yearFilter.trim()

    try {
      const result = await window.electronAPI.searchDocuments(filters)
      if (result.success) {
        setDocuments(result.documents)
        setTotal(result.total ?? result.documents.length)
        setPage(p)
        if (opts?.sortBy) setSortBy(opts.sortBy)
        if (opts?.sortDir) setSortDir(opts.sortDir)
      } else {
        showError(`Search failed: ${result.error}`)
      }
    } catch (error) {
      showError(`Search failed: ${getErrorMessage(error)}`)
    }
    setIsLoading(false)
  }

  const handleSearch = (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    // A fresh submit starts at page 1; a background refresh keeps the current page.
    runSearch({ page: e ? 1 : page })
  }

  const handleSortChange = (value: string) => {
    if (value === sortBy) {
      runSearch({ page: 1, sortBy, sortDir: sortDir === 'asc' ? 'desc' : 'asc' })
    } else {
      runSearch({ page: 1, sortBy: value, sortDir: 'asc' })
    }
  }

  const clearFilters = () => {
    setSearchTerm('')
    setDocumentTypeFilter('')
    setYearFilter('')
    setDocuments([])
    setTotal(0)
    setPage(1)
    setHasSearched(false)
  }

  const viewDocument = (doc: ArchiveDocument) => {
    setViewingDoc(doc)
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

  const handleDelete = (doc: ArchiveDocument) => {
    const studentName = doc.first_name && doc.last_name
      ? `${doc.first_name} ${doc.last_name}`
      : 'None — general document'

    setConfirmDialog({
      title: 'Delete Document',
      message: `Move this document to the Recycle Bin?\n\nFile: ${doc.file_name}\nStudent: ${studentName}\n\nYou can restore this document later from the Recycle Bin.`,
      confirmLabel: 'Delete',
      action: () => executeDelete(doc)
    })
  }

  const executeDelete = async (doc: ArchiveDocument) => {
    const result = await window.electronAPI.deleteDocument(doc.id, user.id)
    if (result.success) {
      setViewingDoc(null)
      setMessage({ type: 'success', text: 'Document moved to the Recycle Bin' })
      handleSearch()
      setTimeout(() => setMessage({ type: '', text: '' }), 3000)
    } else {
      showError(result.error || 'Failed to delete document')
    }
  }

  const getCategoryColor = (category: string) => {
    switch (category) {
      case 'student': return 'bg-[#dceafb] text-[#24558d]'
      case 'administrative': return 'bg-[#e5f5ee] text-[#2b9b72]'
      case 'financial': return 'bg-[#fff6df] text-[#b17f22]'
      case 'audit': return 'bg-[#f0f3f7] text-[#8793a3]'
      default: return 'bg-[#f0f3f7] text-[#8793a3]'
    }
  }

  return (
    <div className="mx-auto max-w-[1420px] p-5 sm:p-7">
      <PageHeader
        eyebrow="Records lookup"
        title="Search Documents"
        description={
          user.role === 'user' 
            ? "Search by student name or ID. You can view and print documents."
            : "Search, view, edit, and manage documents in the archive."
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

      {/* Search Filters */}
      <div className="surface-card rounded-lg p-5">
        <form onSubmit={handleSearch} className="space-y-4">
          <div className="grid gap-4 md:grid-cols-3">
            {/* Student Search with Autocomplete */}
            <div className="relative">
              <label className="label-caps mb-1.5 block">
                Student Name, School Year, or ID
              </label>
              <div className="relative">
                <SearchIcon size={15} className="absolute left-3 top-2.5 text-[#8a97a7]" />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="e.g., Dela Cruz or 2024-2025"
                  className="h-9 w-full rounded-md border border-[#d9dfe7] bg-white pl-9 pr-3 text-xs outline-none focus:border-[#5688bd] focus:ring-2 focus:ring-[#dceafb]"
                />
              </div>
              
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
                      className="w-full px-3 py-2 text-left hover:bg-[#f8fafc] border-b border-[#edf0f3] last:border-0"
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

            {/* Document Type Filter */}
            <div>
              <label className="label-caps mb-1.5 block">Document Type</label>
              <select
                value={documentTypeFilter}
                onChange={(e) => setDocumentTypeFilter(e.target.value)}
                className="h-9 w-full rounded-md border border-[#d9dfe7] bg-white px-3 text-xs text-[#47576b] outline-none focus:border-[#5688bd] focus:ring-2 focus:ring-[#dceafb]"
              >
                <option value="">All Types</option>
                {documentTypes.map(type => (
                  <option key={type.id} value={type.id}>{type.name}</option>
                ))}
              </select>
            </div>

            {/* Year Filter */}
            <div>
              <label className="label-caps mb-1.5 block">Year</label>
              <input
                type="text"
                value={yearFilter}
                onChange={(e) => setYearFilter(e.target.value)}
                placeholder="e.g., 2024-2025"
                className="h-9 w-full rounded-md border border-[#d9dfe7] bg-white px-3 text-xs outline-none focus:border-[#5688bd] focus:ring-2 focus:ring-[#dceafb]"
              />
            </div>
          </div>

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={isLoading}
              className="inline-flex items-center justify-center gap-2 rounded-md px-3.5 py-2 text-xs font-bold transition focus-ring disabled:cursor-not-allowed disabled:opacity-50 bg-[#24558d] text-white hover:bg-[#1d4778]"
            >
              <SearchIcon size={14} />
              {isLoading ? 'Searching...' : 'Search'}
            </button>
            <button
              type="button"
              onClick={clearFilters}
              className="inline-flex items-center justify-center gap-2 rounded-md px-3.5 py-2 text-xs font-bold transition focus-ring border border-[#d7dde5] bg-white text-[#34445a] hover:bg-[#f4f6f8]"
            >
              Clear
            </button>
            {user.role === 'admin' && (
              <button
                type="button"
                onClick={openRecycleBin}
                className="inline-flex items-center justify-center gap-2 rounded-md px-3.5 py-2 text-xs font-bold transition focus-ring border border-[#d7dde5] bg-white text-[#34445a] hover:bg-[#f4f6f8]"
              >
                <Recycle size={14} />
                Recycle Bin
              </button>
            )}
          </div>
        </form>
      </div>

      {/* Search Results */}
      {hasSearched && (
        <section className="surface-card mt-5 rounded-lg">
          <div className="flex items-center justify-between border-b border-[#e8ebef] px-5 py-4">
            <div>
              <h2 className="text-sm font-bold text-[#1c2f47]">Search Results</h2>
              <p className="mt-0.5 text-[11px] text-[#8a95a5]">
                {total} document{total !== 1 ? 's' : ''} found
              </p>
            </div>
            {total > 0 && (
              <div className="flex items-center gap-1.5">
                <ArrowUpDown size={13} className="text-[#8a95a5]" />
                <select
                  value={sortBy}
                  onChange={(e) => handleSortChange(e.target.value)}
                  className="h-8 rounded-md border border-[#d9dfe7] bg-white px-2 text-xs text-[#47576b] outline-none focus:border-[#5688bd] focus:ring-2 focus:ring-[#dceafb]"
                >
                  {SORT_OPTIONS.map(o => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
                <button
                  type="button"
                  onClick={() => runSearch({ page: 1, sortBy, sortDir: sortDir === 'asc' ? 'desc' : 'asc' })}
                  className="h-8 rounded-md border border-[#d7dde5] bg-white px-2 text-xs font-semibold text-[#34445a] hover:bg-[#f4f6f8] transition"
                  title="Toggle sort direction"
                >
                  {sortDir === 'asc' ? 'Asc' : 'Desc'}
                </button>
              </div>
            )}
          </div>

          {documents.length > 0 ? (
            <div className="divide-y divide-[#edf0f3]">
              {documents.map((doc: ArchiveDocument) => {
                const docType = documentTypes.find(dt => dt.id === doc.document_type_id)
                
                return (
                  <div 
                    key={doc.id} 
                    onClick={() => viewDocument(doc)}
                    className="px-5 py-4 hover:bg-[#fbfcfd] transition cursor-pointer"
                  >
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-2">
                          <span className={cn(
                            'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider',
                            getCategoryColor(docType?.category || 'other')
                          )}>
                            {doc.document_type}
                          </span>
                          <span className="text-[10px] text-[#8a95a5]">
                            {formatDate(doc.created_at)}
                          </span>
                        </div>
                        
                        <div className="mono text-xs font-semibold text-[#263950] truncate">
                          {doc.file_name}
                        </div>
                        
                        {(doc.first_name && doc.last_name) ? (
                          <div className="mt-1 text-xs text-[#617084]">
                            <span className="font-semibold">Student:</span>{' '}
                            {doc.first_name} {doc.middle_name ? doc.middle_name + ' ' : ''}{doc.last_name}
                            <span className="mono ml-2 text-[#8995a4]">({formatStudentYear(doc)})</span>
                          </div>
                        ) : doc.student_id ? (
                          <div className="mt-1 text-xs text-[#b94843]">
                            <span className="font-semibold">Student:</span>{' '}
                            Unknown student (missing record #{doc.student_id})
                          </div>
                        ) : (
                          <div className="mt-1 text-xs text-[#8a95a5]">
                            <span className="font-semibold">Student:</span>{' '}
                            None — general document
                          </div>
                        )}
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
                            onClick={() => handleDelete(doc)}
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
              })}
            </div>
          ) : (
            <EmptyState
              icon={SearchIcon}
              title="No documents found"
              body="Try adjusting your search criteria or filters."
            />
          )}

          {total > 0 && (
            <div className="border-t border-[#e8ebef] px-5 py-3">
              <Pagination
                page={page}
                pageSize={PAGINATION.SEARCH_PAGE_SIZE}
                total={total}
                onPageChange={(p) => runSearch({ page: p })}
              />
            </div>
          )}
        </section>
      )}

      {!hasSearched && (
        <div className="mt-5 text-center py-12">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-[#edf2f7] mb-4">
            <SearchIcon size={28} className="text-[#6c8199]" />
          </div>
          <p className="text-sm text-[#8490a0]">
            Enter search criteria above to find documents
          </p>
        </div>
      )}

      {viewingDoc && (
        <DocumentViewerModal
          doc={viewingDoc}
          siblings={documents.filter(
            (d) => d.student_id === viewingDoc.student_id && d.document_type_id === viewingDoc.document_type_id
          )}
          userId={user.id}
          userRole={user.role}
          onClose={() => setViewingDoc(null)}
          onDelete={user.role === 'admin' ? handleDelete : undefined}
          onUpdate={handleSearch}
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

      {/* Document Recycle Bin Modal */}
      {showRecycleBin && user.role === 'admin' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="surface-card max-h-[85vh] w-full max-w-5xl overflow-hidden rounded-lg">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-[#e8ebef] px-5 py-4">
              <div>
                <h2 className="flex items-center gap-2 text-sm font-bold text-[#1c2f47]">
                  <Recycle size={16} className="text-[#315c87]" />
                  Document Recycle Bin
                </h2>
                <p className="mt-0.5 text-[11px] text-[#8a95a5]">
                  {deletedTotal} deleted document{deletedTotal !== 1 ? 's' : ''}
                </p>
              </div>
              <button
                onClick={closeRecycleBin}
                className="rounded p-1.5 text-[#617084] hover:bg-[#f4f6f8] transition"
                title="Close"
              >
                ✕
              </button>
            </div>

            {/* Body */}
            <div className="max-h-[calc(85vh-120px)] overflow-y-auto">
              {isLoadingDeleted ? (
                <div className="flex items-center justify-center py-12">
                  <div className="text-center">
                    <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-[#24558d] border-r-transparent"></div>
                    <p className="mt-3 text-sm text-[#8490a0]">Loading recycle bin...</p>
                  </div>
                </div>
              ) : deletedDocuments.length > 0 ? (
                <div className="divide-y divide-[#edf0f3]">
                  {deletedDocuments.map((doc: ArchiveDocument) => {
                    const docType = documentTypes.find(dt => dt.id === doc.document_type_id)
                    
                    return (
                      <div 
                        key={doc.id} 
                        className="px-5 py-4 hover:bg-[#fbfcfd] transition"
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-2">
                              <span className={cn(
                                'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider',
                                getCategoryColor(docType?.category || 'student')
                              )}>
                                {doc.document_type}
                              </span>
                              <span className="text-[10px] text-[#b94843]">
                                Deleted: {formatDate(doc.deleted_at || doc.created_at)}
                              </span>
                            </div>
                            
                            <div className="mono text-xs font-semibold text-[#263950] truncate">
                              {doc.file_name}
                            </div>
                            
                            {(doc.first_name && doc.last_name) ? (
                              <div className="mt-1 text-xs text-[#617084]">
                                <span className="font-semibold">Student:</span>{' '}
                                {doc.first_name} {doc.middle_name ? doc.middle_name + ' ' : ''}{doc.last_name}
                                <span className="mono ml-2 text-[#8995a4]">({formatStudentYear(doc)})</span>
                              </div>
                            ) : doc.student_id ? (
                              <div className="mt-1 text-xs text-[#b94843]">
                                <span className="font-semibold">Student:</span>{' '}
                                Unknown student (missing record #{doc.student_id})
                              </div>
                            ) : (
                              <div className="mt-1 text-xs text-[#8a95a5]">
                                <span className="font-semibold">Student:</span>{' '}
                                None — general document
                              </div>
                            )}
                          </div>

                          <div className="flex gap-1">
                            <button
                              onClick={() => handleRestoreDocument(doc)}
                              className="inline-flex items-center gap-1.5 rounded px-2.5 py-1.5 text-xs font-semibold text-[#2b9b72] hover:bg-[#e5f5ee] transition"
                              title="Restore document"
                            >
                              <RotateCcw size={14} />
                              Restore
                            </button>
                            <button
                              onClick={() => handlePurgeDocument(doc)}
                              className="inline-flex items-center gap-1.5 rounded px-2.5 py-1.5 text-xs font-semibold text-[#b94843] hover:bg-[#fff0ef] transition"
                              title="Delete permanently"
                            >
                              <Trash2 size={14} />
                              Delete Forever
                            </button>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <EmptyState
                  icon={Trash2}
                  title="Recycle bin is empty"
                  body="Deleted documents will appear here and can be restored at any time."
                />
              )}
            </div>

            {/* Footer with Pagination */}
            {deletedTotal > 0 && (
              <div className="border-t border-[#e8ebef] px-5 py-3">
                <Pagination
                  page={deletedPage}
                  pageSize={PAGINATION.SEARCH_PAGE_SIZE}
                  total={deletedTotal}
                  onPageChange={(p) => loadDeletedDocuments(p)}
                />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

export default Search
