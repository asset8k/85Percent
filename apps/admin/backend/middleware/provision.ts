/**
 * First-request workspace provisioning.
 *
 * A Supabase Auth user is NOT sufficient on its own: every request also needs a
 * `public.users` row (identity + club membership + permission grants) and, for a
 * founder, a `clubs` row to belong to. Creating the auth user — in the Supabase
 * dashboard, through an admin invite, or via the password-reset flow — creates
 * neither. This module is the canonical mechanism that fills that gap, lazily,
 * on the first authenticated API request.
 *
 * Why it lives behind a store port: the first authenticated page load fires
 * several requests in parallel (`/me`, `/club`, `/roster`, `/league-table`,
 * `/chat/sessions`, …). They ALL arrive before any `public.users` row exists, so
 * they all attempt to provision at once. The previous implementation let each
 * one insert blindly, so the losers hit a primary-key unique violation and
 * returned 503 — the "Unable to load this workspace" first-login failure, which
 * a refresh appeared to fix only because by then the winner had committed.
 *
 * Provisioning is therefore idempotent and race-safe:
 *   - a unique violation means a concurrent request already provisioned us, so
 *     we re-read and adopt that row instead of failing;
 *   - a starter club created by a losing request is compensated away, so racing
 *     requests cannot leave orphan `clubs` rows behind;
 *   - 503 is reserved for genuine database unavailability, never for "another
 *     request got here first".
 *
 * The store port also makes the concurrency behaviour testable without a live
 * database (see provision.test.ts).
 */

import { randomUUID } from 'crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { ApiLogger } from '../serverless/types'

/** Postgres `unique_violation`. Surfaced verbatim by PostgREST/supabase-js. */
export const UNIQUE_VIOLATION = '23505'

export interface DbError {
  code?: string
  message?: string
}

/** The columns every authenticated request needs off `public.users`. */
export interface AppUserRecord {
  id: string
  club_id: string
  can_edit_roster: boolean
  can_edit_scenarios: boolean
  is_workspace_admin: boolean
}

export interface PendingInvite {
  id: string
  club_id: string
  title: string | null
  can_edit_roster: boolean
  can_edit_scenarios: boolean
  is_workspace_admin: boolean
}

export interface NewUserRow {
  id: string
  club_id: string
  full_name: string
  email: string | null
  title: string | null
  can_edit_roster: boolean
  can_edit_scenarios: boolean
  is_workspace_admin: boolean
}

export interface AuthUserIdentity {
  id: string
  email?: string | undefined
  user_metadata?: Record<string, unknown> | undefined
}

/**
 * The database operations provisioning needs. Implemented against Supabase in
 * `supabaseProvisioningStore`; implemented in memory by the tests so the racing
 * behaviour can be exercised deterministically.
 */
export interface ProvisioningStore {
  findUserById(id: string): Promise<{ user: AppUserRecord | null; error: DbError | null }>
  findOrphanUserIds(email: string, keepId: string): Promise<{ ids: string[]; error: DbError | null }>
  purgeOrphanUsers(ids: string[]): Promise<DbError | null>
  findPendingInvite(email: string, nowIso: string): Promise<{ invite: PendingInvite | null }>
  createStarterClub(nowIso: string): Promise<{ clubId: string | null; error: DbError | null }>
  deleteClub(clubId: string): Promise<DbError | null>
  insertUser(row: NewUserRow): Promise<{ user: AppUserRecord | null; error: DbError | null }>
  markInviteAccepted(inviteId: string, nowIso: string): Promise<DbError | null>
}

export type ResolveOutcome =
  | { ok: true; user: AppUserRecord; provisioned: boolean }
  | { ok: false; status: number; error: string }

function isUniqueViolation(error: DbError | null): boolean {
  return error?.code === UNIQUE_VIOLATION
}

function displayNameFor(authUser: AuthUserIdentity): string {
  const metadataName = authUser.user_metadata?.['full_name']
  if (typeof metadataName === 'string' && metadataName.trim()) return metadataName
  return authUser.email?.split('@')[0] ?? 'New User'
}

/**
 * Resolve the application user for an authenticated Supabase identity,
 * provisioning it on first use. Safe to call concurrently for the same identity.
 */
export async function resolveAppUser(
  store: ProvisioningStore,
  authUser: AuthUserIdentity,
  log: ApiLogger,
  nowIso = new Date().toISOString(),
): Promise<ResolveOutcome> {
  const existing = await store.findUserById(authUser.id)
  if (existing.error) {
    log.error({ err: existing.error }, 'provision: user lookup failed')
    return { ok: false, status: 503, error: 'Database unavailable' }
  }
  if (existing.user) return { ok: true, user: existing.user, provisioned: false }

  return provisionAppUser(store, authUser, log, nowIso)
}

async function provisionAppUser(
  store: ProvisioningStore,
  authUser: AuthUserIdentity,
  log: ApiLogger,
  nowIso: string,
): Promise<ResolveOutcome> {
  const email = authUser.email

  // Clean up rows orphaned by a previous account on the same email. Supabase
  // Auth deletes `auth.users` but leaves `public.users` (and its FK children)
  // behind, and `users.email` is UNIQUE — so a stale row would otherwise block
  // the insert below. Concurrent requests running this together is harmless:
  // deletes are idempotent.
  if (email) {
    const orphans = await store.findOrphanUserIds(email, authUser.id)
    if (orphans.error) {
      log.error({ err: orphans.error }, 'provision: orphan lookup failed')
      return { ok: false, status: 503, error: 'Failed to clean up previous account data' }
    }
    if (orphans.ids.length > 0) {
      const purgeError = await store.purgeOrphanUsers(orphans.ids)
      if (purgeError) {
        log.error({ err: purgeError }, 'provision: orphan cleanup failed')
        return { ok: false, status: 503, error: 'Failed to clean up previous account data' }
      }
    }
  }

  // Honour a pending invite before provisioning a fresh workspace: an invitee
  // joins the inviting club with the invite's explicit grants rather than
  // getting an isolated starter club of their own.
  const invite = email ? (await store.findPendingInvite(email, nowIso)).invite : null

  // A starter club we create in THIS attempt. Tracked so it can be compensated
  // away if the user insert turns out to have lost a provisioning race.
  let createdClubId: string | null = null
  let targetClubId: string

  if (invite) {
    targetClubId = invite.club_id
  } else {
    const club = await store.createStarterClub(nowIso)
    if (club.error || !club.clubId) {
      log.error({ err: club.error }, 'provision: starter club create failed')
      return { ok: false, status: 503, error: 'Failed to provision workspace' }
    }
    createdClubId = club.clubId
    targetClubId = club.clubId
  }

  const grants = invite
    ? {
        title: invite.title,
        can_edit_roster: invite.can_edit_roster,
        can_edit_scenarios: invite.can_edit_scenarios,
        is_workspace_admin: invite.is_workspace_admin,
      }
    : { title: null, can_edit_roster: true, can_edit_scenarios: true, is_workspace_admin: true }

  const inserted = await store.insertUser({
    id: authUser.id,
    club_id: targetClubId,
    full_name: displayNameFor(authUser),
    email: email ?? null,
    ...grants,
  })

  if (inserted.user) {
    // Mark the invite consumed on the same request that created the user.
    // Non-fatal: the user row already exists, and a still-pending invite is
    // rejected on reuse by the duplicate-email check in /invites.
    if (invite) {
      const acceptError = await store.markInviteAccepted(invite.id, nowIso)
      if (acceptError) log.warn({ err: acceptError }, 'provision: invite accept update failed')
    }
    return { ok: true, user: inserted.user, provisioned: true }
  }

  // The insert failed. Either a sibling request from the same first page load
  // provisioned us a moment ago (the common case), or this is a real failure.
  // Postgres raises the unique violation only once the winning transaction has
  // committed, so a single re-read is enough to see its row.
  if (isUniqueViolation(inserted.error)) {
    const adopted = await store.findUserById(authUser.id)

    // Whatever the outcome, the starter club created above is now unreferenced.
    if (createdClubId) {
      const cleanupError = await store.deleteClub(createdClubId)
      if (cleanupError) {
        log.warn({ err: cleanupError, clubId: createdClubId }, 'provision: orphan club cleanup failed')
      }
    }

    if (adopted.user) return { ok: true, user: adopted.user, provisioned: false }

    // Unique violation with no row under our auth id means the conflict was on
    // `users.email`: this address already belongs to a different account. That
    // is a durable conflict, not a transient outage — do not report it as 503.
    log.error({ err: inserted.error }, 'provision: email already linked to another account')
    return {
      ok: false,
      status: 409,
      error: 'This email address is already linked to another 85Percent account.',
    }
  }

  if (createdClubId) {
    const cleanupError = await store.deleteClub(createdClubId)
    if (cleanupError) {
      log.warn({ err: cleanupError, clubId: createdClubId }, 'provision: orphan club cleanup failed')
    }
  }

  log.error({ err: inserted.error }, 'provision: user insert failed')
  return { ok: false, status: 503, error: 'Failed to provision user' }
}

// ---------------------------------------------------------------------------
// Supabase-backed implementation (service role — bypasses RLS).
// ---------------------------------------------------------------------------

const USER_COLUMNS = 'id, club_id, can_edit_roster, can_edit_scenarios, is_workspace_admin'

function toAppUser(row: Record<string, unknown>): AppUserRecord {
  return {
    id: String(row['id']),
    club_id: String(row['club_id']),
    can_edit_roster: !!row['can_edit_roster'],
    can_edit_scenarios: !!row['can_edit_scenarios'],
    is_workspace_admin: !!row['is_workspace_admin'],
  }
}

export function supabaseProvisioningStore(db: SupabaseClient): ProvisioningStore {
  return {
    async findUserById(id) {
      const { data, error } = await db.from('users').select(USER_COLUMNS).eq('id', id).maybeSingle()
      if (error) return { user: null, error }
      return { user: data ? toAppUser(data as Record<string, unknown>) : null, error: null }
    },

    async findOrphanUserIds(email, keepId) {
      const { data, error } = await db.from('users').select('id').eq('email', email).neq('id', keepId)
      if (error) return { ids: [], error }
      return { ids: (data ?? []).map((row) => String((row as { id: unknown }).id)), error: null }
    },

    // FK cascade order: scenarios.created_by and audit_logs.user_id both
    // reference users.id (scenario_actions cascade via the scenarios FK), so
    // those must go before the users rows themselves.
    async purgeOrphanUsers(ids) {
      const scenarios = await db.from('scenarios').delete().in('created_by', ids)
      if (scenarios.error) return scenarios.error
      const audit = await db.from('audit_logs').delete().in('user_id', ids)
      if (audit.error) return audit.error
      const users = await db.from('users').delete().in('id', ids)
      return users.error ?? null
    },

    async findPendingInvite(email, nowIso) {
      // A lookup failure here is deliberately non-fatal: the caller falls back
      // to provisioning an isolated starter workspace rather than failing login.
      const { data } = await db
        .from('invites')
        .select('id, club_id, title, can_edit_roster, can_edit_scenarios, is_workspace_admin, expires_at')
        .eq('email', email)
        .is('accepted_at', null)
        .gt('expires_at', nowIso)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (!data) return { invite: null }
      const row = data as Record<string, unknown>
      return {
        invite: {
          id: String(row['id']),
          club_id: String(row['club_id']),
          title: (row['title'] as string | null) ?? null,
          can_edit_roster: !!row['can_edit_roster'],
          can_edit_scenarios: !!row['can_edit_scenarios'],
          is_workspace_admin: !!row['is_workspace_admin'],
        },
      }
    },

    async createStarterClub(nowIso) {
      const clubId = randomUUID()
      const { data, error } = await db
        .from('clubs')
        .insert({
          id: clubId,
          name: '85Percent FC',
          short_name: 'HFC',
          league_id: 'efl-championship',
          created_at: nowIso,
          updated_at: nowIso,
        })
        .select('id')
        .single()
      if (error || !data) return { clubId: null, error: error ?? { message: 'Club insert returned no row' } }
      return { clubId: String((data as { id: unknown }).id), error: null }
    },

    async deleteClub(clubId) {
      const { error } = await db.from('clubs').delete().eq('id', clubId)
      return error ?? null
    },

    async insertUser(row) {
      const { data, error } = await db.from('users').insert(row).select(USER_COLUMNS).single()
      if (error || !data) return { user: null, error: error ?? { message: 'User insert returned no row' } }
      return { user: toAppUser(data as Record<string, unknown>), error: null }
    },

    async markInviteAccepted(inviteId, nowIso) {
      const { error } = await db.from('invites').update({ accepted_at: nowIso }).eq('id', inviteId)
      return error ?? null
    },
  }
}
