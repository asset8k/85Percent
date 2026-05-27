/**
 * RBAC — role-based access control for Fastify routes.
 *
 * Usage:
 *   app.post('/invites', { preHandler: requireRole('cfo', 'admin') }, handler)
 *
 * Always pair with authMiddleware (which runs first and attaches userRole).
 * Returns 403 on mismatch — NOT 404 (the route exists; the caller just isn't
 * authorised). 404 is reserved for "this resource does not exist for this club"
 * patterns (e.g. the PL-only SSR guard).
 */

import type { FastifyRequest, FastifyReply, preHandlerHookHandler } from 'fastify'

export type AppRole = 'cfo' | 'sporting_director' | 'finance_analyst' | 'admin'

/** Role matrix from mvp_2.0_plan.md §5.2. */
export const ROLE_LABEL: Record<AppRole, string> = {
  cfo:               'CFO',
  admin:             'Admin',
  sporting_director: 'Sporting Director',
  finance_analyst:   'Finance Analyst',
}

/** Fastify preHandler that enforces the role list. Includes admin implicitly
 *  in every check — admin is reserved for Headroom internal staff. */
export function requireRole(...allowed: AppRole[]): preHandlerHookHandler {
  // Always allow admin
  const full = new Set<AppRole>([...allowed, 'admin'])
  return async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.userRole) {
      return reply.status(401).send({ error: 'Unauthenticated' })
    }
    if (!full.has(request.userRole as AppRole)) {
      return reply.status(403).send({ error: 'Insufficient permissions' })
    }
  }
}

/** Inline check for handlers that branch by role mid-request (e.g. the
 *  scenarios PATCH endpoint, where rename is allowed for everyone but
 *  isIncluded toggle is restricted). Returns true if allowed. */
export function hasRole(role: string | undefined, ...allowed: AppRole[]): boolean {
  if (!role) return false
  if (role === 'admin') return true
  return (allowed as readonly string[]).includes(role)
}
