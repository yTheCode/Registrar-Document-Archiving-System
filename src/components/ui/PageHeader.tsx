import type { ReactNode } from 'react'

interface PageHeaderProps {
  eyebrow: string
  title: string
  description?: string
  actions?: ReactNode
}

function PageHeader({ eyebrow, title, description, actions }: PageHeaderProps) {
  return (
    <div className="mb-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div>
        <div className="label-caps mb-2">{eyebrow}</div>
        <h1 className="text-[25px] font-bold tracking-[-.04em] text-[#182a43]">
          {title}
        </h1>
        {description && (
          <p className="mt-1.5 text-sm text-[#718096]">{description}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  )
}

export default PageHeader
