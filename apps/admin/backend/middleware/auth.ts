import { randomUUID } from 'crypto'
import type { ApiRequest, ApiReply } from '../serverless/types'
import { supabase } from '../lib/supabase'
import type { Permissions } from './permissions'

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

  let { data: user, error } = await supabase
    .from('users')
    .select('id, club_id, can_edit_roster, can_edit_scenarios, is_workspace_admin')
    .eq('id', authUser.id)
    .maybeSingle()

  if (error) {
    request.log.error({ err: error }, 'authMiddleware: user lookup failed')
    return reply.status(503).send({ error: 'Database unavailable' })
  }

  // Auto-provision: brand-new auth user → always create a fresh club + user record.
  // Every signup gets an isolated workspace; no cross-account data sharing.
  if (!user) {
    // Clean up any orphaned rows from a previous account with the same email
    // (Supabase Auth deletes auth.users but leaves public.users + FK refs behind).
    // FK cascade order for MVP 2.0:
    //   scenarios.created_by   → users.id  (scenario_actions cascade via scenarios FK)
    //   audit_logs.user_id     → users.id
    // then we can drop the users row itself.
    if (authUser.email) {
      const { data: orphans } = await supabase
        .from('users')
        .select('id')
        .eq('email', authUser.email)
        .neq('id', authUser.id)

      if (orphans && orphans.length > 0) {
        const orphanIds = orphans.map((o) => o.id as string)

        const { error: scenarioErr } = await supabase.from('scenarios').delete().in('created_by', orphanIds)
        if (scenarioErr) {
          request.log.error({ err: scenarioErr }, 'authMiddleware: orphan scenario cleanup failed')
          return reply.status(503).send({ error: 'Failed to clean up previous account data' })
        }
        const { error: auditErr } = await supabase.from('audit_logs').delete().in('user_id', orphanIds)
        if (auditErr) {
          request.log.error({ err: auditErr }, 'authMiddleware: orphan audit_log cleanup failed')
          return reply.status(503).send({ error: 'Failed to clean up previous account data' })
        }
        const { error: userErr } = await supabase.from('users').delete().in('id', orphanIds)
        if (userErr) {
          request.log.error({ err: userErr }, 'authMiddleware: orphan user cleanup failed')
          return reply.status(503).send({ error: 'Failed to clean up previous account data' })
        }
      }
    }

    // ── Phase 5: honour a pending invite by email before creating a new club ──
    // If this email was invited, join the invite's club inheriting its explicit
    // permission grants instead of provisioning a fresh isolated workspace.
    let inviteMatch: {
      id: string; club_id: string
      title: string | null
      can_edit_roster: boolean; can_edit_scenarios: boolean; is_workspace_admin: boolean
    } | null = null
    if (authUser.email) {
      const { data: invite } = await supabase
        .from('invites')
        .select('id, club_id, title, can_edit_roster, can_edit_scenarios, is_workspace_admin, expires_at')
        .eq('email', authUser.email)
        .is('accepted_at', null)
        .gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (invite) {
        inviteMatch = {
          id: invite.id, club_id: invite.club_id,
          title: (invite.title as string | null) ?? null,
          can_edit_roster: !!invite.can_edit_roster,
          can_edit_scenarios: !!invite.can_edit_scenarios,
          is_workspace_admin: !!invite.is_workspace_admin,
        }
      }
    }

    const now = new Date().toISOString()
    let targetClubId: string

    if (inviteMatch) {
      targetClubId = inviteMatch.club_id
    } else {
      // Founder path — fresh isolated workspace
      const newClubId = randomUUID()
      const { data: createdClub, error: clubCreateErr } = await supabase
        .from('clubs')
        .insert({
          id: newClubId,
          name: '85Percent FC',
          short_name: 'HFC',
          league_id: 'efl-championship',
          created_at: now,
          updated_at: now,
        })
        .select('id')
        .single()

      if (clubCreateErr || !createdClub) {
        request.log.error({ err: clubCreateErr }, 'authMiddleware: club auto-create failed')
        return reply.status(503).send({ error: 'Failed to provision workspace' })
      }
      targetClubId = createdClub.id
    }

    const fullName =
      (authUser.user_metadata?.['full_name'] as string | undefined) ??
      authUser.email?.split('@')[0] ??
      'New User'

    // Invitees inherit the invite's explicit grants. A founder (no invite)
    // provisioning their own workspace is the workspace admin with full access.
    const grants = inviteMatch
      ? {
          title: inviteMatch.title,
          can_edit_roster: inviteMatch.can_edit_roster,
          can_edit_scenarios: inviteMatch.can_edit_scenarios,
          is_workspace_admin: inviteMatch.is_workspace_admin,
        }
      : { title: null, can_edit_roster: true, can_edit_scenarios: true, is_workspace_admin: true }

    const { data: created, error: createErr } = await supabase
      .from('users')
      .insert({
        id: authUser.id,
        club_id: targetClubId,
        full_name: fullName,
        email: authUser.email,
        ...grants,
      })
      .select('id, club_id, can_edit_roster, can_edit_scenarios, is_workspace_admin')
      .single()

    if (createErr || !created) {
      request.log.error({ err: createErr }, 'authMiddleware: auto-provision failed')
      return reply.status(503).send({ error: 'Failed to provision user' })
    }
    user = created

    // Mark the invite as accepted on the same request that created the user.
    // Non-fatal: if this fails the invite remains usable, which is harmless
    // (the user record already exists; the duplicate-email check in /invites
    // would block a second use).
    if (inviteMatch) {
      const { error: acceptErr } = await supabase
        .from('invites')
        .update({ accepted_at: now })
        .eq('id', inviteMatch.id)
      if (acceptErr) request.log.warn({ err: acceptErr }, 'authMiddleware: invite accept update failed')
    }
  }

  request.userId = user.id
  request.clubId = user.club_id
  request.permissions = {
    canEditRoster: !!user.can_edit_roster,
    canEditScenarios: !!user.can_edit_scenarios,
    isWorkspaceAdmin: !!user.is_workspace_admin,
  }
}
