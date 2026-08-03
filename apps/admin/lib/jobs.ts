import 'server-only'
import { getSupabase } from './supabase'
import { env } from './env'

/**
 * jobs — trigger the maintenance scripts and read their history.
 *
 * The scripts run through this app's protected serverless API. The Route Handler
 * creates the job row and uses Vercel's request-lifetime background mechanism;
 * history is still read directly through the service-role Supabase client.
 */

export type JobType = 'sync_templates' | 'league_table'

export const JOB_LABEL: Record<JobType, string> = {
  sync_templates: 'Club & player update',
  league_table: 'League table update',
}

export function isJobType(v: string): v is JobType {
  return v === 'sync_templates' || v === 'league_table'
}

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
  const { data } = await getSupabase()
    .from('admin_jobs')
    .select('*')
    .order('started_at', { ascending: false })
    .limit(limit)
  return (data ?? []) as JobRow[]
}

export async function getJob(id: string): Promise<JobRow | null> {
  const { data } = await getSupabase().from('admin_jobs').select('*').eq('id', id).maybeSingle()
  return (data as JobRow | null) ?? null
}

/**
 * Start a job by asking the API to run it. When `started` is false the job was
 * refused (already running) or the API was unreachable — `reason` explains.
 */
export async function startJob(
  type: JobType,
  triggeredBy: string,
): Promise<{ started: boolean; jobId?: string; reason?: string }> {
  let res: Response
  try {
    res = await fetch(`${env.apiBaseUrl}/internal/jobs/${type}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-internal-job-secret': env.internalJobSecret,
      },
      body: JSON.stringify({ triggeredBy }),
    })
  } catch (err) {
    return { started: false, reason: `Could not reach the job runner: ${(err as Error).message}` }
  }

  const body = (await res.json().catch(() => ({}))) as {
    started?: boolean
    jobId?: string
    reason?: string
    error?: string
  }

  if (!res.ok) {
    return { started: false, reason: body.reason ?? body.error ?? `Job runner error (${res.status}).` }
  }
  return { started: Boolean(body.started), jobId: body.jobId, reason: body.reason }
}
