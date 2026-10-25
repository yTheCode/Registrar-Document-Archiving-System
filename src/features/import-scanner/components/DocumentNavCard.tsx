import { FileText } from 'lucide-react'
import { isEditableImage } from '@/features/import-scanner/lib/editableImages'
import type { FileWithMetadata } from '@/types'

interface DocumentNavCardProps {
  filesWithMetadata: FileWithMetadata[]
  currentFile: FileWithMetadata
  currentFileIndex: number
  isScanWorkflow: boolean
  readyCount: number
  onRetakeCapture: (index: number) => void
  onEditCapture: (index: number) => void
  onPreviousFile: () => void
  onNextFile: () => void
}

function DocumentNavCard({ filesWithMetadata, currentFile, currentFileIndex, isScanWorkflow, readyCount, onRetakeCapture, onEditCapture, onPreviousFile, onNextFile }: DocumentNavCardProps) {
  return (
    <div className="surface-card rounded-lg p-5 mb-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold text-[#1c2f47]">
          Document {currentFileIndex + 1} of {filesWithMetadata.length}
        </h3>
        <div className="text-xs text-[#718096]">
          {readyCount} / {filesWithMetadata.length} ready
        </div>
      </div>

      {/* Current file display */}
      <div className="mb-3 flex items-center gap-3 rounded-md border border-[#e1e5ea] bg-[#f8fafc] p-3">
        {currentFile.thumbnail || currentFile.isDataUrl ? (
          <img src={currentFile.editedDataUrl || currentFile.filePath} alt="" className="h-10 w-10 rounded object-cover" />
        ) : (
          <FileText size={16} className="text-[#536d89]" />
        )}
        <span className="flex-1 text-xs font-bold text-[#263950]">{currentFile.file.name}</span>
        {isScanWorkflow && (
          <button
            type="button"
            onClick={() => onRetakeCapture(currentFileIndex)}
            className="text-xs font-bold text-[#536d89] hover:text-[#1d4778] transition"
          >
            Retake
          </button>
        )}
        {isEditableImage(currentFile) && (
            <button
              type="button"
              onClick={() => onEditCapture(currentFileIndex)}
              className="text-xs font-bold text-[#24558d] hover:text-[#1d4778] transition"
            >
              Edit Image
            </button>
        )}
      </div>

      {/* Navigation buttons */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onPreviousFile}
          disabled={currentFileIndex === 0}
          className="flex-1 inline-flex items-center justify-center gap-2 rounded-md px-3 py-2 text-xs font-bold transition focus-ring border border-[#d7dde5] bg-white text-[#34445a] hover:bg-[#f4f6f8] disabled:opacity-40 disabled:cursor-not-allowed"
        >
          ← Previous
        </button>
        <button
          type="button"
          onClick={onNextFile}
          disabled={currentFileIndex === filesWithMetadata.length - 1}
          className="flex-1 inline-flex items-center justify-center gap-2 rounded-md px-3 py-2 text-xs font-bold transition focus-ring border border-[#d7dde5] bg-white text-[#34445a] hover:bg-[#f4f6f8] disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Next →
        </button>
      </div>
    </div>
  )
}

export default DocumentNavCard
