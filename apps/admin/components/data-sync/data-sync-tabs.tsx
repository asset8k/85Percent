import Link from 'next/link'
import { cn } from '@/lib/utils'

export function DataSyncTabs({ active }: { active: 'squads' | 'standings' }) {
  return (
    <nav className="mb-6 flex gap-1 rounded-lg border border-border bg-muted/35 p-1" aria-label="Data sync sections">
      <Link href="/data-sync/squads" className={cn('rounded-md px-4 py-2 text-sm font-medium', active === 'squads' ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground')}>Squads &amp; coaches</Link>
      <Link href="/data-sync/standings" className={cn('rounded-md px-4 py-2 text-sm font-medium', active === 'standings' ? 'bg-background shadow-sm' : 'text-muted-foreground hover:text-foreground')}>League tables</Link>
    </nav>
  )
}
