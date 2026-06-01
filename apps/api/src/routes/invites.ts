/**
 * Invite routes — Phase 5.
 *
 * Three CFO-only endpoints (POST/GET/DELETE) + one public lookup endpoint
 * (GET /invites/lookup?token=…) used by the signup flow before the invitee
 * has an authenticated session.
 *
 * The CFO creates an invite → frontend displays the invite link → invitee
 * follows the link → signs up via the standard 8-digit OTP flow → first call
 * to authMiddleware sees the new auth user, checks invites by email, and
 * links them to the right club + role.
 *
 * Email delivery: MVP 2.0 returns the invite link to the inviter for
 * copy/paste. Production should wire this to Supabase mailer or Resend.
 */

import { randomBytes, randomUUID } from 'crypto'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { supabase } from '../lib/supabase.js'
import { authMiddleware } from '../middleware/auth.js'
import { requireRole } from '../middleware/roles.js'
import { writeAuditLog } from '../lib/audit.js'

const INVITE_TTL_DAYS = 7
function expiryFromNow(days = INVITE_TTL_DAYS): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString()
}

function generateToken(): string {
  // 32 random bytes → 43-char URL-safe base64 — long enough that brute forcing
  // a single token in the 7-day window is infeasible.
  return randomBytes(32).toString('base64url')
}

const CreateInviteBody = z.object({
  email: z.string().trim().toLowerCase().email('Invalid email'),
  role: z.enum(['cfo', 'sporting_director', 'finance_analyst']),
})

function shapeInvite(row: Record<string, unknown>): {
  id: string; clubId: string; email: string; role: string;
  invitedBy: string; expiresAt: string; acceptedAt: string | null; createdAt: string;
  token?: string  // included only when CFO creates / fetches an actively pending invite
} {
  return {
    id: String(row['id']),
    clubId: String(row['club_id']),
    email: String(row['email']),
    role: String(row['role']),
    invitedBy: String(row['invited_by']),
    expiresAt: String(row['expires_at']),
    acceptedAt: (row['accepted_at'] as string | null) ?? null,
    createdAt: String(row['created_at']),
  }
}

export async function inviteRoutes(app: FastifyInstance) {
  // -------------------------------------------------------------------- PUBLIC LOOKUP
  // GET /invites/lookup?token=… — NO auth required.
  // Returns just enough to populate the signup form (email + club + role).
  // Service role bypasses RLS here on purpose; the token *is* the credential.
  app.get('/invites/lookup', async (request, reply) => {
    const token = (request.query as Record<string, string>)['token']
    if (!token || typeof token !== 'string' || token.length < 16) {
      return reply.status(400).send({ error: 'Invalid token' })
    }

    try {
      const { data, error } = await supabase
        .from('invites')
        .select('id, email, role, expires_at, accepted_at, club:clubs!club_id(name)')
        .eq('token', token)
        .maybeSingle()

      if (error) throw error
      if (!data) return reply.status(404).send({ error: 'Invitation not found' })
      if (data.accepted_at) return reply.status(410).send({ error: 'Invitation already accepted' })
      if (new Date(String(data.expires_at)).getTime() < Date.now()) {
        return reply.status(410).send({ error: 'Invitation expired' })
      }

      // Supabase typings infer the joined relation as an array; in practice
      // there's exactly one club because of the FK.
      const clubRel = data.club as unknown as ({ name: string } | { name: string }[] | null)
      const clubName = Array.isArray(clubRel) ? clubRel[0]?.name : clubRel?.name
      return reply.send({
        email: data.email,
        role: data.role,
        clubName: clubName ?? 'a club',
        expiresAt: data.expires_at,
      })
    } catch (err) {
      request.log.error({ err }, 'GET /invites/lookup failed')
      return reply.status(500).send({ error: 'Failed to look up invitation' })
    }
  })

  // -------------------------------------------------------------------- AUTHENTICATED
  // The rest of the routes require auth + CFO role.
  app.register(async (scoped) => {
    scoped.addHook('preHandler', authMiddleware)

    // POST /invites — create a new invite (CFO only)
    scoped.post('/invites', { preHandler: requireRole('cfo') }, async (request, reply) => {
      const parsed = CreateInviteBody.safeParse(request.body)
      if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() })

      const { email, role } = parsed.data

      try {
        // Reject if the email is already a member of any club
        const { data: existingUser } = await supabase
          .from('users')
          .select('id, club_id')
          .eq('email', email)
          .maybeSingle()
        if (existingUser) {
          return reply.status(409).send({
            error: 'A user with this email already exists. Ask them to sign in instead.',
          })
        }

        // Reject if there's an active pending invite for this email + club
        const { data: existingInvite } = await supabase
          .from('invites')
          .select('id, expires_at, accepted_at')
          .eq('club_id', request.clubId)
          .eq('email', email)
          .is('accepted_at', null)
          .gt('expires_at', new Date().toISOString())
          .maybeSingle()
        if (existingInvite) {
          return reply.status(409).send({
            error: 'A pending invite for this email already exists. Revoke it before sending a new one.',
          })
        }

        const inviteId = randomUUID()
        const token = generateToken()
        const expiresAt = expiryFromNow()
        const nowISO = new Date().toISOString()

        const { error: insErr } = await supabase.from('invites').insert({
          id: inviteId,
          club_id: request.clubId,
          email,
          role,
          invited_by: request.userId,
          token,
          expires_at: expiresAt,
          created_at: nowISO,
        })
        if (insErr) throw insErr

        await writeAuditLog(request, 'invites', inviteId, 'create', { email, role })

        return reply.status(201).send({
          id: inviteId,
          email,
          role,
          token,             // returned ONLY at creation time — CFO copies into the invite link
          expiresAt,
        })
      } catch (err) {
        request.log.error({ err }, 'POST /invites failed')
        return reply.status(500).send({ error: 'Failed to create invitation' })
      }
    })

    // GET /invites — list invites for the calling club (CFO only)
    scoped.get('/invites', { preHandler: requireRole('cfo') }, async (request, reply) => {
      try {
        const { data, error } = await supabase
          .from('invites')
          .select('id, club_id, email, role, invited_by, token, expires_at, accepted_at, created_at')
          .eq('club_id', request.clubId)
          .order('created_at', { ascending: false })

        if (error) throw error

        const now = Date.now()
        const invites = (data ?? []).map((row) => {
          const expired = new Date(String(row.expires_at)).getTime() < now
          const accepted = row.accepted_at !== null
          return {
            ...shapeInvite(row),
            // Surface the invite link directly for the CFO to copy. Once the
            // invite is accepted or expired this is no-op anyway.
            token: !accepted && !expired ? String(row.token) : undefined,
            status: accepted ? 'accepted' as const : expired ? 'expired' as const : 'pending' as const,
          }
        })

        return reply.send({ invites })
      } catch (err) {
        request.log.error({ err }, 'GET /invites failed')
        return reply.status(500).send({ error: 'Failed to load invitations' })
      }
    })

    // DELETE /invites/:id — revoke an invite (CFO only)
    scoped.delete('/invites/:id', { preHandler: requireRole('cfo') }, async (request, reply) => {
      const { id } = request.params as { id: string }
      try {
        const { data: existing, error: findErr } = await supabase
          .from('invites')
          .select('id, email, role, accepted_at')
          .eq('id', id)
          .eq('club_id', request.clubId)
          .maybeSingle()

        if (findErr) throw findErr
        if (!existing) return reply.status(404).send({ error: 'Invitation not found' })
        if (existing.accepted_at) {
          return reply.status(409).send({ error: 'Cannot revoke an accepted invitation' })
        }

        const { error: delErr } = await supabase
          .from('invites')
          .delete()
          .eq('id', id)
          .eq('club_id', request.clubId)
        if (delErr) throw delErr

        await writeAuditLog(request, 'invites', id, 'delete', undefined, {
          email: existing.email, role: existing.role,
        })

        return reply.send({ success: true })
      } catch (err) {
        request.log.error({ err }, 'DELETE /invites/:id failed')
        return reply.status(500).send({ error: 'Failed to revoke invitation' })
      }
    })

    // GET /team — list current users on this club (CFO only). Pairs with the
    // Settings → Team UI alongside the pending invites table.
    scoped.get('/team', { preHandler: requireRole('cfo') }, async (request, reply) => {
      try {
        const { data, error } = await supabase
          .from('users')
          .select('id, email, full_name, role, created_at')
          .eq('club_id', request.clubId)
          .order('created_at', { ascending: true })
        if (error) throw error

        return reply.send({
          members: (data ?? []).map((u) => ({
            id: String(u.id),
            email: String(u.email),
            fullName: String(u.full_name),
            role: String(u.role),
            createdAt: String(u.created_at),
          })),
        })
      } catch (err) {
        request.log.error({ err }, 'GET /team failed')
        return reply.status(500).send({ error: 'Failed to load team' })
      }
    })

    // PATCH /team/:id — change a member's role (CFO only). A CFO can't change
    // their own role (prevents accidentally locking themselves out of CFO ops).
    scoped.patch('/team/:id', { preHandler: requireRole('cfo') }, async (request, reply) => {
      const { id } = request.params as { id: string }
      const Body = z.object({ role: z.enum(['cfo', 'sporting_director', 'finance_analyst']) })
      const parsed = Body.safeParse(request.body)
      if (!parsed.success) return reply.status(400).send({ error: 'Invalid role' })

      if (id === request.userId) {
        return reply.status(400).send({ error: "You can't change your own role." })
      }

      try {
        const { data: member, error: findErr } = await supabase
          .from('users')
          .select('id, role')
          .eq('id', id)
          .eq('club_id', request.clubId)
          .maybeSingle()
        if (findErr) throw findErr
        if (!member) return reply.status(404).send({ error: 'Team member not found' })

        const { error: updErr } = await supabase
          .from('users')
          .update({ role: parsed.data.role })
          .eq('id', id)
          .eq('club_id', request.clubId)
        if (updErr) throw updErr

        await writeAuditLog(request, 'users', id, 'update', { role: parsed.data.role }, { role: member.role })
        return reply.send({ success: true, role: parsed.data.role })
      } catch (err) {
        request.log.error({ err }, 'PATCH /team/:id failed')
        return reply.status(500).send({ error: 'Failed to update role' })
      }
    })

    // DELETE /team/:id — revoke a member's access (CFO only). Removes their
    // tenant membership and their Supabase auth identity. A CFO can't revoke
    // themselves. Authored scenarios + audit rows are cleared first to satisfy
    // the users FK (mirrors the orphan-cleanup in authMiddleware).
    scoped.delete('/team/:id', { preHandler: requireRole('cfo') }, async (request, reply) => {
      const { id } = request.params as { id: string }
      if (id === request.userId) {
        return reply.status(400).send({ error: "You can't revoke your own access." })
      }

      try {
        const { data: member, error: findErr } = await supabase
          .from('users')
          .select('id, email, role')
          .eq('id', id)
          .eq('club_id', request.clubId)
          .maybeSingle()
        if (findErr) throw findErr
        if (!member) return reply.status(404).send({ error: 'Team member not found' })

        const { data: scenarioRows } = await supabase
          .from('scenarios')
          .select('id')
          .eq('club_id', request.clubId)
          .eq('created_by', id)
        const scenarioIds = (scenarioRows ?? []).map((s) => String(s.id))
        if (scenarioIds.length > 0) {
          const { error } = await supabase.from('scenario_actions').delete().in('scenario_id', scenarioIds)
          if (error) throw error
          const { error: scErr } = await supabase.from('scenarios').delete().in('id', scenarioIds)
          if (scErr) throw scErr
        }

        const { error: auditErr } = await supabase.from('audit_logs').delete().eq('user_id', id)
        if (auditErr) throw auditErr

        const { error: userErr } = await supabase
          .from('users')
          .delete()
          .eq('id', id)
          .eq('club_id', request.clubId)
        if (userErr) throw userErr

        // Revoke the login itself. Non-fatal if it fails — they're already out
        // of the tenant and would land in a fresh isolated workspace at most.
        const { error: authErr } = await supabase.auth.admin.deleteUser(id)
        if (authErr) request.log.warn({ err: authErr, id }, 'DELETE /team/:id: auth delete failed')

        await writeAuditLog(request, 'users', id, 'delete', undefined, {
          email: member.email, role: member.role,
        })
        return reply.send({ success: true })
      } catch (err) {
        request.log.error({ err }, 'DELETE /team/:id failed')
        return reply.status(500).send({ error: 'Failed to revoke access' })
      }
    })
  })
}
