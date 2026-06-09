/**
 * 85Percent Admin — a standalone, server-rendered Fastify control panel.
 *
 * Separate from the platform (its own port, its own session auth) but talks to
 * the same Supabase project via the service-role key. Lets an operator:
 *   • view + manage user accounts (name, email, password, delete),
 *   • view + top up each user's AI chat credit balance,
 *   • run the manual maintenance scripts (club/player sync, league table) and
 *     see a full run history with timestamps + logs.
 *
 * Run: pnpm --filter @85percent/admin dev   (http://localhost:4000)
 */

import Fastify from 'fastify'
import cookie from '@fastify/cookie'
import formbody from '@fastify/formbody'
import { env } from './lib/env.js'
import { authRoutes } from './routes/auth.js'
import { userRoutes } from './routes/users.js'
import { jobRoutes } from './routes/jobs.js'

async function main() {
  const app = Fastify({ logger: { level: env.isProd ? 'info' : 'warn' } })

  await app.register(cookie, { secret: env.sessionSecret })
  await app.register(formbody) // parse application/x-www-form-urlencoded posts

  await app.register(authRoutes)
  await app.register(userRoutes)
  await app.register(jobRoutes)

  app.get('/', async (_request, reply) => reply.redirect('/users'))

  await app.listen({ port: env.port, host: '0.0.0.0' })
  // eslint-disable-next-line no-console
  console.log(`85Percent Admin → http://localhost:${env.port}`)
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Admin server failed to start:', err)
  process.exit(1)
})
