import { AsyncLocalStorage } from 'node:async_hooks'
import { format } from 'node:util'
import { waitUntil } from '@vercel/functions'
import { supabase } from './supabase'

/**
 * jobs — run the manual maintenance scripts in-process and record their history.
 *
 * The admin Route Handler creates the `admin_jobs` row and schedules the work
 * with Vercel `waitUntil`, which keeps the function alive after the response.
 * Locally, `next dev` is a persistent process so the promise can run directly.
 * The API route exports a 300-second maximum duration; jobs must remain inside
 * that bound and are finalised in the database for the polling admin UI.
 *
 * Script stdout/stderr is captured per-job via AsyncLocalStorage so two jobs of
 * different types running at once keep separate logs.
 */

export type JobType = 'sync_templates' | 'league_table'

export const JOB_LABEL: Record<JobType, string> = {
  sync_templates: 'Club & player update',
  league_table: 'League table update',
}

// The script `main()` behind each job, imported lazily so the server start path
// never pulls in the scraper/embedding deps these workers need.
const JOB_RUNNERS: Record<JobType, () => Promise<void>> = {
  sync_templates: async () => {
    const mod = await import('../scripts/sync-templates')
    await mod.main()
  },
  league_table: async () => {
    const mod = await import('../scripts/update-league-table')
    await mod.main()
  },
}

export function isJobType(v: string): v is JobType {
  return v === 'sync_templates' || v === 'league_table'
}

const LOG_TAIL_CHARS = 12_000

// ── per-job console capture ─────────────────────────────────────────────────
const logStore = new AsyncLocalStorage<{ append: (s: string) => void }>()
let consolePatched = false

/** Patch console once so any output emitted inside a job's async context is
 * also appended to that job's log buffer, while still printing to the server. */
function patchConsole(): void {
  if (consolePatched) return
  consolePatched = true
  for (const method of ['log', 'info', 'warn', 'error'] as const) {
    const original = console[method].bind(console)
    console[method] = (...args: unknown[]) => {
      logStore.getStore()?.append(format(...args) + '\n')
      original(...args)
    }
  }
}

async function isRunning(type: JobType): Promise<boolean> {
  const { data } = await supabase
    .from('admin_jobs')
    .select('id, started_at')
    .eq('type', type)
    .eq('status', 'running')
    .order('started_at', { ascending: false })
    .limit(5)

  const staleBefore = Date.now() - 10 * 60_000
  let active = false
  for (const row of data ?? []) {
    const startedAt = Date.parse(String(row.started_at))
    if (Number.isFinite(startedAt) && startedAt >= staleBefore) {
      active = true
      continue
    }
    await supabase
      .from('admin_jobs')
      .update({
        status: 'failed',
        summary: 'Timed out before the serverless worker could finish.',
        finished_at: new Date().toISOString(),
      })
      .eq('id', row.id)
      .eq('status', 'running')
  }
  return active
}

/**
 * Start a job: refuse if one of the same type is already running, otherwise
 * insert the `running` row and kick off the script in the background.
 */
export async function startJob(
  type: JobType,
  triggeredBy: string,
): Promise<{ started: boolean; jobId?: string; reason?: string }> {
  if (await isRunning(type)) {
    return { started: false, reason: `A ${JOB_LABEL[type]} job is already running.` }
  }

  const { data: row, error } = await supabase
    .from('admin_jobs')
    .insert({ type, status: 'running', triggered_by: triggeredBy })
    .select('id')
    .single()
  if (error || !row) return { started: false, reason: 'Could not create the job record.' }

  const jobId = row.id as string
  const task = runJob(jobId, type)
  if (process.env['VERCEL']) {
    waitUntil(task)
  } else {
    void task
  }
  return { started: true, jobId }
}

// Run the script's main() in the background, capturing its log, and finalise.
async function runJob(jobId: string, type: JobType): Promise<void> {
  patchConsole()

  let output = ''
  const append = (chunk: string) => {
    output += chunk
    if (output.length > LOG_TAIL_CHARS) output = output.slice(-LOG_TAIL_CHARS)
  }

  // Run inside the ALS context so the script's console output lands in `output`.
  await logStore.run({ append }, async () => {
    try {
      await JOB_RUNNERS[type]()
      await finalize(jobId, 'success', lastMeaningfulLine(output) || 'Completed successfully.', output)
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      const summary = `Failed: ${message}. ${lastMeaningfulLine(output)}`.trim().slice(0, 500)
      await finalize(jobId, 'failed', summary, output)
    }
  })
}

async function finalize(
  jobId: string,
  status: 'success' | 'failed',
  summary: string,
  log: string,
): Promise<void> {
  await supabase
    .from('admin_jobs')
    .update({ status, summary, log, finished_at: new Date().toISOString() })
    .eq('id', jobId)
}

function lastMeaningfulLine(output: string): string {
  const lines = output.split('\n').map((l) => l.trim()).filter(Boolean)
  return lines[lines.length - 1] ?? ''
}
