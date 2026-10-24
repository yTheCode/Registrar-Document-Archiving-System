import { useState, useEffect, useCallback } from 'react'
import { X, Folder, ExternalLink, Trash2, FileText, ChevronLeft, ChevronRight, Printer, Share2, Edit } from 'lucide-react'
import type { ArchiveDocument, Student, DocumentType } from '@/types'
import { canPerformAction } from '@/utils/permissions'
import { getErrorMessage } from '@/utils/error'

interface DocumentViewerModalProps {
  doc: ArchiveDocument
  /** Sibling pages of the same student + document type, in any order. */
  siblings?: ArchiveDocument[]
  userId: number
  userRole: string
  onClose: () => void
  onDelete?: (doc: ArchiveDocument) => void
  onUpdate?: () => void
}

const IMAGE_EXTENSIONS = ['jpg', 'jpeg', 'png', 'gif']

// Chromium's built-in PDF viewer refuses data: URLs in iframes, so the
// base64 from IPC is turned into a Blob and served through a blob: URL.
// (If multi-page PDFs still render blank, the next step is a custom
// protocol — see the project notes — but blob: URLs work on Electron 28.)
function base64ToBlob(base64: string, mimeType: string): Blob {
  const binary = atob(base64)
  const chunks: Uint8Array<ArrayBuffer>[] = []
  const CHUNK_SIZE = 0x8000
  for (let offset = 0; offset < binary.length; offset += CHUNK_SIZE) {
    const slice = binary.slice(offset, offset + CHUNK_SIZE)
    const bytes = new Uint8Array(slice.length)
    for (let i = 0; i < slice.length; i++) {
      bytes[i] = slice.charCodeAt(i)
    }
    chunks.push(bytes)
  }
  return new Blob(chunks, { type: mimeType })
}

// "(2)" sorts before "(10)" — sibling pages follow file-name numbering
function naturalCompare(a: string, b: string): number {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })
}

function DocumentViewerModal({ doc, siblings, userId, userRole, onClose, onDelete, onUpdate }: DocumentViewerModalProps) {
  const [currentId, setCurrentId] = useState(doc.id)
  const [objectUrl, setObjectUrl] = useState('')
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')
  const [isPrinting, setIsPrinting] = useState(false)
  const [isSharing, setIsSharing] = useState(false)
  const [actionMessage, setActionMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null)

  // Edit modal state
  const [showEditModal, setShowEditModal] = useState(false)
  const [isEditing, setIsEditing] = useState(false)
  const [students, setStudents] = useState<Student[]>([])
  const [documentTypes, setDocumentTypes] = useState<DocumentType[]>([])
  const [editForm, setEditForm] = useState({
    documentTypeId: 0,
    studentId: null as number | null,
    academicYear: '',
    remarks: ''
  })
  const [searchTerm, setSearchTerm] = useState('')
  const [editError, setEditError] = useState('')

  useEffect(() => {
    setCurrentId(doc.id)
  }, [doc.id])

  // Same student + same document type, numbered pages in order
  const pages = (siblings && siblings.length > 0 ? siblings : [doc])
    .slice()
    .sort((a, b) => naturalCompare(a.file_name, b.file_name))
  const pageIndex = Math.max(0, pages.findIndex((d) => d.id === currentId))
  const currentDoc = pages[pageIndex] || doc
  const hasPager = pages.length > 1

  const ext = currentDoc.file_name.toLowerCase().split('.').pop() || ''
  const isImage = IMAGE_EXTENSIONS.includes(ext)
  const isPdf = ext === 'pdf'

  useEffect(() => {
    let cancelled = false
    let url = ''

    const load = async () => {
      setIsLoading(true)
      setError('')
      setObjectUrl('')
      try {
        const result = await window.electronAPI.readFileAsBase64(currentDoc.file_path)
        if (cancelled) return
        if (!result.success) {
          setError(result.error || 'Failed to load document.')
          return
        }
        const blob = base64ToBlob(result.base64, result.mimeType)
        url = URL.createObjectURL(blob)
        setObjectUrl(url)
      } catch (err) {
        if (!cancelled) {
          setError(getErrorMessage(err) || 'Failed to load document.')
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    }

    load()

    return () => {
      cancelled = true
      if (url) {
        URL.revokeObjectURL(url)
      }
    }
  }, [currentDoc.id, currentDoc.file_path])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose()
      }
    },
    [onClose]
  )

  const goToPage = (index: number) => {
    const next = pages[index]
    if (next) {
      setCurrentId(next.id)
    }
  }

  const handlePrint = async () => {
    if (isPrinting) return
    setIsPrinting(true)
    setActionMessage(null)
    try {
      const result = await window.electronAPI.printFile(currentDoc.file_path, userId)
      if (!result.success) {
        setActionMessage({ type: 'error', text: result.error || 'Print failed.' })
      }
    } catch (err) {
      setActionMessage({ type: 'error', text: getErrorMessage(err) || 'Print failed.' })
    } finally {
      setIsPrinting(false)
    }
  }

  const handleShare = async () => {
    if (isSharing) return
    setIsSharing(true)
    setActionMessage(null)
    try {
      const result = await window.electronAPI.exportFileCopy(currentDoc.file_path, userId)
      if (result.canceled) {
        return
      }
      if (result.success) {
        setActionMessage({ type: 'success', text: `Copy exported to ${result.filePath}` })
      } else {
        setActionMessage({ type: 'error', text: result.error || 'Export failed.' })
      }
    } catch (err) {
      setActionMessage({ type: 'error', text: getErrorMessage(err) || 'Export failed.' })
    } finally {
      setIsSharing(false)
    }
  }

  const handleOpenEditModal = async () => {
    setShowEditModal(true)
    setEditError('')
    setSearchTerm('')
    
    // Load students and document types
    try {
      const [studentsResult, typesResult] = await Promise.all([
        window.electronAPI.getAllStudents(),
        window.electronAPI.getDocumentTypes()
      ])
      
      if (studentsResult.success) {
        setStudents(studentsResult.students)
      }
      if (typesResult.success) {
        setDocumentTypes(typesResult.types)
      }

      // Parse metadata from current document
      let metadata: Record<string, unknown> = {}
      try {
        metadata = currentDoc.metadata_json ? JSON.parse(currentDoc.metadata_json) : {}
      } catch {}

      // Find the document type ID
      const docType = typesResult.success 
        ? typesResult.types.find(t => t.name === currentDoc.document_type)
        : null

      setEditForm({
        documentTypeId: docType?.id || 0,
        studentId: currentDoc.student_id || null,
        academicYear: typeof metadata.academic_year === 'string' ? metadata.academic_year : '',
        remarks: typeof metadata.remarks === 'string' ? metadata.remarks : ''
      })
    } catch (err) {
      setEditError(`Failed to load data: ${getErrorMessage(err)}`)
    }
  }

  const handleCloseEditModal = () => {
    setShowEditModal(false)
    setEditError('')
    setSearchTerm('')
  }

  const handleSaveEdit = async () => {
    if (isEditing) return
    setIsEditing(true)
    setEditError('')

    if (!editForm.documentTypeId) {
      setEditError('Document Type is required')
      setIsEditing(false)
      return
    }

    try {
      const result = await window.electronAPI.updateDocument(
        currentDoc.id,
        userId,
        editForm.documentTypeId,
        editForm.studentId,
        editForm.academicYear || undefined,
        editForm.remarks || undefined
      )

      if (result.success) {
        setActionMessage({ type: 'success', text: 'Document updated successfully' })
        handleCloseEditModal()
        if (onUpdate) {
          onUpdate()
        }
        // Refresh could cause the viewer to close if the document moved,
        // so we close proactively
        setTimeout(() => onClose(), 1000)
      } else {
        setEditError(result.error || 'Failed to update document')
      }
    } catch (err) {
      setEditError(getErrorMessage(err) || 'Failed to update document')
    } finally {
      setIsEditing(false)
    }
  }

  const filteredStudents = searchTerm.trim()
    ? students.filter(s => {
        const term = searchTerm.toLowerCase()
        return (
          s.first_name.toLowerCase().includes(term) ||
          s.last_name.toLowerCase().includes(term) ||
          (s.middle_name && s.middle_name.toLowerCase().includes(term)) ||
          (s.student_id && s.student_id.toLowerCase().includes(term))
        )
      })
    : students

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
      onKeyDown={handleKeyDown}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-5xl flex-col rounded-lg bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-4 border-b border-[#e8ebef] px-5 py-3.5">
          <div className="flex min-w-0 items-center gap-3">
            <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[#dceafb] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[#24558d]">
              {currentDoc.document_type}
            </span>
            <div>
              <div className="mono truncate text-xs font-semibold text-[#263950]">
                {currentDoc.file_name}
              </div>
              {currentDoc.created_by_name && (
                <div className="text-[10px] text-[#8490a0]">
                  Archived by <span className="font-semibold text-[#617084]">{currentDoc.created_by_name}</span>
                </div>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1.5 text-[#617084] transition hover:bg-[#f4f6f8]"
            title="Close (Esc)"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-auto bg-[#f4f6f8] p-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-20">
              <div className="text-center">
                <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-[#24558d] border-r-transparent"></div>
                <p className="mt-3 text-sm text-[#8490a0]">Loading document...</p>
              </div>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center gap-3 py-20 text-xs text-[#b94843]">
              <FileText size={32} />
              <p>{error}</p>
            </div>
          ) : isImage ? (
            <div className="flex justify-center">
              <img
                src={objectUrl}
                alt={currentDoc.file_name}
                className="h-auto max-h-[65vh] w-auto max-w-full rounded"
              />
            </div>
          ) : isPdf ? (
            <iframe
              src={objectUrl}
              title={currentDoc.file_name}
              className="h-[65vh] w-full rounded border-0 bg-white"
            />
          ) : (
            <div className="flex flex-col items-center justify-center gap-3 py-20 text-xs text-[#617084]">
              <FileText size={32} />
              <p>No inline preview available for this file type.</p>
              <button
                onClick={() => window.electronAPI.openFileExternal(currentDoc.file_path)}
                className="inline-flex items-center gap-1.5 rounded-md border border-[#d7dde5] bg-white px-3 py-2 text-xs font-bold text-[#34445a] transition hover:bg-[#f4f6f8]"
              >
                <ExternalLink size={14} />
                Open Externally
              </button>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center justify-between gap-2 border-t border-[#e8ebef] px-5 py-3">
          <div className="flex items-center gap-2">
            {hasPager && (
              <>
                <button
                  onClick={() => goToPage(pageIndex - 1)}
                  disabled={pageIndex === 0}
                  className="inline-flex items-center gap-1 rounded-md border border-[#d7dde5] bg-white px-2.5 py-2 text-xs font-bold text-[#34445a] transition hover:bg-[#f4f6f8] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <ChevronLeft size={14} />
                  Previous
                </button>
                <span className="text-xs font-semibold text-[#617084]">
                  Page {pageIndex + 1} of {pages.length}
                </span>
                <button
                  onClick={() => goToPage(pageIndex + 1)}
                  disabled={pageIndex === pages.length - 1}
                  className="inline-flex items-center gap-1 rounded-md border border-[#d7dde5] bg-white px-2.5 py-2 text-xs font-bold text-[#34445a] transition hover:bg-[#f4f6f8] disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Next
                  <ChevronRight size={14} />
                </button>
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            {canPerformAction(userRole, 'print') && (
              <button
                onClick={handlePrint}
                disabled={isPrinting}
                className="inline-flex items-center gap-1.5 rounded-md border border-[#d7dde5] bg-white px-3 py-2 text-xs font-bold text-[#34445a] transition hover:bg-[#f4f6f8] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Printer size={14} />
                {isPrinting ? 'Printing...' : 'Print'}
              </button>
            )}
            {canPerformAction(userRole, 'share') && (
              <button
                onClick={handleShare}
                disabled={isSharing}
                className="inline-flex items-center gap-1.5 rounded-md border border-[#d7dde5] bg-white px-3 py-2 text-xs font-bold text-[#34445a] transition hover:bg-[#f4f6f8] disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Share2 size={14} />
                {isSharing ? 'Exporting...' : 'Export Copy'}
              </button>
            )}
            <button
              onClick={() => window.electronAPI.showFileInFolder(currentDoc.file_path)}
              className="inline-flex items-center gap-1.5 rounded-md border border-[#d7dde5] bg-white px-3 py-2 text-xs font-bold text-[#34445a] transition hover:bg-[#f4f6f8]"
            >
              <Folder size={14} />
              Show in Folder
            </button>
            <button
              onClick={() => window.electronAPI.openFileExternal(currentDoc.file_path)}
              className="inline-flex items-center gap-1.5 rounded-md border border-[#d7dde5] bg-white px-3 py-2 text-xs font-bold text-[#34445a] transition hover:bg-[#f4f6f8]"
            >
              <ExternalLink size={14} />
              Open Externally
            </button>
            {canPerformAction(userRole, 'edit') && (
              <button
                onClick={handleOpenEditModal}
                className="inline-flex items-center gap-1.5 rounded-md border border-[#d7dde5] bg-white px-3 py-2 text-xs font-bold text-[#34445a] transition hover:bg-[#f4f6f8]"
              >
                <Edit size={14} />
                Edit Details
              </button>
            )}
            {canPerformAction(userRole, 'delete') && onDelete && (
              <button
                onClick={() => onDelete(currentDoc)}
                className="inline-flex items-center gap-1.5 rounded-md bg-[#fff0ef] px-3 py-2 text-xs font-bold text-[#b94843] transition hover:bg-[#fde4e2]"
              >
                <Trash2 size={14} />
                Delete
              </button>
            )}
          </div>
        </div>
        {actionMessage && (
          <div
            className={`border-t border-[#e8ebef] px-5 py-2 text-xs font-semibold ${
              actionMessage.type === 'error' ? 'bg-[#fdf0ef] text-[#b94843]' : 'bg-[#e5f5ee] text-[#2b9b72]'
            }`}
          >
            {actionMessage.text}
          </div>
        )}
      </div>

      {/* Edit Details Modal */}
      {showEditModal && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
          onClick={handleCloseEditModal}
        >
          <div
            className="w-full max-w-2xl rounded-lg bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-[#e8ebef] px-5 py-3.5">
              <h3 className="text-sm font-bold text-[#182a43]">Edit Document Details</h3>
              <button
                onClick={handleCloseEditModal}
                className="rounded p-1.5 text-[#617084] transition hover:bg-[#f4f6f8]"
              >
                <X size={18} />
              </button>
            </div>

            <div className="max-h-[70vh] overflow-y-auto p-5">
              {editError && (
                <div className="mb-4 rounded-md bg-[#fff0ef] px-3 py-2 text-xs font-semibold text-[#b94843]">
                  {editError}
                </div>
              )}

              <div className="space-y-4">
                {/* Document Type */}
                <div>
                  <label className="mb-1.5 block text-xs font-bold text-[#47576b]">
                    Document Type <span className="text-[#b94843]">*</span>
                  </label>
                  <select
                    value={editForm.documentTypeId}
                    onChange={(e) => setEditForm({ ...editForm, documentTypeId: parseInt(e.target.value) })}
                    className="w-full rounded-md border border-[#d7dde5] bg-white px-3 py-2 text-xs text-[#263950] transition focus:border-[#24558d] focus:outline-none focus:ring-2 focus:ring-[#dceafb]"
                  >
                    <option value={0}>Select Document Type</option>
                    {documentTypes.map((type) => (
                      <option key={type.id} value={type.id}>
                        {type.name}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Student */}
                <div>
                  <label className="mb-1.5 block text-xs font-bold text-[#47576b]">
                    Student (optional for general documents)
                  </label>
                  <input
                    type="text"
                    placeholder="Search by name or ID..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="mb-2 w-full rounded-md border border-[#d7dde5] bg-white px-3 py-2 text-xs text-[#263950] transition focus:border-[#24558d] focus:outline-none focus:ring-2 focus:ring-[#dceafb]"
                  />
                  {searchTerm.trim() && (
                    <div className="max-h-48 overflow-y-auto rounded-md border border-[#e8ebef] bg-white">
                      {filteredStudents.length > 0 ? (
                        <div className="divide-y divide-[#f0f3f7]">
                          {filteredStudents.slice(0, 10).map((student) => (
                            <button
                              key={student.id}
                              onClick={() => {
                                setEditForm({ ...editForm, studentId: student.id })
                                setSearchTerm('')
                              }}
                              className="w-full px-3 py-2 text-left text-xs transition hover:bg-[#f4f6f8]"
                            >
                              <div className="font-semibold text-[#263950]">
                                {student.last_name}, {student.first_name} {student.middle_name || ''}
                              </div>
                              <div className="text-[#617084]">
                                {student.student_id || 'No ID'} • {student.school_year || 'No year'} • {student.program_level || 'No program'}
                              </div>
                            </button>
                          ))}
                        </div>
                      ) : (
                        <div className="px-3 py-2 text-xs text-[#8a95a5]">No students found</div>
                      )}
                    </div>
                  )}
                  {editForm.studentId && (
                    <div className="mt-2 flex items-center justify-between rounded-md border border-[#d7dde5] bg-[#f4f6f8] px-3 py-2">
                      <div className="text-xs">
                        <div className="font-semibold text-[#263950]">
                          {(() => {
                            const s = students.find((st) => st.id === editForm.studentId)
                            return s ? `${s.last_name}, ${s.first_name} ${s.middle_name || ''}` : 'Unknown'
                          })()}
                        </div>
                      </div>
                      <button
                        onClick={() => setEditForm({ ...editForm, studentId: null })}
                        className="text-[#b94843] transition hover:text-[#a03833]"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  )}
                  {!editForm.studentId && !searchTerm && (
                    <button
                      onClick={() => setEditForm({ ...editForm, studentId: null })}
                      className="mt-2 text-xs text-[#24558d] transition hover:underline"
                    >
                      Clear student (make general document)
                    </button>
                  )}
                </div>

                {/* Academic Year */}
                <div>
                  <label className="mb-1.5 block text-xs font-bold text-[#47576b]">
                    Academic Year
                  </label>
                  <input
                    type="text"
                    placeholder="e.g., 2024-2025"
                    value={editForm.academicYear}
                    onChange={(e) => setEditForm({ ...editForm, academicYear: e.target.value })}
                    className="w-full rounded-md border border-[#d7dde5] bg-white px-3 py-2 text-xs text-[#263950] transition focus:border-[#24558d] focus:outline-none focus:ring-2 focus:ring-[#dceafb]"
                  />
                </div>

                {/* Remarks */}
                <div>
                  <label className="mb-1.5 block text-xs font-bold text-[#47576b]">
                    Remarks
                  </label>
                  <textarea
                    placeholder="Additional notes..."
                    value={editForm.remarks}
                    onChange={(e) => setEditForm({ ...editForm, remarks: e.target.value })}
                    rows={3}
                    className="w-full rounded-md border border-[#d7dde5] bg-white px-3 py-2 text-xs text-[#263950] transition focus:border-[#24558d] focus:outline-none focus:ring-2 focus:ring-[#dceafb]"
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-[#e8ebef] px-5 py-3">
              <button
                onClick={handleCloseEditModal}
                disabled={isEditing}
                className="rounded-md border border-[#d7dde5] bg-white px-4 py-2 text-xs font-bold text-[#34445a] transition hover:bg-[#f4f6f8] disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveEdit}
                disabled={isEditing || !editForm.documentTypeId}
                className="rounded-md bg-[#24558d] px-4 py-2 text-xs font-bold text-white transition hover:bg-[#1d4778] disabled:opacity-50"
              >
                {isEditing ? 'Saving...' : 'Save Changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default DocumentViewerModal
