import { FileText, CheckCircle2, AlertCircle, Crop } from 'lucide-react'
import { cn } from '@/utils/cn'
import Pagination from '@/components/ui/Pagination'
import { PAGINATION } from '@/constants/pagination'
import { validateDocument } from '@/features/import-scanner/lib/documentValidation'
import type { DocumentType, FileWithMetadata } from '@/types'

interface ReviewTableProps {
  filesWithMetadata: FileWithMetadata[]
  reviewSlice: FileWithMetadata[]
  reviewStart: number
  documentTypes: DocumentType[]
  currentFileIndex: number
  isStudentWorkflow: boolean
  readyCount: number
  editableImageCount: number
  reviewPage: number
  onJumpToFile: (index: number) => void
  onEditAllImages: () => void
  onReviewPageChange: (page: number) => void
}

function ReviewTable({ filesWithMetadata, reviewSlice, reviewStart, documentTypes, currentFileIndex, isStudentWorkflow, readyCount, editableImageCount, reviewPage, onJumpToFile, onEditAllImages, onReviewPageChange }: ReviewTableProps) {
  return (
    <div className="surface-card rounded-lg p-5 mb-5">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-bold text-[#1c2f47]">Review {isStudentWorkflow ? 'Single Student' : 'Mixed-Batch'} Documents</h3>
        <div className="flex items-center gap-3">
          {/* Re-opens the whole batch from the first image every time it is
              clicked, so finishing a pass never locks the button out. */}
          <button
            type="button"
            onClick={onEditAllImages}
            disabled={editableImageCount === 0}
            className="inline-flex items-center justify-center gap-2 rounded-md px-3 py-1.5 text-xs font-bold transition focus-ring bg-[#24558d] text-white hover:bg-[#1d4778] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Crop size={14} />
            Edit All Images ({editableImageCount})
          </button>
          <div className={cn(
            'text-xs font-bold',
            readyCount === filesWithMetadata.length ? 'text-[#2b9b72]' : 'text-[#b17f22]'
          )}>
            {readyCount} / {filesWithMetadata.length} ready
          </div>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left">
          <thead>
            <tr className="border-b border-[#e8ebef] text-[10px] uppercase tracking-wide text-[#8a95a5]">
              <th className="py-2 pr-3">#</th>
              <th className="py-2 pr-3">Preview</th>
              <th className="py-2 pr-3">Student</th>
              <th className="py-2 pr-3">Document Type</th>
              <th className="py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {reviewSlice.map((f, idx) => {
              const i = reviewStart + idx
              const dt = documentTypes.find(t => t.id === parseInt(f.documentTypeId))
              const needsStudent = !f.student
              const errors = validateDocument(f, documentTypes)
              const ready = errors.length === 0
              return (
                <tr
                  key={f.tempId}
                  className={cn(
                    'cursor-pointer border-b border-[#edf0f3] text-xs transition hover:bg-[#f8fafc]',
                    i === currentFileIndex && 'bg-[#eef5fb]'
                  )}
                  onClick={() => onJumpToFile(i)}
                >
                  <td className="py-2 pr-3 mono text-[#536d89]">{i + 1}</td>
                  <td className="py-2 pr-3">
                    {f.thumbnail || f.isDataUrl ? (
                      <img src={f.editedDataUrl || f.filePath} alt="" className="h-8 w-8 rounded object-cover" />
                    ) : (
                      <FileText size={16} className="text-[#8a97a7]" />
                    )}
                  </td>
                  <td className="py-2 pr-3">
                    {f.student
                      ? `${f.student.last_name}, ${f.student.first_name}`
                      : <span className="text-[#b94843]">—</span>}
                  </td>
                  <td className="py-2 pr-3">{dt ? dt.name : <span className="text-[#b94843]">—</span>}</td>
                  <td className="py-2">
                    {ready ? (
                      <span className="inline-flex items-center gap-1 text-[#2b9b72]"><CheckCircle2 size={13} /> Ready</span>
                    ) : (
                      <span className="inline-flex items-center gap-1 font-bold text-[#b94843]"><AlertCircle size={13} /> Needs attention</span>
                    )}
                    {needsStudent && <div className="text-[10px] text-[#b94843]">Student required</div>}
                    {!ready && errors.length > 0 && (
                      <div className="text-[10px] text-[#b94843]">{errors[0]}</div>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {filesWithMetadata.length > PAGINATION.REVIEW_PAGE_SIZE && (
        <Pagination
          className="mt-3"
          page={reviewPage}
          pageSize={PAGINATION.REVIEW_PAGE_SIZE}
          total={filesWithMetadata.length}
          onPageChange={onReviewPageChange}
        />
      )}
    </div>
  )
}

export default ReviewTable
