/**
 * Frontend role helpers — keeps the role matrix consistent with the API.
 *
 * `useRole()` calls `/me` once per session and caches the role. The API is the
 * source of truth; frontend predicates only drive UI affordances (which
 * buttons to show). Bypassing the predicates client-side cannot bypass the
 * API role guards.
 */

import { useEffect, useState } from 'react'
import { useAuthStore } from '@/stores/auth'
import { api } from '@/lib/api'

export type AppRole = 'cfo' | 'sporting_director' | 'finance_analyst' | 'admin'

const ME_CACHE_KEY = 'headroom-me'

/** The authenticated user as the API sees them (`GET /me`). */
export interface AppMe {
  id: string
  role: AppRole
  fullName: string
  email: string
  isTotpEnabled: boolean
}

/** Human-readable role label, shared across the TopBar, Team list, and invites. */
export const ROLE_LABEL: Record<AppRole, string> = {
  cfo:               'CFO',
  sporting_director: 'Sporting Director',
  finance_analyst:   'Finance Analyst',
  admin:             'Admin',
}

export function roleLabel(role: string | null): string {
  if (role && isAppRole(role)) return ROLE_LABEL[role]
  return role ?? ''
}

function isAppRole(s: string): s is AppRole {
  return s === 'cfo' || s === 'sporting_director' || s === 'finance_analyst' || s === 'admin'
}

function readCachedMe(): AppMe | null {
  try {
    const raw = localStorage.getItem(ME_CACHE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<AppMe>
    return parsed.role && isAppRole(parsed.role) ? (parsed as AppMe) : null
  } catch { return null }
}

/**
 * Fetch the current user's identity + role once per session (cached in
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
        if (cancelled || !isAppRole(data.role)) return
        const next: AppMe = {
          id: data.id,
          role: data.role,
          fullName: data.fullName,
          email: data.email,
          isTotpEnabled: data.isTotpEnabled,
        }
        setMe(next)
        try { localStorage.setItem(ME_CACHE_KEY, JSON.stringify(next)) } catch { /* ignore */ }
      })
      .catch(() => {
        // Leave the cached value (or null) in place. Worst case the UI hides
        // some affordances; API still enforces the real permissions.
      })
    return () => { cancelled = true }
  }, [session])

  return me
}

export function useRole(): AppRole | null {
  return useMe()?.role ?? null
}

/** Permission predicates derived from the role matrix in mvp_2.0_plan.md §5.2. */
export function useCan() {
  const role = useRole()
  const has = (...allowed: AppRole[]) => {
    if (!role) return false
    if (role === 'admin') return true
    return allowed.includes(role)
  }
  return {
    role,
    has,
    editClubFinancials:   has('cfo'),
    switchLeague:         has('cfo'),
    mutateRoster:         has('cfo', 'finance_analyst'),
    mutateScenarios:      !!role,                           // all authenticated users
    toggleActiveBaseline: has('cfo', 'sporting_director'),
    mutateSsr:            has('cfo', 'finance_analyst'),
    inviteMembers:        has('cfo'),
    viewAuditLog:         has('cfo'),
  }
}
