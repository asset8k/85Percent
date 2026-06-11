import { Badge } from '@/components/ui/badge'
import type { LeadStatus } from '@/lib/leads'

/**
 * The single source of truth for how each lead status reads. Violet (brand) is
 * reserved for "New" so a fresh lead pops; everything else stays cold/quiet, with
 * a subtle green for the positive "Demo Scheduled" and grey for "Archived".
 */
const TONE: Record<LeadStatus, React.ComponentProps<typeof Badge>['tone']> = {
  New: 'violet',
  Contacted: 'blue',
  'Demo Scheduled': 'green',
  Archived: 'neutral',
}

export function StatusBadge({ status }: { status: LeadStatus }) {
  return (
    <Badge tone={TONE[status]} dot>
      {status}
    </Badge>
  )
}
