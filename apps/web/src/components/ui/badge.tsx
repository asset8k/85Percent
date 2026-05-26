import { cn } from '@/lib/utils'
import type { ComplianceStatus } from '@headroom/shared'

interface BadgeProps {
  status: ComplianceStatus
  className?: string
  children?: React.ReactNode
}

const statusConfig = {
  green: {
    label: 'Compliant',
    className: 'bg-green-100 text-green-700',
  },
  amber: {
    label: 'Levy Zone',
    className: 'bg-amber-100 text-amber-700',
  },
  red: {
    label: 'Points Risk',
    className: 'bg-red-100 text-red-700',
  },
}

export function StatusBadge({ status, className, children }: BadgeProps) {
  const config = statusConfig[status]
  return (
    <span
      className={cn(
        'inline-flex items-center whitespace-nowrap px-2.5 py-0.5 rounded-full text-xs font-medium',
        config.className,
        className
      )}
    >
      {children ?? config.label}
    </span>
  )
}
