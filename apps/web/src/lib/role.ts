/**
 * Frontend permission helpers — keeps the permission model consistent with the
 * API (MVP 2.1, granular booleans replacing the old enum role).
 *
 * `useMe()` calls `/me` once per session and caches the result. The API is the
 * source of truth; these predicates only drive UI affordances (which buttons to
 * show). Bypassing them client-side cannot bypass the API permission guards.
 */

import { useEffect, useState } from 'react'
import { useAuthStore } from '@/stores/auth'
import { useMeQuery } from '@/lib/queries'

const ME_CACHE_KEY = 'headroom-me'

/** The three explicit permission grants a member can hold. */
export interface Permissions {
  canEditRoster: boolean
  canEditScenarios: boolean
  isWorkspaceAdmin: boolean
}

/** The authenticated user as the API sees them (`GET /me`). */
export interface AppMe extends Permissions {
  id: string
  title: string | null
  fullName: string
  email: string
  isTotpEnabled: boolean
}

/**
 * Short label summarising a member's access for compact spots (the TopBar chip).
 * A descriptive job title wins when present; otherwise we fall back to a tier.
 */
export function accessLabel(me: Pick<AppMe, 'title'> & Permissions): string {
  if (me.title && me.title.trim()) return me.title.trim()
  if (me.isWorkspaceAdmin) return 'Workspace Admin'
  if (me.canEditRoster || me.canEditScenarios) return 'Editor'
  return 'Read-only'
}

/** Short access label for constrained chrome. The full role remains available
 * through the profile button's accessible label. */
export function compactAccessLabel(me: Pick<AppMe, 'title'> & Permissions): string {
  if (me.isWorkspaceAdmin) return 'Admin'
  if (me.canEditRoster || me.canEditScenarios) return 'Editor'
  return 'Read-only'
}

function readCachedMe(): AppMe | null {
  try {
    const raw = localStorage.getItem(ME_CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<AppMe>
    return typeof parsed.id === 'string' ? (parsed as AppMe) : null
  } catch { return null }
}

/**
 * The current user's identity + permissions, read from the shared `['me']`
 * TanStack Query cache (see useMeQuery). Using that one cache — rather than a
 * private per-session fetch — is what keeps the TopBar/Sidebar LIVE: when the
 * user edits their name/title in Settings, that save invalidates `['me']` and
 * every `useMe()` consumer re-renders with the new value immediately, no reload.
 *
 * A localStorage copy is kept purely as a paint hint so the TopBar shows the
 * last-known identity instantly on a fresh reload (the in-memory query cache is
 * empty then); the query refetches in the background and takes over. The API is
 * the source of truth — these predicates only drive UI affordances.
 */
export function useMe(): AppMe | null {
  const { session } = useAuthStore()
  const meQuery = useMeQuery(!!session)
  // Paint hint, read once on mount: shown only until the query resolves on a
  // fresh reload. Live updates come from meQuery.data, not this.
  const [hint] = useState<AppMe | null>(() => readCachedMe())

  const data = meQuery.data
  const me: AppMe | null = session ? (data ?? hint) : null

  // Mirror the latest server identity to localStorage for the next reload, and
  // clear it on sign-out so a different user never sees the previous paint hint.
  useEffect(() => {
    if (!session) {
      try { localStorage.removeItem(ME_CACHE_KEY) } catch { /* ignore */ }
      return
    }
    if (data) {
      const next: AppMe = {
        id: data.id,
        title: data.title,
        canEditRoster: data.canEditRoster,
        canEditScenarios: data.canEditScenarios,
        isWorkspaceAdmin: data.isWorkspaceAdmin,
        fullName: data.fullName,
        email: data.email,
        isTotpEnabled: data.isTotpEnabled,
      }
      try { localStorage.setItem(ME_CACHE_KEY, JSON.stringify(next)) } catch { /* ignore */ }
    }
  }, [session, data])

  return me
}

/**
 * Permission predicates derived from the granular grants. A workspace admin
 * implicitly satisfies every check — mirrors the backend requirePermission.
 */
export function useCan() {
  const me = useMe()
  const admin = !!me?.isWorkspaceAdmin
  return {
    me,
    isWorkspaceAdmin:     admin,
    canEditRoster:        admin || !!me?.canEditRoster,
    canEditScenarios:     admin || !!me?.canEditScenarios,
    // Module affordances, named by what they gate in the UI.
    editClubFinancials:   admin,
    switchLeague:         admin,
    mutateRoster:         admin || !!me?.canEditRoster,
    mutateScenarios:      admin || !!me?.canEditScenarios,
    toggleActiveBaseline: admin || !!me?.canEditScenarios,
    mutateSsr:            admin,
    inviteMembers:        admin,
    viewAuditLog:         admin,
  }
}
