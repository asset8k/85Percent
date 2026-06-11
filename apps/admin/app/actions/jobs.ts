'use server'

import { redirect } from 'next/navigation'
import { requireSession } from '@/lib/session'
import { env } from '@/lib/env'
import { startJob, isJobType, JOB_LABEL } from '@/lib/jobs'

const flash = (kind: 'ok' | 'err', msg: string) =>
  `/jobs?flash=${kind}&msg=${encodeURIComponent(msg)}`

/** Trigger a maintenance job, then redirect back to the jobs list with a banner. */
export async function runJob(formData: FormData): Promise<void> {
  requireSession()
  const type = String(formData.get('type') ?? '')
  if (!isJobType(type)) redirect(flash('err', 'Unknown job type.'))

  const result = await startJob(type, env.adminUsername)
  if (!result.started) {
    redirect(flash('err', result.reason ?? 'Could not start job.'))
  }
  redirect(flash('ok', `${JOB_LABEL[type]} started. Refresh for progress.`))
}
