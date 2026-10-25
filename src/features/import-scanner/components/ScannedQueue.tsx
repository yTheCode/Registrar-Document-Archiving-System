import { FileText } from 'lucide-react'
import type { FileWithMetadata } from '@/types'

interface ScannedQueueProps {
  filesWithMetadata: FileWithMetadata[]
  onEditCapture: (index: number) => void
  onRetakeCapture: (index: number) => void
  onDeleteCapture: (index: number) => void
}

function ScannedQueue({ filesWithMetadata, onEditCapture, onRetakeCapture, onDeleteCapture }: ScannedQueueProps) {
  return (
    <div className="surface-card rounded-lg p-5">
      <h3 className="text-sm font-bold text-[#1c2f47] mb-1">Scanned Documents</h3>
      <p className="mb-4 text-xs text-[#718096]">
        {filesWithMetadata.length} document{filesWithMetadata.length !== 1 ? 's' : ''} scanned — preview, edit, delete, or retake any capture. The camera stays on until you finish scanning.
      </p>
      <div className="flex flex-wrap gap-3">
        {filesWithMetadata.map((f, i) => (
          <div key={f.tempId} className="w-32 rounded-md border border-[#e1e5ea] bg-white p-2">
            <div className="mb-1.5 flex h-20 items-center justify-center overflow-hidden rounded bg-[#f1f4f7]">
              {f.thumbnail || f.isDataUrl ? (
                <img src={f.editedDataUrl || f.filePath} alt={f.file.name} className="max-h-20 object-contain" />
              ) : (
                <FileText size={22} className="text-[#8a97a7]" />
              )}
            </div>
            <div className="mono text-[10px] text-[#536d89]">#{i + 1}</div>
            <div className="mt-1 flex flex-wrap gap-1.5 text-[10px] font-bold">
              <button onClick={() => onEditCapture(i)} className="text-[#24558d] hover:underline">Edit</button>
              <button onClick={() => onRetakeCapture(i)} className="text-[#536d89] hover:underline">Retake</button>
              <button onClick={() => onDeleteCapture(i)} className="text-[#b94843] hover:underline">Delete</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default ScannedQueue
