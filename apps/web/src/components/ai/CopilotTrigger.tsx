/**
 * CopilotTrigger — the "Ask the Analyst" affordance for the context-aware
 * triggers in Dashboard / Roster / Scenarios.
 *
 * The button variant is built on the UI-Kit <Button> (outline) so it matches the
 * height and styling of every other button in the app; the icon variant is for
 * dense table rows (revealed on row hover so it isn't repeated everywhere).
 */

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { SparkIcon } from '@/components/ai/icons'

export function CopilotTriggerButton({
  onClick,
  label = 'Ask the Analyst',
  size = 'default',
  className,
}: {
  onClick: () => void
  label?: string
  size?: 'sm' | 'default' | 'lg'
  className?: string
}) {
  return (
    <Button type="button" variant="outline" size={size} onClick={onClick} className={cn('gap-1.5', className)}>
      <SparkIcon size={size === 'sm' ? 15 : 17} />
      {label}
    </Button>
  )
}

export function CopilotTriggerIcon({
  onClick,
  title = 'Ask the Analyst',
  className,
}: {
  onClick: () => void
  title?: string
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      title={title}
      aria-label={title}
      className={cn(
        'inline-flex h-7 w-7 items-center justify-center rounded-lg text-violet-600 transition-colors hover:bg-violet-100',
        className,
      )}
    >
      <SparkIcon size={15} />
    </button>
  )
}
