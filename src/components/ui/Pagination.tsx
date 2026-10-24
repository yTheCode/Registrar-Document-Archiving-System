import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/utils/cn'

interface PaginationProps {
  page: number          // 1-based current page
  pageSize: number
  total: number         // total record count across all pages
  onPageChange: (page: number) => void
  className?: string
}

/** Compact page-number list with ellipsis, e.g. 1 … 4 5 6 … 20. */
function pageItems(page: number, totalPages: number): Array<number | 'gap'> {
  if (totalPages <= 7) {
    return Array.from({ length: totalPages }, (_, i) => i + 1)
  }
  const items: Array<number | 'gap'> = [1]
  const start = Math.max(2, page - 1)
  const end = Math.min(totalPages - 1, page + 1)
  if (start > 2) items.push('gap')
  for (let p = start; p <= end; p++) items.push(p)
  if (end < totalPages - 1) items.push('gap')
  items.push(totalPages)
  return items
}

export default function Pagination({ page, pageSize, total, onPageChange, className }: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))
  const current = Math.min(Math.max(1, page), totalPages)
  const from = total === 0 ? 0 : (current - 1) * pageSize + 1
  const to = Math.min(total, current * pageSize)

  const baseBtn =
    'inline-flex h-8 min-w-8 items-center justify-center rounded-md border px-2 text-xs font-semibold transition'
  const idleBtn = 'border-[#d7dde5] bg-white text-[#34445a] hover:bg-[#f4f6f8]'
  const activeBtn = 'border-[#24558d] bg-[#24558d] text-white'
  const disabledBtn = 'border-[#e5e8ec] bg-[#f7f8fa] text-[#b6bec9] cursor-not-allowed'

  return (
    <div className={cn('flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between', className)}>
      <div className="text-xs text-[#718096]">
        Showing <span className="font-bold text-[#263950]">{from}–{to}</span> of{' '}
        <span className="font-bold text-[#263950]">{total.toLocaleString()}</span> results
      </div>
      {totalPages > 1 && (
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onPageChange(current - 1)}
            disabled={current === 1}
            className={cn(baseBtn, current === 1 ? disabledBtn : idleBtn)}
            aria-label="Previous page"
          >
            <ChevronLeft size={14} />
          </button>
          {pageItems(current, totalPages).map((item, idx) =>
            item === 'gap' ? (
              <span key={`gap-${idx}`} className="px-1 text-xs text-[#a4adba]">…</span>
            ) : (
              <button
                key={item}
                type="button"
                onClick={() => onPageChange(item)}
                className={cn(baseBtn, item === current ? activeBtn : idleBtn)}
                aria-current={item === current ? 'page' : undefined}
              >
                {item}
              </button>
            )
          )}
          <button
            type="button"
            onClick={() => onPageChange(current + 1)}
            disabled={current === totalPages}
            className={cn(baseBtn, current === totalPages ? disabledBtn : idleBtn)}
            aria-label="Next page"
          >
            <ChevronRight size={14} />
          </button>
        </div>
      )}
    </div>
  )
}
