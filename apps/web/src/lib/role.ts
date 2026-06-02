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
import { api } from '@/lib/api'

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

function readCachedMe(): AppMe | null {
  try {
    const raw = localStorage.getItem(ME_CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<AppMe>
    return typeof parsed.id === 'string' ? (parsed as AppMe) : null
  } catch { return null }
}

/**
 * Fetch the current user's identity + permissions once per session (cached in
 * localStorage so the TopBar paints instantly on reload). The API is the source
 * of truth; the cache is only a paint hint.
 */
export function useMe(): AppMe | null {
  const { session } = useAuthStore()
  const [me, setMe] = useState<AppMe | null>(() => readCachedMe())

  useEffect(() => {
    if (!session) {
      setMe(null)
      try { localStorage.removeItem(ME_CACHE_KEY) } catch { /* ignore */ }
      return
    }
    let cancelled = false
    api.me.get()
      .then((data) => {
        if (cancelled) return
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
        setMe(next)
        try { localStorage.setItem(ME_CACHE_KEY, JSON.stringify(next)) } catch { /* ignore */ }
      })
      .catch(() => {
        // Leave the cached value (or null) in place. Worst case the UI hides
        // some affordances; the API still enforces the real permissions.
      })
    return () => { cancelled = true }
  }, [session])

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
