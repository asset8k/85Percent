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

  // Self-heal: a row may exist under the same email but with a stale auth id
  // (e.g. user was deleted from auth.users and re-created). Re-link it.
  if (!user && authUser.email) {
    const { data: byEmail } = await supabase
      .from('users')
      .select('id, club_id, role')
      .eq('email', authUser.email)
      .maybeSingle()

    if (byEmail) {
      const { error: relinkErr } = await supabase
        .from('users')
        .update({ id: authUser.id })
        .eq('id', byEmail.id)
      if (relinkErr) {
        request.log.error({ err: relinkErr }, 'authMiddleware: user relink failed')
        return reply.status(503).send({ error: 'Database unavailable' })
      }
      user = { id: authUser.id, club_id: byEmail.club_id, role: byEmail.role }
    }
  }

  // Auto-provision: brand-new auth user with no app record → attach to a club as CFO.
  // If no club exists yet, create one named "Headroom FC". MVP-only behaviour;
  // replace with an invite + workspace-creation flow later.
  if (!user) {
    let { data: club } = await supabase
      .from('clubs')
      .select('id')
      .limit(1)
      .maybeSingle()

    if (!club) {
      const newClubId = randomUUID()
      const { data: createdClub, error: clubCreateErr } = await supabase
        .from('clubs')
        .insert({
          id: newClubId,
          name: 'Headroom FC',
          short_name: 'HFC',
          league_id: 'efl-championship',
        })
        .select('id')
        .single()

      if (clubCreateErr || !createdClub) {
        request.log.error({ err: clubCreateErr }, 'authMiddleware: club auto-create failed')
        return reply.status(503).send({ error: 'Failed to provision workspace' })
      }
      club = createdClub
    }

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
