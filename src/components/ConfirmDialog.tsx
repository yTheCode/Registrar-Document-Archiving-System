import { useEffect, useRef } from 'react'
import { AlertTriangle } from 'lucide-react'
import { cn } from '@/utils/cn'

export interface ConfirmDialogProps {
  title: string
  message: string
  confirmLabel?: string
  danger?: boolean
  onConfirm: () => void
  onCancel: () => void
}

// In-app replacement for window.confirm. Native dialogs on Windows Electron
// can leave the renderer without keyboard focus after they close, so no page
// may call window.confirm/alert/prompt anymore.
function ConfirmDialog({ title, message, confirmLabel = 'Confirm', danger = false, onConfirm, onCancel }: ConfirmDialogProps) {
  const confirmRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Autofocus the safe default (Cancel keeps focus; Tab reaches Confirm)
    confirmRef.current?.focus()
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onCancel()
        return
      }
      if (e.key === 'Tab' && dialogRef.current) {
        // Cycle focus between the dialog's buttons — it has no other
        // tabbable content, so wrap instead of letting focus escape
        const buttons = Array.from(
          dialogRef.current.querySelectorAll<HTMLButtonElement>('button')
        )
        if (buttons.length === 0) return
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
        e.preventDefault()
        const next = e.shiftKey
          ? (index <= 0 ? buttons.length - 1 : index - 1)
          : (index === -1 || index === buttons.length - 1 ? 0 : index + 1)
        buttons[next].focus()
      }
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [onCancel])

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-[#0f1b2d]/45 p-4"
      onClick={onCancel}
    >
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        className="slide-in w-full max-w-sm rounded-lg bg-white p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start gap-3">
          <div
            className={cn(
              'flex h-9 w-9 shrink-0 items-center justify-center rounded-full',
              danger ? 'bg-[#fdf0ef] text-[#b94843]' : 'bg-[#fff6df] text-[#b17f22]'
            )}
          >
            <AlertTriangle size={17} />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-[#1c2f47]">{title}</h2>
            <p className="mt-1 whitespace-pre-line text-xs leading-relaxed text-[#617084]">{message}</p>
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button
            ref={confirmRef}
            onClick={onCancel}
            className="rounded-md border border-[#d9dfe7] px-3.5 py-2 text-xs font-bold text-[#4a5568] transition hover:bg-[#f5f7fa] focus-ring"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className={cn(
              'rounded-md px-3.5 py-2 text-xs font-bold text-white transition focus-ring',
              danger ? 'bg-[#b94843] hover:bg-[#a03d39]' : 'bg-[#24558d] hover:bg-[#1d4778]'
            )}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

export default ConfirmDialog
