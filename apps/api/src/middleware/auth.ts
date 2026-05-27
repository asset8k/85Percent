import { randomUUID } from 'crypto'
import type { FastifyRequest, FastifyReply } from 'fastify'
import { supabase } from '../lib/supabase.js'

declare module 'fastify' {
  interface FastifyRequest {
    userId: string
    clubId: string
    userRole: string
  }
}

export async function authMiddleware(request: FastifyRequest, reply: FastifyReply) {
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
    .select('id, club_id, role')
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
    // FK cascade order: simulations + audit_logs → users.
    if (authUser.email) {
      const { data: orphans } = await supabase
        .from('users')
        .select('id')
        .eq('email', authUser.email)
        .neq('id', authUser.id)

      if (orphans && orphans.length > 0) {
        const orphanIds = orphans.map((o) => o.id as string)
        const { error: simErr } = await supabase.from('simulations').delete().in('created_by', orphanIds)
        if (simErr) {
          request.log.error({ err: simErr }, 'authMiddleware: orphan simulation cleanup failed')
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

    const newClubId = randomUUID()
    const now = new Date().toISOString()
    const { data: createdClub, error: clubCreateErr } = await supabase
      .from('clubs')
      .insert({
        id: newClubId,
        name: 'Headroom FC',
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

    const club = createdClub

    const fullName =
      (authUser.user_metadata?.['full_name'] as string | undefined) ??
      authUser.email?.split('@')[0] ??
      'New User'

    const { data: created, error: createErr } = await supabase
      .from('users')
      .insert({
        id: authUser.id,
        club_id: club.id,
        role: 'cfo',
        full_name: fullName,
        email: authUser.email,
      })
      .select('id, club_id, role')
      .single()

    if (createErr || !created) {
      request.log.error({ err: createErr }, 'authMiddleware: auto-provision failed')
      return reply.status(503).send({ error: 'Failed to provision user' })
    }
    user = created
  }

  request.userId = user.id
  request.clubId = user.club_id
  request.userRole = user.role
}
