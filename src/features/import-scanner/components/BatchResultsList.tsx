import { cn } from '@/utils/cn'
import type { BatchResult } from '@/types'

interface BatchResultsListProps {
  batchResults: BatchResult[]
}

function BatchResultsList({ batchResults }: BatchResultsListProps) {
  return (
    <div className="border-t border-[#e1e5ea] pt-4">
      <h4 className="text-xs font-bold text-[#1c2f47] mb-2">Import Results:</h4>
      <div className="space-y-1 max-h-32 overflow-y-auto">
        {batchResults.map((result, idx) => (
          <div
            key={idx}
            className={cn(
              'text-xs px-2 py-1 rounded',
              result.success
                ? 'bg-[#e5f5ee] text-[#2b9b72]'
                : 'bg-[#fff0ef] text-[#b94843]'
            )}
          >
            {result.success ? '✓' : '✗'} {result.filePath}
            {result.error && ` — ${result.error}`}
          </div>
        ))}
      </div>
    </div>
  )
}

export default BatchResultsList
