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

const ROLE_CACHE_KEY = 'headroom-role'

function isAppRole(s: string): s is AppRole {
  return s === 'cfo' || s === 'sporting_director' || s === 'finance_analyst' || s === 'admin'
}

export function useRole(): AppRole | null {
  const { session } = useAuthStore()
  const [role, setRole] = useState<AppRole | null>(() => {
    try {
      const cached = localStorage.getItem(ROLE_CACHE_KEY)
      return cached && isAppRole(cached) ? cached : null
    } catch { return null }
  })

  useEffect(() => {
    if (!session) {
      setRole(null)
      try { localStorage.removeItem(ROLE_CACHE_KEY) } catch { /* ignore */ }
      return
    }
    let cancelled = false
    api.me.get()
      .then((me) => {
        if (cancelled) return
        if (isAppRole(me.role)) {
          setRole(me.role)
          try { localStorage.setItem(ROLE_CACHE_KEY, me.role) } catch { /* ignore */ }
        }
      })
      .catch(() => {
        // Leave the cached value (or null) in place. Worst case the UI hides
        // some affordances; API still enforces the real permissions.
      })
    return () => { cancelled = true }
  }, [session])

  return role
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
