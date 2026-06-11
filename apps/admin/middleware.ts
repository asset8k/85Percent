import { NextResponse, type NextRequest } from 'next/server'

/**
 * Edge auth gate for the admin panel — defence in depth.
 *
 * The (dashboard) layout already calls `requireSession()` server-side, so pages
 * are never protected by client routing alone. This middleware runs *before* any
 * page or Server Action code, at the edge, so an unauthenticated request is
 * turned away before a single byte of protected RSC payload is generated, and so
 * a route someone forgets to wrap in the guarded layout can't silently leak.
 *
 * It verifies the same signed cookie `lib/session.ts` issues: value is
 * `${username}.${HMAC_SHA256(username, ADMIN_SESSION_SECRET)}` (base64url, no
 * padding). We recompute the MAC with Web Crypto (the edge runtime has no
 * node:crypto) and require both a matching signature and the configured
 * username. Anything missing, malformed, or mis-signed → redirect to /login.
 * Fails closed: if the server secret/username aren't configured, deny.
 *
 * Note: this is NOT the platform's Supabase user auth. The admin panel has its
 * own single-operator credential scheme, independent of club user sessions.
 */

const COOKIE = 'admin_session'

const toBytes = (s: string) => new TextEncoder().encode(s)

/** base64url(no padding) of an ArrayBuffer — matches Node's digest('base64url'). */
function base64url(buf: ArrayBuffer): string {
  let bin = ''
  const bytes = new Uint8Array(buf)
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function hmac(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    toBytes(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  return base64url(await crypto.subtle.sign('HMAC', key, toBytes(value)))
}

/** Constant-time string compare (avoid leaking the MAC via early-exit timing). */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

async function isAuthed(cookie: string | undefined): Promise<boolean> {
  const secret = process.env['ADMIN_SESSION_SECRET']
  const username = process.env['ADMIN_USERNAME']
  if (!secret || !username || !cookie) return false

  const dot = cookie.lastIndexOf('.')
  if (dot < 0) return false
  const value = cookie.slice(0, dot)
  const mac = cookie.slice(dot + 1)
  if (value !== username) return false

  const expected = await hmac(secret, value)
  return timingSafeEqual(mac, expected)
}

export async function middleware(req: NextRequest) {
  const authed = await isAuthed(req.cookies.get(COOKIE)?.value)
  if (authed) return NextResponse.next()

  const url = req.nextUrl.clone()
  url.pathname = '/login'
  url.search = ''
  return NextResponse.redirect(url)
}

/**
 * Guard everything except the login page and framework/static assets. /login must
 * stay open so the sign-in page and its Server Action are reachable while logged
 * out; static and image optimiser paths never carry protected data.
 */
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icon.svg|login).*)'],
}
