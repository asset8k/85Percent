import 'server-only'
import { cookies } from 'next/headers'
import { redirect } from 'next/navigation'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { env } from './env'

/**
 * session — single-admin auth via a signed, httpOnly cookie. Credentials live in
 * env (ADMIN_USERNAME / ADMIN_PASSWORD); a successful login sets a cookie whose
 * value is HMAC-signed with ADMIN_SESSION_SECRET, so it can't be forged client
 * side. No coupling to the platform's user auth.
 *
 * Cookie writes (`setSession` / `clearSession`) must be called from a Server
 * Action or Route Handler — Next forbids mutating cookies during render. Reads
 * (`isAuthed` / `requireSession`) work anywhere on the server.
 */

const COOKIE = 'admin_session'
const MAX_AGE_S = 60 * 60 * 12 // 12h

function constantTimeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

/** Constant-time check of submitted credentials against the configured admin. */
export function checkCredentials(username: string, password: string): boolean {
  return (
    constantTimeEqual(username, env.adminUsername) &&
    constantTimeEqual(password, env.adminPassword)
  )
}

function sign(value: string): string {
  const mac = createHmac('sha256', env.sessionSecret).update(value).digest('base64url')
  return `${value}.${mac}`
}

function unsign(signed: string | undefined): string | null {
  if (!signed) return null
  const dot = signed.lastIndexOf('.')
  if (dot < 0) return null
  const value = signed.slice(0, dot)
  const mac = signed.slice(dot + 1)
  const expected = createHmac('sha256', env.sessionSecret).update(value).digest('base64url')
  if (!constantTimeEqual(mac, expected)) return null
  return value
}

export function isAuthed(): boolean {
  return unsign(cookies().get(COOKIE)?.value) === env.adminUsername
}

export function setSession(): void {
  cookies().set(COOKIE, sign(env.adminUsername), {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: env.isProd,
    maxAge: MAX_AGE_S,
  })
}

export function clearSession(): void {
  cookies().delete(COOKIE)
}

/** Guard for protected layouts/pages — redirects to /login when unauthenticated. */
export function requireSession(): void {
  if (!isAuthed()) redirect('/login')
}
