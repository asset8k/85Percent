import type { Metadata } from 'next'
import { Inbox, Sparkles, CalendarCheck } from 'lucide-react'
import { listLeads } from '@/lib/leads.server'
import { MetricCard } from '@/components/metric-card'
import { LeadsTable } from '@/components/leads/leads-table'

export const metadata: Metadata = { title: 'Inbound Leads' }

// Always reflect the latest rows — this is an operational inbox, never cached.
export const dynamic = 'force-dynamic'

export default async function LeadsPage() {
  const { leads, counts, error } = await listLeads()

  return (
    <div>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">Inbound Leads</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Demo and access requests from the 85Percent landing page.
          </p>
        </div>
      </header>

      <section className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <MetricCard
          label="Total leads"
          value={counts.total}
          hint="All time"
          icon={<Inbox className="h-4 w-4" />}
        />
        <MetricCard
          label="New leads"
          value={counts.New}
          hint="Awaiting first contact"
          accent
          icon={<Sparkles className="h-4 w-4" />}
        />
        <MetricCard
          label="Demos scheduled"
          value={counts['Demo Scheduled']}
          hint="In the pipeline"
          icon={<CalendarCheck className="h-4 w-4" />}
        />
      </section>

      {error ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800">
          Could not load leads: {error}
        </div>
      ) : (
        <LeadsTable leads={leads} />
      )}
    </div>
  )
}
