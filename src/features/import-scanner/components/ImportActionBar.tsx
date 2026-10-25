import type { FileWithMetadata } from '@/types'

interface ImportActionBarProps {
  filesWithMetadata: FileWithMetadata[]
  currentFileIndex: number
  isProcessing: boolean
  readyCount: number
  onCopyFromPrevious: () => void
  onResetAll: () => void
}

function ImportActionBar({ filesWithMetadata, currentFileIndex, isProcessing, readyCount, onCopyFromPrevious, onResetAll }: ImportActionBarProps) {
  return (
    <div className="flex flex-wrap gap-2 pt-4">
      {currentFileIndex > 0 && (
        <button
          type="button"
          onClick={onCopyFromPrevious}
          disabled={isProcessing}
          className="inline-flex items-center justify-center gap-2 rounded-md px-3.5 py-2 text-xs font-bold transition focus-ring border border-[#c5dff4] bg-[#eef5fb] text-[#24558d] hover:bg-[#dceafb] disabled:opacity-50"
        >
          Copy Details from Previous
        </button>
      )}
      <button
        type="button"
        onClick={onResetAll}
        disabled={isProcessing}
        className="flex-1 inline-flex items-center justify-center gap-2 rounded-md px-3.5 py-2 text-xs font-bold transition focus-ring border border-[#d7dde5] bg-white text-[#34445a] hover:bg-[#f4f6f8] disabled:opacity-50"
      >
        Cancel
      </button>
      <button
        type="submit"
        disabled={isProcessing || filesWithMetadata.length === 0 || readyCount < filesWithMetadata.length}
        title={
          filesWithMetadata.length === 0
            ? 'Select or scan at least one document before saving.'
            : readyCount < filesWithMetadata.length
              ? 'Some documents still need attention — see the review table above.'
              : undefined
        }
        className="flex-1 inline-flex items-center justify-center gap-2 rounded-md px-3.5 py-2 text-xs font-bold transition focus-ring disabled:opacity-50 bg-[#24558d] text-white hover:bg-[#1d4778]"
      >
        {isProcessing
          ? 'Importing Batch...'
          : filesWithMetadata.length === 0
            ? 'No documents to save'
            : readyCount === filesWithMetadata.length
              ? `Save ${filesWithMetadata.length} Document${filesWithMetadata.length !== 1 ? 's' : ''}`
              : `${readyCount} of ${filesWithMetadata.length} documents ready`}
      </button>
    </div>
  )
}

export default ImportActionBar
