import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import {
  resolveAppUser,
  UNIQUE_VIOLATION,
  type AppUserRecord,
  type DbError,
  type NewUserRow,
  type PendingInvite,
  type ProvisioningStore,
} from './provision'
import type { ApiLogger } from '../serverless/types'

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

function silentLogger(): ApiLogger & { errors: unknown[]; warnings: unknown[] } {
  const errors: unknown[] = []
  const warnings: unknown[] = []
  return {
    errors,
    warnings,
    error: (context) => { errors.push(context) },
    warn: (context) => { warnings.push(context) },
    info: () => {},
  }
}

interface FakeStoreOptions {
  invites?: PendingInvite[]
  orphanIds?: string[]
  failOn?: 'findUser' | 'orphanLookup' | 'orphanPurge' | 'createClub' | 'insertUser'
  /** Pre-seed a users row owned by a DIFFERENT id but the same email. */
  emailOwnedBy?: { id: string; email: string }
}

/**
 * In-memory ProvisioningStore that enforces the real table constraints
 * (`users.id` primary key, `users.email` unique) and yields on every operation.
 *
 * Yielding matters: it makes concurrent `resolveAppUser` calls interleave in
 * lockstep the way parallel HTTP requests do, so the first-login race is
 * reproduced deterministically rather than by luck of timing.
 */
class FakeStore implements ProvisioningStore {
  users = new Map<string, AppUserRecord & { email: string | null }>()
  clubs = new Set<string>()
  acceptedInvites: string[] = []
  insertAttempts = 0
  private clubCounter = 0

  constructor(private readonly options: FakeStoreOptions = {}) {
    if (options.emailOwnedBy) {
      const { id, email } = options.emailOwnedBy
      this.clubs.add('club-existing')
      this.users.set(id, {
        id,
        club_id: 'club-existing',
        email,
        can_edit_roster: true,
        can_edit_scenarios: true,
        is_workspace_admin: true,
      })
    }
  }

  private async yield_(): Promise<void> {
    await Promise.resolve()
  }

  async findUserById(id: string) {
    await this.yield_()
    if (this.options.failOn === 'findUser') {
      return { user: null, error: { code: '08006', message: 'connection failure' } as DbError }
    }
    const row = this.users.get(id)
    if (!row) return { user: null, error: null }
    const { email: _email, ...user } = row
    return { user, error: null }
  }

  async findOrphanUserIds(email: string, keepId: string) {
    await this.yield_()
    if (this.options.failOn === 'orphanLookup') {
      return { ids: [], error: { code: '08006' } as DbError }
    }
    const configured = this.options.orphanIds ?? []
    const matched = [...this.users.values()]
      .filter((row) => row.email === email && row.id !== keepId)
      .map((row) => row.id)
    return { ids: [...new Set([...configured, ...matched])], error: null }
  }

  async purgeOrphanUsers(ids: string[]) {
    await this.yield_()
    if (this.options.failOn === 'orphanPurge') return { code: '08006' } as DbError
    for (const id of ids) this.users.delete(id)
    return null
  }

  async findPendingInvite(email: string) {
    await this.yield_()
    return { invite: this.options.invites?.find((i) => i.club_id && email) ?? null }
  }

  async createStarterClub() {
    await this.yield_()
    if (this.options.failOn === 'createClub') {
      return { clubId: null, error: { code: '08006' } as DbError }
    }
    const clubId = `club-${++this.clubCounter}`
    this.clubs.add(clubId)
    return { clubId, error: null }
  }

  async deleteClub(clubId: string) {
    await this.yield_()
    this.clubs.delete(clubId)
    return null
  }

  async insertUser(row: NewUserRow) {
    await this.yield_()
    this.insertAttempts += 1
    if (this.options.failOn === 'insertUser') {
      return { user: null, error: { code: '42501', message: 'permission denied' } as DbError }
    }
    // users.id primary key
    if (this.users.has(row.id)) {
      return { user: null, error: { code: UNIQUE_VIOLATION, message: 'users_pkey' } as DbError }
    }
    // users.email unique
    if (row.email && [...this.users.values()].some((u) => u.email === row.email)) {
      return { user: null, error: { code: UNIQUE_VIOLATION, message: 'users_email_key' } as DbError }
    }
    const stored = {
      id: row.id,
      club_id: row.club_id,
      email: row.email,
      can_edit_roster: row.can_edit_roster,
      can_edit_scenarios: row.can_edit_scenarios,
      is_workspace_admin: row.is_workspace_admin,
    }
    this.users.set(row.id, stored)
    const { email: _email, ...user } = stored
    return { user, error: null }
  }

  async markInviteAccepted(inviteId: string) {
    await this.yield_()
    this.acceptedInvites.push(inviteId)
    return null
  }
}

const AUTH_USER = {
  id: 'auth-user-1',
  email: 'cfo@club.com',
  user_metadata: { full_name: 'Club CFO' },
}

// ---------------------------------------------------------------------------

describe('resolveAppUser', () => {
  let log: ReturnType<typeof silentLogger>
  beforeEach(() => { log = silentLogger() })

  it('returns the existing application user without provisioning', async () => {
    const store = new FakeStore()
    store.clubs.add('club-a')
    store.users.set(AUTH_USER.id, {
      id: AUTH_USER.id,
      club_id: 'club-a',
      email: AUTH_USER.email,
      can_edit_roster: false,
      can_edit_scenarios: true,
      is_workspace_admin: false,
    })

    const outcome = await resolveAppUser(store, AUTH_USER, log)

    assert.equal(outcome.ok, true)
    assert.equal(outcome.ok && outcome.provisioned, false)
    assert.equal(outcome.ok && outcome.user.club_id, 'club-a')
    assert.equal(store.insertAttempts, 0)
  })

  it('provisions an isolated starter workspace for a brand-new auth user', async () => {
    const store = new FakeStore()

    const outcome = await resolveAppUser(store, AUTH_USER, log)

    assert.equal(outcome.ok, true)
    assert.equal(outcome.ok && outcome.provisioned, true)
    assert.equal(outcome.ok && outcome.user.is_workspace_admin, true)
    assert.equal(outcome.ok && outcome.user.can_edit_roster, true)
    assert.equal(store.clubs.size, 1)
    assert.equal(store.users.size, 1)
  })

  it('joins a pending invite instead of creating a second workspace', async () => {
    const invite: PendingInvite = {
      id: 'invite-1',
      club_id: 'club-inviter',
      title: 'Head of Finance',
      can_edit_roster: true,
      can_edit_scenarios: false,
      is_workspace_admin: false,
    }
    const store = new FakeStore({ invites: [invite] })

    const outcome = await resolveAppUser(store, AUTH_USER, log)

    assert.equal(outcome.ok, true)
    assert.equal(outcome.ok && outcome.user.club_id, 'club-inviter')
    assert.equal(outcome.ok && outcome.user.is_workspace_admin, false)
    assert.equal(outcome.ok && outcome.user.can_edit_scenarios, false)
    assert.deepEqual(store.acceptedInvites, ['invite-1'])
    // No starter club — the invitee joins the inviting workspace.
    assert.equal(store.clubs.size, 0)
  })

  // ── The first-login regression ────────────────────────────────────────────
  // Every request of the first authenticated page load arrives before any
  // `public.users` row exists, so they all try to provision at once. Previously
  // the losers hit a primary-key unique violation and returned 503 — the
  // "Unable to load this workspace" screen that a refresh appeared to fix.
  it('resolves every request of a concurrent first page load', async () => {
    const store = new FakeStore()
    const requests = ['/me', '/club', '/roster', '/league-table', '/chat/sessions', '/scenarios']

    const outcomes = await Promise.all(
      requests.map(() => resolveAppUser(store, AUTH_USER, log)),
    )

    for (const [index, outcome] of outcomes.entries()) {
      assert.equal(outcome.ok, true, `${requests[index]} should not fail during provisioning`)
    }

    // Exactly one application user and one workspace, and every request agrees
    // on which workspace that is.
    assert.equal(store.users.size, 1)
    const clubIds = new Set(outcomes.map((o) => (o.ok ? o.user.club_id : null)))
    assert.equal(clubIds.size, 1)

    // Losing requests must not leave orphan clubs behind: each one created a
    // starter club before discovering it had lost, and must compensate for it.
    assert.equal(store.clubs.size, 1, 'racing requests left orphan club rows')
    assert.equal(store.insertAttempts, requests.length, 'expected a genuine race')

    // Exactly one request did the provisioning; the rest adopted its row.
    assert.equal(outcomes.filter((o) => o.ok && o.provisioned).length, 1)
  })

  it('never reports a provisioning race as a 503', async () => {
    const store = new FakeStore()
    const outcomes = await Promise.all(
      Array.from({ length: 8 }, () => resolveAppUser(store, AUTH_USER, log)),
    )
    const statuses = outcomes.filter((o) => !o.ok).map((o) => (o.ok ? null : o.status))
    assert.deepEqual(statuses, [], 'no request should fail while the workspace is being provisioned')
  })

  it('reports a genuine database outage as 503', async () => {
    const store = new FakeStore({ failOn: 'findUser' })
    const outcome = await resolveAppUser(store, AUTH_USER, log)
    assert.equal(outcome.ok, false)
    assert.equal(!outcome.ok && outcome.status, 503)
  })

  it('reports a failed starter-club create as 503', async () => {
    const store = new FakeStore({ failOn: 'createClub' })
    const outcome = await resolveAppUser(store, AUTH_USER, log)
    assert.equal(outcome.ok, false)
    assert.equal(!outcome.ok && outcome.status, 503)
  })

  it('compensates the starter club when the user insert fails outright', async () => {
    const store = new FakeStore({ failOn: 'insertUser' })
    const outcome = await resolveAppUser(store, AUTH_USER, log)
    assert.equal(outcome.ok, false)
    assert.equal(!outcome.ok && outcome.status, 503)
    assert.equal(store.clubs.size, 0, 'a failed provision must not leave an orphan club')
  })

  it('reports an email already linked to another account as 409, not 503', async () => {
    const store = new FakeStore({
      emailOwnedBy: { id: 'some-other-auth-user', email: AUTH_USER.email },
      // Skip orphan cleanup so the conflicting row survives to the insert.
      orphanIds: [],
    })
    // Suppress the orphan sweep by making the conflicting row invisible to it.
    store.findOrphanUserIds = async () => ({ ids: [], error: null })

    const outcome = await resolveAppUser(store, AUTH_USER, log)

    assert.equal(outcome.ok, false)
    assert.equal(!outcome.ok && outcome.status, 409)
    assert.equal(store.clubs.size, 1, 'only the pre-existing club should remain')
  })

  it('clears rows orphaned by a deleted account on the same email', async () => {
    const store = new FakeStore()
    store.users.set('stale-auth-user', {
      id: 'stale-auth-user',
      club_id: 'club-old',
      email: AUTH_USER.email,
      can_edit_roster: true,
      can_edit_scenarios: true,
      is_workspace_admin: true,
    })

    const outcome = await resolveAppUser(store, AUTH_USER, log)

    assert.equal(outcome.ok, true)
    assert.equal(store.users.has('stale-auth-user'), false)
    assert.equal(store.users.has(AUTH_USER.id), true)
  })

  it('reports a failed orphan cleanup as 503 without provisioning', async () => {
    const store = new FakeStore({ failOn: 'orphanPurge', orphanIds: ['stale'] })
    const outcome = await resolveAppUser(store, AUTH_USER, log)
    assert.equal(outcome.ok, false)
    assert.equal(!outcome.ok && outcome.status, 503)
    assert.equal(store.insertAttempts, 0)
  })

  it('falls back to the email local-part when the identity has no name', async () => {
    const store = new FakeStore()
    const outcome = await resolveAppUser(store, { id: 'u2', email: 'ops@club.com' }, log)
    assert.equal(outcome.ok, true)
    assert.equal(store.users.get('u2')?.email, 'ops@club.com')
  })
})
