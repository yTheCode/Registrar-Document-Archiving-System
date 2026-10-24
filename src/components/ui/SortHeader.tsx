import { ArrowDown, ArrowUp, ChevronsUpDown } from 'lucide-react'
import { cn } from '@/utils/cn'

export interface SortState {
  sortBy: string
  sortDir: 'asc' | 'desc'
}

interface SortHeaderProps {
  label: string
  column: string
  sort: SortState
  onSort: (column: string) => void
  className?: string
}

/** A <th> that toggles asc/desc sorting for its column when clicked. */
export default function SortHeader({ label, column, sort, onSort, className }: SortHeaderProps) {
  const active = sort.sortBy === column
  return (
    <th className={cn('py-2 pr-3', className)}>
      <button
        type="button"
        onClick={() => onSort(column)}
        className={cn(
          'inline-flex items-center gap-1 uppercase tracking-wide transition hover:text-[#24558d]',
          active && 'text-[#24558d]'
        )}
      >
        {label}
        {active
          ? (sort.sortDir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />)
          : <ChevronsUpDown size={12} className="opacity-40" />}
      </button>
    </th>
  )
}
