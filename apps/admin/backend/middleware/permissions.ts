/**
 * Permission-based access control for serverless API routes (MVP 2.1).
 *
 * Replaces the old enum-role RBAC. A member carries three explicit boolean
 * grants — there is no implicit hierarchy. Each route protects itself by naming
 * the exact permission it needs:
 *
 *   app.post('/invites', { preHandler: requirePermission('isWorkspaceAdmin') }, handler)
 *   app.post('/roster',  { preHandler: requirePermission('canEditRoster') },    handler)
 *
 * Always pair with authMiddleware (which runs first and attaches request.permissions).
 * Returns 403 on a missing grant — NOT 404 (the route exists; the caller just
 * isn't authorised). 404 stays reserved for "this resource does not exist for
 * this club" patterns (e.g. the PL-only SSR guard).
 */

import type { ApiRequest, ApiReply, PreHandler } from '../serverless/types'

export type Permission = 'canEditRoster' | 'canEditScenarios' | 'isWorkspaceAdmin'

export interface Permissions {
  canEditRoster: boolean
  canEditScenarios: boolean
  isWorkspaceAdmin: boolean
}

/** Human-readable labels for the permission tags shown in the Team UI. */
export const PERMISSION_LABEL: Record<Permission, string> = {
  canEditRoster:    'Edit Roster',
  canEditScenarios: 'Edit Scenarios',
  isWorkspaceAdmin: 'Workspace Admin',
}

/** Route pre-handler that enforces a single permission grant. A workspace
 *  admin implicitly satisfies every check — admins can do anything. */
export function requirePermission(permission: Permission): PreHandler {
  return async (request: ApiRequest, reply: ApiReply) => {
    if (!request.permissions) {
      return reply.status(401).send({ error: 'Unauthenticated' })
    }
    if (request.permissions.isWorkspaceAdmin) return // admin overrides everything
    if (!request.permissions[permission]) {
      return reply.status(403).send({ error: 'Insufficient permissions' })
    }
  }
}

/** Inline check for handlers that branch mid-request (e.g. the scenarios PATCH
 *  endpoint). Workspace admins always pass. */
export function hasPermission(
  permissions: Permissions | undefined,
  permission: Permission,
): boolean {
  if (!permissions) return false
  if (permissions.isWorkspaceAdmin) return true
  return permissions[permission]
}
