import { CheckCircle2, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Flash — a transient result banner driven by `?flash=ok|err&msg=…` search params,
 * the pattern the post-action redirects use. Renders nothing when absent.
 */
export function Flash({ kind, message }: { kind?: string; message?: string }) {
  if ((kind !== 'ok' && kind !== 'err') || !message) return null
  const ok = kind === 'ok'
  const Icon = ok ? CheckCircle2 : AlertTriangle
  return (
    <div
      className={cn(
        'mb-5 flex items-start gap-2.5 rounded-md border px-4 py-3 text-sm',
        ok
          ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
          : 'border-red-200 bg-red-50 text-red-800',
      )}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <span>{message}</span>
    </div>
  )
}
