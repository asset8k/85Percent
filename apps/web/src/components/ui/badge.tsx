import { motion } from 'framer-motion'
import { cn } from '@/lib/utils'
import type { ComplianceStatus } from '@headroom/shared'

interface BadgeProps {
  status: ComplianceStatus
  className?: string
  children?: React.ReactNode
}

// Tone palette — both background and foreground animate when the status flips
// (e.g. SCR slipping from green to amber). Hex values match the original
// Tailwind classes so the visual identity is unchanged at rest.
const statusConfig = {
  green: { label: 'Compliant',   bg: '#dcfce7', fg: '#15803d' }, // green-100 / green-700
  amber: { label: 'Levy Zone',   bg: '#fef3c7', fg: '#b45309' }, // amber-100 / amber-700
  red:   { label: 'Points Risk', bg: '#fee2e2', fg: '#b91c1c' }, // red-100   / red-700
}

export function StatusBadge({ status, className, children }: BadgeProps) {
  const config = statusConfig[status]
  return (
    <motion.span
      initial={false}
      animate={{ backgroundColor: config.bg, color: config.fg }}
      transition={{ duration: 0.35, ease: 'easeOut' }}
      className={cn(
        'inline-flex items-center whitespace-nowrap px-2.5 py-0.5 rounded-full text-xs font-medium',
        className,
      )}
    >
      {children ?? config.label}
    </motion.span>
  )
}
