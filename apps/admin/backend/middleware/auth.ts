import type { ApiRequest, ApiReply } from '../serverless/types'
import { supabase } from '../lib/supabase'
import { resolveAppUser, supabaseProvisioningStore } from './provision'

export async function authMiddleware(request: ApiRequest, reply: ApiReply) {
  const authHeader = request.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) {
    return reply.status(401).send({ error: 'Missing or invalid authorization header' })
  }

  const token = authHeader.slice(7)

  let authUser: { id: string; email?: string; user_metadata?: Record<string, unknown> }
  try {
    const { data, error } = await supabase.auth.getUser(token)
    if (error || !data.user) {
      return reply.status(401).send({ error: 'Invalid or expired token' })
    }
    authUser = {
      id: data.user.id,
      email: data.user.email,
      user_metadata: data.user.user_metadata,
    }
  } catch {
    return reply.status(401).send({ error: 'Token validation failed' })
  }

  // A valid Supabase Auth token is not enough on its own — the request also
  // needs the application user (club membership + permission grants). On a brand
  // new account that row does not exist yet, so this provisions it. It is
  // idempotent and race-safe, which matters because the first authenticated page
  // load fires several requests in parallel and every one of them lands here
  // before any row exists. See provision.ts.
  const outcome = await resolveAppUser(supabaseProvisioningStore(supabase), authUser, request.log)
  if (!outcome.ok) {
    return reply.status(outcome.status).send({ error: outcome.error })
  }

  request.userId = outcome.user.id
  request.clubId = outcome.user.club_id
  request.permissions = {
    canEditRoster: !!outcome.user.can_edit_roster,
    canEditScenarios: !!outcome.user.can_edit_scenarios,
    isWorkspaceAdmin: !!outcome.user.is_workspace_admin,
  }
}
