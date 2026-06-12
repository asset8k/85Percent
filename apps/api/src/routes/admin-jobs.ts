/**
 * Internal jobs route — lets the admin panel trigger the maintenance scripts
 * over HTTP instead of spawning a child process (which can't run on a serverless
 * host). Server-to-server only:
 *
 *   POST /internal/jobs/:type   body: { triggeredBy?: string }
 *
 * Auth is a shared secret in the `x-internal-job-secret` header, compared in
 * constant time. This is NOT a user-facing endpoint and carries no Supabase
 * session — only the admin backend (holding INTERNAL_JOB_SECRET) may call it.
 * Fails closed: if the server secret isn't configured, every request is denied.
 */

import { timingSafeEqual } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { startJob, isJobType } from '../lib/jobs.js'

const SECRET_HEADER = 'x-internal-job-secret'

/** Constant-time secret compare that tolerates length differences. */
function secretMatches(provided: string | undefined, expected: string): boolean {
  if (!provided) return false
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

export async function adminJobRoutes(app: FastifyInstance) {
  app.post<{ Params: { type: string }; Body: { triggeredBy?: string } }>(
    '/internal/jobs/:type',
    async (request, reply) => {
      const expected = process.env['INTERNAL_JOB_SECRET']
      if (!expected) {
        request.log.error('INTERNAL_JOB_SECRET is not set — refusing job trigger')
        return reply.status(503).send({ error: 'Job runner not configured.' })
      }
      if (!secretMatches(request.headers[SECRET_HEADER] as string | undefined, expected)) {
        return reply.status(401).send({ error: 'Unauthorized.' })
      }

      const { type } = request.params
      if (!isJobType(type)) {
        return reply.status(400).send({ error: 'Unknown job type.' })
      }

      const triggeredBy = request.body?.triggeredBy?.slice(0, 200) || 'admin'
      const result = await startJob(type, triggeredBy)
      if (!result.started) {
        // A refusal (e.g. already running) is a 409, not a server error.
        return reply.status(409).send({ started: false, reason: result.reason })
      }
      return reply.send({ started: true, jobId: result.jobId })
    },
  )
}
