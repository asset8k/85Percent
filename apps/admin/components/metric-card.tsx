import { cn } from '@/lib/utils'

/** A compact KPI tile: big tabular number, quiet label, optional accent + hint. */
export function MetricCard({
  label,
  value,
  hint,
  accent = false,
  icon,
}: {
  label: string
  value: React.ReactNode
  hint?: string
  accent?: boolean
  icon?: React.ReactNode
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-5">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</p>
        {icon && <span className="text-muted-foreground">{icon}</span>}
      </div>
      <p
        className={cn(
          'tabular mt-2 text-3xl font-semibold tracking-tight',
          accent ? 'text-primary' : 'text-foreground',
        )}
      >
        {value}
      </p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}
