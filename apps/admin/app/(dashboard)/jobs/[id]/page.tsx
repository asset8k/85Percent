import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { getJob, JOB_LABEL, type JobType } from '@/lib/jobs'
import { formatDateTime } from '@/lib/format'
import { Badge } from '@/components/ui/badge'

export const metadata: Metadata = { title: 'Job log' }
export const dynamic = 'force-dynamic'

export default async function JobDetailPage({ params }: { params: { id: string } }) {
  const job = await getJob(params.id)
  if (!job) notFound()
  const tone = job.status === 'success' ? 'green' : job.status === 'failed' ? 'red' : 'blue'

  return (
    <div className="max-w-3xl">
      <Link
        href="/jobs"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> All jobs
      </Link>

      <header className="mb-5">
        <h1 className="text-xl font-semibold tracking-tight">
          {JOB_LABEL[job.type as JobType] ?? job.type}
        </h1>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <Badge tone={tone} dot>
            {job.status}
          </Badge>
          <span>· started {formatDateTime(job.started_at)}</span>
          <span>· finished {formatDateTime(job.finished_at)}</span>
          <span>· by {job.triggered_by ?? '—'}</span>
        </div>
        {job.summary && <p className="mt-2 text-sm text-muted-foreground">{job.summary}</p>}
      </header>

      <h2 className="mb-2 text-sm font-semibold tracking-tight">Output</h2>
      <pre className="max-h-[60vh] overflow-auto rounded-lg border border-border bg-foreground p-4 text-xs leading-relaxed text-background">
        {job.log ?? '(no output captured)'}
      </pre>
    </div>
  )
}
