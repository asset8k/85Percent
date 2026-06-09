import { motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import type { ComplianceStatus } from '@85percent/shared'

interface BadgeProps {
  status: ComplianceStatus
  className?: string
  children?: React.ReactNode
}

// Tone palette — both background and foreground animate when the status flips
// (e.g. SCR slipping from green to amber). Hex values match the original
// Tailwind classes so the visual identity is unchanged at rest. The default
// label (used when no children are passed) is localized via `common.status.*`.
const statusConfig = {
  green: { labelKey: 'common.status.compliant', bg: '#dcfce7', fg: '#15803d' }, // green-100 / green-700
  amber: { labelKey: 'common.status.levyZone',  bg: '#fef3c7', fg: '#b45309' }, // amber-100 / amber-700
  red:   { labelKey: 'common.status.pointsRisk', bg: '#fee2e2', fg: '#b91c1c' }, // red-100   / red-700
}

export function StatusBadge({ status, className, children }: BadgeProps) {
  const { t } = useTranslation()
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
      {children ?? t(config.labelKey)}
    </motion.span>
  )
}
