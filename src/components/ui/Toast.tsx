import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { AlertCircle, CheckCircle2, Info, X } from 'lucide-react'
import { cn } from '@/utils/cn'

type ToastKind = 'error' | 'success' | 'info'

interface Toast {
  id: number
  kind: ToastKind
  message: string
}

interface ToastContextValue {
  showToast: (message: string, kind?: ToastKind) => void
  showError: (message: string) => void
  showSuccess: (message: string) => void
  showInfo: (message: string) => void
}

const ToastContext = createContext<ToastContextValue | null>(null)

const KIND_STYLES: Record<ToastKind, { wrap: string; icon: ReactNode }> = {
  error: {
    wrap: 'border-[#f0b4b0] bg-[#fff0ef] text-[#8a2f2b]',
    icon: <AlertCircle size={18} className="shrink-0 text-[#b94843]" />
  },
  success: {
    wrap: 'border-[#a9dcc4] bg-[#e5f5ee] text-[#1f6b4f]',
    icon: <CheckCircle2 size={18} className="shrink-0 text-[#2b9b72]" />
  },
  info: {
    wrap: 'border-[#c5dff4] bg-[#eef5fb] text-[#1d4778]',
    icon: <Info size={18} className="shrink-0 text-[#24558d]" />
  }
}

let nextId = 1

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])

  const dismiss = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  const showToast = useCallback((message: string, kind: ToastKind = 'error') => {
    if (!message) return
    setToasts(prev => [...prev, { id: nextId++, kind, message }])
  }, [])

  const value = useMemo<ToastContextValue>(() => ({
    showToast,
    showError: (message: string) => showToast(message, 'error'),
    showSuccess: (message: string) => showToast(message, 'success'),
    showInfo: (message: string) => showToast(message, 'info')
  }), [showToast])

  return (
    <ToastContext.Provider value={value}>
      {children}
      {/* Persistent toasts: no auto-dismiss, stay until the user closes them. */}
      <div className="pointer-events-none fixed bottom-5 right-5 z-[9998] flex w-[min(380px,calc(100vw-2.5rem))] flex-col gap-2">
        {toasts.map(t => {
          const style = KIND_STYLES[t.kind]
          return (
            <div
              key={t.id}
              role="alert"
              className={cn(
                'slide-in pointer-events-auto flex items-start gap-3 rounded-lg border px-4 py-3 shadow-lg',
                style.wrap
              )}
            >
              {style.icon}
              <div className="flex-1 text-xs font-semibold leading-relaxed">{t.message}</div>
              <button
                type="button"
                onClick={() => dismiss(t.id)}
                className="shrink-0 rounded p-0.5 opacity-70 transition hover:opacity-100"
                aria-label="Dismiss notification"
              >
                <X size={16} />
              </button>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within a ToastProvider')
  return ctx
}
