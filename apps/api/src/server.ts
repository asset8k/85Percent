import Fastify from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import { clubRoutes } from './routes/club.js'
import { simulationRoutes } from './routes/simulations.js'
import { rosterRoutes } from './routes/roster.js'

const app = Fastify({
  logger: {
    level: process.env['NODE_ENV'] === 'production' ? 'warn' : 'info',
    redact: ['req.headers.authorization'], // Never log auth tokens
  },
})

async function start() {
  await app.register(helmet)
  await app.register(cors, {
    origin: process.env['FRONTEND_URL'] ?? 'http://localhost:5173',
    credentials: true,
  })
  await app.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
    // Key by IP — JWT-based keying would reset on every token refresh, defeating the limit.
    keyGenerator: (req) => req.ip,
  })

  await app.register(clubRoutes)
  await app.register(simulationRoutes)
  await app.register(rosterRoutes)

  app.setErrorHandler((error: Error & { statusCode?: number }, request, reply) => {
    request.log.error({ err: error, url: request.url }, 'Unhandled error')
    const statusCode = error.statusCode ?? 500
    return reply.status(statusCode).send({
      error: statusCode === 500 ? 'Internal server error' : error.message,
    })
  })

  // Override rate limit for calculation endpoint
  app.addHook('onRoute', (routeOptions) => {
    if (routeOptions.url === '/simulations' && routeOptions.method === 'POST') {
      routeOptions.config = { rateLimit: { max: 30, timeWindow: '1 minute' } }
    }
  })

  app.get('/health', async () => ({ status: 'ok', ts: new Date().toISOString() }))

  const port = parseInt(process.env['PORT'] ?? '3001', 10)
  await app.listen({ port, host: '0.0.0.0' })
}

start().catch((err) => {
  console.error(err)
  process.exit(1)
})
