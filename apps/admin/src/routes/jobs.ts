/**
 * Jobs — trigger the two manual maintenance scripts (club/player sync, league
 * table update) and view the full run history with timestamps + output logs.
 */

import type { FastifyInstance } from 'fastify'
import { requireAuth, isAuthed } from '../lib/auth.js'
import { env } from '../lib/env.js'
import { html, page, esc } from '../lib/html.js'
import { formatDate } from '../lib/format.js'
import { listJobs, getJob, startJob, JOB_LABEL, type JobType } from '../lib/jobs.js'

function statusPill(status: string): ReturnType<typeof html> {
  const cls = status === 'success' ? 'ok' : status === 'failed' ? 'fail' : 'run'
  return html`<span class="pill ${cls}">${status}</span>`
}

export async function jobRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth)

  app.get('/jobs', async (request, reply) => {
    const jobs = await listJobs()
    const q = request.query as { flash?: string; msg?: string }
    const fk = q.flash
    const flash =
      fk === 'ok' || fk === 'err' ? { kind: fk as 'ok' | 'err', message: q.msg ?? '' } : undefined

    const body = html`
      <h1>Maintenance jobs</h1>
      <p class="muted">Run the manual update scripts. Each run is recorded below with its output.</p>

      <div class="card">
        <div class="actions">
          <form method="post" action="/jobs/run/sync_templates">
            <button type="submit">▷ Run ${JOB_LABEL.sync_templates}</button>
          </form>
          <form method="post" action="/jobs/run/league_table">
            <button type="submit">▷ Run ${JOB_LABEL.league_table}</button>
          </form>
        </div>
        <p class="muted" style="margin-bottom:0">
          Club &amp; player update refreshes the onboarding squad templates (Transfermarkt).
          League table update fetches standings and publishes them as the active table.
        </p>
      </div>

      <h2>History</h2>
      <table>
        <thead><tr><th>Job</th><th>Status</th><th>Started</th><th>Finished</th><th>Summary</th><th></th></tr></thead>
        <tbody>
          ${jobs.length === 0 ? html`<tr><td colspan="6" class="muted">No jobs run yet.</td></tr>` : ''}
          ${jobs.map((j) => html`
            <tr>
              <td>${JOB_LABEL[j.type as JobType] ?? j.type}</td>
              <td>${statusPill(j.status)}</td>
              <td class="muted">${formatDate(j.started_at)}</td>
              <td class="muted">${formatDate(j.finished_at)}</td>
              <td class="muted">${j.summary ?? '—'}</td>
              <td><a href="/jobs/${j.id}">Log →</a></td>
            </tr>
          `)}
        </tbody>
      </table>
    `
    reply.type('text/html').send(page({ title: 'Jobs', active: 'jobs', body, flash }))
  })

  app.get('/jobs/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const job = await getJob(id)
    if (!job) return reply.code(404).type('text/html').send(page({ title: 'Not found', body: html`<h1>Job not found</h1><p><a href="/jobs">← Back</a></p>` }))
    const body = html`
      <p><a href="/jobs">← All jobs</a></p>
      <h1>${JOB_LABEL[job.type as JobType] ?? job.type}</h1>
      <p>${statusPill(job.status)} · started ${formatDate(job.started_at)} · finished ${formatDate(job.finished_at)} · by ${esc(job.triggered_by ?? '—')}</p>
      ${job.summary ? html`<p class="muted">${job.summary}</p>` : ''}
      <h2>Output</h2>
      <pre>${esc(job.log ?? '(no output captured)')}</pre>
    `
    reply.type('text/html').send(page({ title: 'Job', active: 'jobs', body }))
  })

  app.post('/jobs/run/:type', async (request, reply) => {
    const { type } = request.params as { type: string }
    if (type !== 'sync_templates' && type !== 'league_table') {
      return reply.redirect('/jobs?flash=err&msg=' + encodeURIComponent('Unknown job type.'))
    }
    const username = isAuthed(request) ? env.adminUsername : 'unknown'
    const result = await startJob(type, username)
    if (!result.started) {
      return reply.redirect('/jobs?flash=err&msg=' + encodeURIComponent(result.reason ?? 'Could not start job.'))
    }
    return reply.redirect('/jobs?flash=ok&msg=' + encodeURIComponent(`${JOB_LABEL[type]} started. Refresh for progress.`))
  })
}
