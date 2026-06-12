import { AsyncLocalStorage } from 'node:async_hooks'
import { format } from 'node:util'
import { supabase } from './supabase.js'

/**
 * jobs — run the manual maintenance scripts in-process and record their history.
 *
 * Previously the admin panel spawned `pnpm --filter @85percent/api <script>` as a
 * child process. That cannot run on a serverless host (no pnpm, no monorepo on
 * disk). The work now lives here, on the long-running API: the admin panel POSTs
 * to `/internal/jobs/:type` and this module creates the `admin_jobs` row, runs
 * the script's exported `main()` in the background, and finalises the row on
 * completion. The caller returns immediately with the job id; the admin panel
 * polls `admin_jobs` (which it reads directly) for progress.
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
    const mod = await import('../scripts/sync-templates.js')
    await mod.main()
  },
  league_table: async () => {
    const mod = await import('../scripts/update-league-table.js')
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
    .select('id')
    .eq('type', type)
    .eq('status', 'running')
    .limit(1)
  return (data?.length ?? 0) > 0
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
  runJob(jobId, type)
  return { started: true, jobId }
}

// Run the script's main() in the background, capturing its log, and finalise.
function runJob(jobId: string, type: JobType): void {
  patchConsole()

  let output = ''
  const append = (chunk: string) => {
    output += chunk
    if (output.length > LOG_TAIL_CHARS) output = output.slice(-LOG_TAIL_CHARS)
  }

  // Run inside the ALS context so the script's console output lands in `output`.
  logStore.run({ append }, () => {
    JOB_RUNNERS[type]()
      .then(() => {
        void finalize(jobId, 'success', lastMeaningfulLine(output) || 'Completed successfully.', output)
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : String(err)
        const summary = `Failed: ${message}. ${lastMeaningfulLine(output)}`.trim().slice(0, 500)
        void finalize(jobId, 'failed', summary, output)
      })
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
