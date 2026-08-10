import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'

/**
 * Per-IP rate limiting for the public lead form (spec: invite-only, anti-spam).
 *
 * Backed by Upstash Redis so the limit is **distributed and persistent** — it
 * holds across serverless instances and cold starts, unlike the previous
 * in-memory counter (which reset on every new lambda). A sliding window of
 * 10 submissions per hour per IP is strict on purpose: a real club fills the
 * form once; anything past 10/hr from one address is abuse.
 *
 * The limiter is created lazily as a module singleton and reads its credentials
 * from the environment (UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN via
 * `Redis.fromEnv()`). `analytics` is left off to keep each check to a single
 * round-trip.
 */
let limiter: Ratelimit | null = null

function getLimiter(): Ratelimit {
  if (!limiter) {
    limiter = new Ratelimit({
      redis: Redis.fromEnv(),
      limiter: Ratelimit.slidingWindow(10, '1 h'),
      prefix: 'ratelimit:demo-request',
    })
  }
  return limiter
}

/** Returns `{ success: false }` when this IP has exceeded 10 submissions in the
 *  trailing hour. The IP is the identifier the window is keyed on. */
export async function checkRateLimit(ip: string): Promise<{ success: boolean }> {
  const { success } = await getLimiter().limit(ip)
  return { success }
}
