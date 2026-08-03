import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'

interface LimitConfig {
  max: number
  timeWindow: string
}

const limiters = new Map<string, Ratelimit>()

function configured(): boolean {
  return Boolean(
    process.env['UPSTASH_REDIS_REST_URL'] &&
    process.env['UPSTASH_REDIS_REST_TOKEN'],
  )
}

function windowFor(value: string): Parameters<typeof Ratelimit.slidingWindow>[1] {
  const normalized = value.trim().toLowerCase()
  if (normalized === '1 minute') return '1 m'
  if (normalized === '1 hour') return '1 h'
  return '1 m'
}

export async function checkApiRateLimit(
  identifier: string,
  routeKey: string,
  config: LimitConfig,
): Promise<'allowed' | 'limited' | 'unconfigured'> {
  if (!configured()) return 'unconfigured'

  const key = `${routeKey}:${config.max}:${config.timeWindow}`
  let limiter = limiters.get(key)
  if (!limiter) {
    limiter = new Ratelimit({
      redis: Redis.fromEnv(),
      limiter: Ratelimit.slidingWindow(config.max, windowFor(config.timeWindow)),
      prefix: `ratelimit:api:${routeKey}`,
    })
    limiters.set(key, limiter)
  }

  const { success } = await limiter.limit(identifier)
  return success ? 'allowed' : 'limited'
}
