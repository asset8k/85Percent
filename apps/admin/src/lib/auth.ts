/**
 * auth — single-admin session via a signed cookie. The admin's credentials live
 * in env (ADMIN_USERNAME / ADMIN_PASSWORD); a successful login sets a signed,
 * httpOnly cookie that every protected route checks. No platform-user coupling.
 */

import { timingSafeEqual } from 'node:crypto'
import type { FastifyReply, FastifyRequest } from 'fastify'
import { env } from './env.js'

const COOKIE = 'admin_session'

// Constant-time string compare that won't throw on length mismatch.
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a)
  const bb = Buffer.from(b)
  if (ab.length !== bb.length) return false
  return timingSafeEqual(ab, bb)
}

/** Verify a submitted username + password against the configured admin. */
export function checkCredentials(username: string, password: string): boolean {
  return safeEqual(username, env.adminUsername) && safeEqual(password, env.adminPassword)
}

/** Set the signed session cookie after a successful login. */
export function startSession(reply: FastifyReply): void {
  reply.setCookie(COOKIE, env.adminUsername, {
    signed: true,
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    secure: env.isProd,
    maxAge: 60 * 60 * 12, // 12h
  })
}

export function endSession(reply: FastifyReply): void {
  reply.clearCookie(COOKIE, { path: '/' })
}

export function isAuthed(request: FastifyRequest): boolean {
  const raw = request.cookies[COOKIE]
  if (!raw) return false
  const result = request.unsignCookie(raw)
  return result.valid && result.value === env.adminUsername
}

/** preHandler guard — redirect unauthenticated requests to the login page. */
export async function requireAuth(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!isAuthed(request)) {
    return reply.redirect('/login')
  }
}
