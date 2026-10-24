import type { LucideIcon } from 'lucide-react'

interface EmptyStateProps {
  icon: LucideIcon
  title: string
  body: string
}

function EmptyState({ icon: Icon, title, body }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <div className="mb-3 rounded-full bg-[#edf2f7] p-3 text-[#6c8199]">
        <Icon size={21} />
      </div>
      <div className="text-sm font-bold text-[#34445a]">{title}</div>
      <p className="mt-1 max-w-xs text-xs leading-5 text-[#8a96a5]">{body}</p>
    </div>
  )
}

export default EmptyState
