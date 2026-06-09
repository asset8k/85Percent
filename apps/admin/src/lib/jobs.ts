/**
 * jobs — trigger the manual maintenance scripts and record their history.
 *
 * Each job spawns the corresponding api package script (so we run the EXACT same
 * code the team runs by hand) and records a row in admin_jobs: who triggered it,
 * start/finish times, status, a one-line summary and a tail of the output.
 *
 * The HTTP handler kicks a job off and returns immediately; the child process
 * runs in the background and updates its row on exit. Concurrent runs of the same
 * job type are refused so we don't double-scrape.
 */

import { spawn } from 'node:child_process'
import { supabase } from './supabase.js'
import { env } from './env.js'

export type JobType = 'sync_templates' | 'league_table'

export const JOB_LABEL: Record<JobType, string> = {
  sync_templates: 'Club & player update',
  league_table: 'League table update',
}

// The api package script behind each job.
const JOB_SCRIPT: Record<JobType, string> = {
  sync_templates: 'sync:templates',
  league_table: 'update:league',
}

const LOG_TAIL_CHARS = 12_000

export interface JobRow {
  id: string
  type: string
  status: string
  triggered_by: string | null
  summary: string | null
  log: string | null
  started_at: string
  finished_at: string | null
}

export async function listJobs(limit = 50): Promise<JobRow[]> {
  const { data } = await supabase
    .from('admin_jobs')
    .select('*')
    .order('started_at', { ascending: false })
    .limit(limit)
  return (data ?? []) as JobRow[]
}

export async function getJob(id: string): Promise<JobRow | null> {
  const { data } = await supabase.from('admin_jobs').select('*').eq('id', id).maybeSingle()
  return (data as JobRow | null) ?? null
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
 * Start a job. Returns { started, jobId, reason }. When `started` is false the
 * job was refused (e.g. one of the same type is already running).
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
  runScript(jobId, type)
  return { started: true, jobId }
}

// Spawn the api script, stream output into a buffer, and finalise the row on exit.
function runScript(jobId: string, type: JobType): void {
  const script = JOB_SCRIPT[type]
  let output = ''
  const append = (chunk: Buffer) => {
    output += chunk.toString()
    if (output.length > LOG_TAIL_CHARS) output = output.slice(-LOG_TAIL_CHARS)
  }

  let child
  try {
    child = spawn('pnpm', ['--filter', '@85percent/api', script], {
      cwd: env.repoRoot,
      env: process.env,
    })
  } catch (err) {
    void finalize(jobId, 'failed', `Failed to start: ${(err as Error).message}`, output)
    return
  }

  child.stdout.on('data', append)
  child.stderr.on('data', append)
  child.on('error', (err) => {
    void finalize(jobId, 'failed', `Process error: ${err.message}`, output)
  })
  child.on('close', (code) => {
    const ok = code === 0
    const summary = ok
      ? lastMeaningfulLine(output) || 'Completed successfully.'
      : `Exited with code ${code}. ${lastMeaningfulLine(output)}`.trim()
    void finalize(jobId, ok ? 'success' : 'failed', summary.slice(0, 500), output)
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
