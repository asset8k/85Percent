import { useEffect } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { create } from 'zustand'
import { cn } from '@/lib/utils'

// Lightweight toast system. Imperatively call `toast.success(...)` etc. from
// anywhere; the host (mounted once in AppLayout) renders the stack.
export type ToastTone = 'success' | 'error' | 'info'

export interface ToastItem {
  id: number
  tone: ToastTone
  message: string
  /** Optional small line under the message. */
  description?: string
}

interface ToastState {
  items: ToastItem[]
  push: (t: Omit<ToastItem, 'id'>) => number
  dismiss: (id: number) => void
}

const useToastStore = create<ToastState>((set) => ({
  items: [],
  push: (t) => {
    const id = Date.now() + Math.random()
    set((s) => ({ items: [...s.items, { ...t, id }] }))
    return id
  },
  dismiss: (id) => set((s) => ({ items: s.items.filter((i) => i.id !== id) })),
}))

// Imperative façade — usable from any file without hooks.
export const toast = {
  success: (message: string, description?: string) =>
    useToastStore.getState().push({ tone: 'success', message, description }),
  error: (message: string, description?: string) =>
    useToastStore.getState().push({ tone: 'error', message, description }),
  info: (message: string, description?: string) =>
    useToastStore.getState().push({ tone: 'info', message, description }),
}

const TONE_STYLES: Record<ToastTone, { box: string; ring: string; icon: string }> = {
  success: {
    box: 'bg-white border-green-200',
    ring: 'bg-green-500',
    icon: 'text-green-600',
  },
  error: {
    box: 'bg-white border-red-200',
    ring: 'bg-red-500',
    icon: 'text-red-600',
  },
  info: {
    box: 'bg-white border-violet-200',
    ring: 'bg-violet-500',
    icon: 'text-violet-600',
  },
}

export function ToastHost() {
  const items = useToastStore((s) => s.items)
  const dismiss = useToastStore((s) => s.dismiss)
  return (
    <div className="fixed top-4 right-4 z-[200] flex flex-col gap-2 pointer-events-none">
      <AnimatePresence initial={false}>
        {items.map((item) => (
          <ToastRow key={item.id} item={item} onDismiss={() => dismiss(item.id)} />
        ))}
      </AnimatePresence>
    </div>
  )
}

const TOAST_TIMEOUT_MS = 3800

function ToastRow({ item, onDismiss }: { item: ToastItem; onDismiss: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, TOAST_TIMEOUT_MS)
    return () => clearTimeout(t)
  }, [onDismiss])

  const styles = TONE_STYLES[item.tone]
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: -12, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, x: 24, transition: { duration: 0.18 } }}
      transition={{ type: 'spring', stiffness: 380, damping: 28 }}
      className={cn(
        'pointer-events-auto relative overflow-hidden rounded-xl border shadow-lg pl-4 pr-3 py-3 min-w-[260px] max-w-[360px] flex items-start gap-3',
        styles.box,
      )}
    >
      {/* Tone ring on the left edge */}
      <span className={cn('absolute left-0 top-0 bottom-0 w-1', styles.ring)} aria-hidden="true" />
      <div className={cn('mt-0.5', styles.icon)}>
        {item.tone === 'success' && (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 6 9 17l-5-5" />
          </svg>
        )}
        {item.tone === 'error' && (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 8v4" /><path d="M12 16h.01" />
          </svg>
        )}
        {item.tone === 'info' && (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <path d="M12 16v-4" /><path d="M12 8h.01" />
          </svg>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-[13px] font-medium text-slate-900 leading-tight">{item.message}</div>
        {item.description && (
          <div className="text-[12px] text-slate-500 mt-0.5 leading-snug">{item.description}</div>
        )}
      </div>
      <button
        type="button"
        onClick={onDismiss}
        className="text-slate-400 hover:text-slate-700 transition-colors p-1 -m-1 rounded"
        aria-label="Dismiss"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 6 6 18" /><path d="M6 6l12 12" />
        </svg>
      </button>
    </motion.div>
  )
}
