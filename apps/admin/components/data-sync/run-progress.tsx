'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { estimateRemainingSeconds, formatDuration } from './ui-model'

type Detail = {
  run: Record<string, unknown>
  tasks: Array<Record<string, unknown> & { template_clubs?: { name?: string } | null }>
  changes: Array<Record<string, unknown>>
}

const TERMINAL = new Set(['SUCCEEDED', 'FAILED', 'PARTIAL_SUCCESS', 'CANCELLED'])

function elapsed(start: unknown, end?: unknown): string {
  const startMs = Date.parse(String(start))
  const endMs = end ? Date.parse(String(end)) : Date.now()
  const seconds = Math.max(0, Math.floor((endMs - startMs) / 1000))
  return formatDuration(seconds)
}

function formatReviewData(value: unknown): string {
  if (!value || typeof value !== 'object') return 'None'
  return Object.entries(value as Record<string, unknown>)
    .map(([key, item]) => `${key}: ${item == null ? '—' : String(item)}`)
    .join(' · ')
}

export function RunProgress({ initial, targetId }: { initial: Detail; targetId: string }) {
  const router = useRouter()
  const [detail, setDetail] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(async () => {
    const response = await fetch(`/api/admin/data-imports/${detail.run.id}?target=${encodeURIComponent(targetId)}`, { cache: 'no-store' })
    if (response.ok) setDetail(await response.json() as Detail)
  }, [detail.run.id])

  useEffect(() => {
    if (TERMINAL.has(String(detail.run.status))) return
    const timer = window.setInterval(load, 2500)
    return () => window.clearInterval(timer)
  }, [detail.run.status, load])

  async function action(path: string, body?: Record<string, unknown>) {
    setBusy(true); setError(null)
    const response = await fetch(`/api/admin/data-imports/${detail.run.id}/${path}`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...(body ?? {}), targetId }),
    })
    const result = await response.json().catch(() => ({})) as { error?: string }
    setBusy(false)
    if (!response.ok) setError(result.error ?? 'Action failed.')
    else await load()
  }

  async function review(changeId: string, decision: 'approve' | 'reject') {
    await action('review', { changeId, decision })
  }

  const run = detail.run
  const active = detail.tasks.filter((task) => task.status === 'RUNNING')
  const failed = detail.tasks.filter((task) => task.status === 'FAILED')
  const reviewItems = detail.changes.filter((change) => change.status === 'NEEDS_REVIEW')
  const missingItems = detail.changes.filter((change) => change.change_type === 'MISSING')
  const configuration = (run.configuration ?? {}) as Record<string, unknown>
  const remainingSeconds = estimateRemainingSeconds(
    detail.tasks,
    Number(configuration.maxConcurrentTasks ?? 1),
  )
  return <div>
    <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
      <div><div className="flex items-center gap-2"><h1 className="text-xl font-semibold">Import run</h1><Badge>{String(run.status)}</Badge></div><p className="mt-1 text-sm text-muted-foreground">{String(run.type).replaceAll('_', ' ')} via {String(run.provider)}</p></div>
      <div className="flex gap-2">
        {!TERMINAL.has(String(run.status)) && <Button variant="outline" disabled={busy} onClick={() => action('cancel')}>Cancel run</Button>}
        {failed.length > 0 && <Button disabled={busy} onClick={() => action('retry')}>Retry failed</Button>}
        <Button variant="ghost" onClick={() => router.refresh()}>Refresh</Button>
      </div>
    </div>
    {error && <p className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}
    <section className="mb-6 rounded-lg border border-border bg-card p-5">
      <div className="mb-2 flex justify-between text-sm"><span>{Number(run.completed_tasks)} of {Number(run.total_tasks)} tasks complete</span><strong>{Number(run.progress_percent)}%</strong></div>
      <div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary transition-[width]" style={{ width: `${Number(run.progress_percent)}%` }} /></div>
      <div className="mt-4 grid grid-cols-2 gap-3 text-sm md:grid-cols-6"><span>Success: {Number(run.succeeded_tasks)}</span><span>Failed: {Number(run.failed_tasks)}</span><span>Review: {reviewItems.length}</span><span>Active: {active.length}</span><span>Elapsed: {elapsed(run.created_at, run.completed_at)}</span><span>Remaining: {TERMINAL.has(String(run.status)) ? 'Complete' : remainingSeconds == null ? 'Estimating…' : formatDuration(remainingSeconds)}</span></div>
    </section>
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      {detail.tasks.map((task) => <div key={String(task.id)} className="grid grid-cols-[minmax(170px,1fr)_130px_120px_100px] items-center gap-3 border-b border-border px-4 py-3 text-sm last:border-0">
        <span className="font-medium">{task.template_clubs?.name ?? String(task.competition).replaceAll('_', ' ')}</span>
        <span>{String(task.current_stage).toLowerCase()}</span><Badge>{String(task.status)}</Badge>
        <span className="text-right text-muted-foreground">{Number(task.review_count)} review</span>
        {task.status === 'SUCCEEDED' && <p className="col-span-4 text-xs text-muted-foreground">+{Number(task.added_count)} added · {Number(task.updated_count)} updated · {Number(task.unchanged_count)} unchanged · {Number(task.missing_count)} missing · {Number(task.duration_ms) > 0 ? formatDuration(Math.ceil(Number(task.duration_ms) / 1000)) : 'duration unavailable'}</p>}
        {Boolean(task.safe_error_message) && <p className="col-span-4 text-red-700">{String(task.safe_error_message)} {task.status === 'FAILED' && <button className="ml-2 font-medium text-primary" onClick={() => action('retry', { taskId: task.id })}>Retry</button>}</p>}
      </div>)}
    </div>
    {reviewItems.length > 0 && <section className="mt-7"><h2 className="mb-3 font-semibold">Needs review</h2><div className="space-y-3">{reviewItems.map((change) => <article key={String(change.id)} className="rounded-lg border border-amber-200 bg-amber-50/40 p-4 text-sm"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0 flex-1"><strong>{String(change.entity_type)} · {String(change.change_type)}</strong><p className="mt-1 text-muted-foreground">{String(change.reason ?? 'Review before applying.')}</p><details className="mt-3"><summary className="cursor-pointer text-xs font-medium text-primary">Compare source values</summary><dl className="mt-2 space-y-1 text-xs"><div><dt className="inline font-medium">Stored: </dt><dd className="inline text-muted-foreground">{formatReviewData(change.before_data)}</dd></div><div><dt className="inline font-medium">Provider: </dt><dd className="inline text-muted-foreground">{formatReviewData(change.after_data)}</dd></div></dl></details></div><div className="flex gap-2"><Button size="sm" variant="outline" disabled={busy} onClick={() => review(String(change.id), 'reject')}>Keep current</Button>{change.change_type === 'CONFLICT' && Boolean(change.internal_entity_id) && <Button size="sm" disabled={busy} onClick={() => review(String(change.id), 'approve')}>Apply provider value</Button>}</div></div></article>)}</div></section>}
    {missingItems.length > 0 && <section className="mt-7"><h2 className="mb-3 font-semibold">Not found in this source (no action needed)</h2><div className="space-y-3">{missingItems.map((change) => <article key={String(change.id)} className="rounded-lg border border-border bg-muted/30 p-4 text-sm"><strong>{String(change.entity_type)}</strong><p className="mt-1 text-muted-foreground">{String(change.reason ?? 'The player was not present in this source response.')}</p><details className="mt-3"><summary className="cursor-pointer text-xs font-medium text-primary">Compare source values</summary><dl className="mt-2 space-y-1 text-xs"><div><dt className="inline font-medium">Stored: </dt><dd className="inline text-muted-foreground">{formatReviewData(change.before_data)}</dd></div></dl></details></article>)}</div></section>}
    <Link href={`/data-sync/squads?target=${encodeURIComponent(targetId)}`} className="mt-6 inline-block text-sm font-medium text-primary hover:underline">Back to data sync</Link>
  </div>
}
