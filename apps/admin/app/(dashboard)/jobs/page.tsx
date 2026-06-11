import type { Metadata } from 'next'
import Link from 'next/link'
import { Play, ArrowRight } from 'lucide-react'
import { listJobs, JOB_LABEL, type JobType } from '@/lib/jobs'
import { formatDateTime } from '@/lib/format'
import { runJob } from '@/app/actions/jobs'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table'
import { Flash } from '@/components/flash'

export const metadata: Metadata = { title: 'Maintenance jobs' }
export const dynamic = 'force-dynamic'

function JobStatus({ status }: { status: string }) {
  const tone = status === 'success' ? 'green' : status === 'failed' ? 'red' : 'blue'
  return (
    <Badge tone={tone} dot>
      {status}
    </Badge>
  )
}

export default async function JobsPage({
  searchParams,
}: {
  searchParams: { flash?: string; msg?: string }
}) {
  const jobs = await listJobs()

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">Maintenance jobs</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Run the manual update scripts. Each run is recorded below with its output.
        </p>
      </header>

      <Flash kind={searchParams.flash} message={searchParams.msg} />

      <Card className="mb-7">
        <CardContent className="pt-5">
          <div className="flex flex-wrap gap-3">
            <form action={runJob}>
              <input type="hidden" name="type" value="sync_templates" />
              <Button type="submit">
                <Play className="h-4 w-4" /> Run {JOB_LABEL.sync_templates}
              </Button>
            </form>
            <form action={runJob}>
              <input type="hidden" name="type" value="league_table" />
              <Button type="submit" variant="outline">
                <Play className="h-4 w-4" /> Run {JOB_LABEL.league_table}
              </Button>
            </form>
          </div>
          <p className="mt-4 text-sm text-muted-foreground">
            Club &amp; player update refreshes the onboarding squad templates (Transfermarkt). League
            table update fetches standings and publishes them as the active table.
          </p>
        </CardContent>
      </Card>

      <h2 className="mb-3 text-sm font-semibold tracking-tight">History</h2>
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Job</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Started</TableHead>
              <TableHead>Finished</TableHead>
              <TableHead>Summary</TableHead>
              <TableHead className="w-[60px] text-right" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {jobs.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                  No jobs run yet.
                </TableCell>
              </TableRow>
            ) : (
              jobs.map((j) => (
                <TableRow key={j.id}>
                  <TableCell className="font-medium">
                    {JOB_LABEL[j.type as JobType] ?? j.type}
                  </TableCell>
                  <TableCell>
                    <JobStatus status={j.status} />
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDateTime(j.started_at)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatDateTime(j.finished_at)}
                  </TableCell>
                  <TableCell className="max-w-xs truncate text-muted-foreground">
                    {j.summary ?? '—'}
                  </TableCell>
                  <TableCell className="text-right">
                    <Link
                      href={`/jobs/${j.id}`}
                      className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                    >
                      Log <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
