/**
 * Server-data query hooks (TanStack Query).
 *
 * Each hook wraps an `api.*` call in `useQuery` so its result is cached in the
 * app-wide QueryClient (see queryClient.ts) rather than in page-local state.
 * Because that cache lives above the router, the data survives the unmount /
 * remount React Router performs on every tab switch — so switching away and back
 * serves the cached data instantly instead of re-fetching behind a skeleton.
 *
 * Skeleton rule for consumers: render the loading skeleton ONLY on `isPending`
 * (the genuine first load, no cache yet). A stale-revalidate background refresh
 * is `isFetching === true` while `data` is still present — keep the data on
 * screen for that, never the skeleton.
 *
 * Mutations elsewhere should call `queryClient.invalidateQueries({ queryKey })`
 * with the matching key below; that marks the cache stale and refetches in the
 * background while the existing rows stay visible.
 *
 * NOTE: error-tolerant fetches (manager, financials) swallow failures and resolve
 * to `null`, mirroring the pages' prior `.catch(() => null)` behaviour — a missing
 * manager / unconfigured financials is a normal state, not a query error.
 */
import { useQuery, keepPreviousData } from '@tanstack/react-query'
import { api } from './api'

/** Centralised query keys — one source of truth so invalidation stays in sync. */
export const queryKeys = {
  roster: ['roster', 'active'] as const,
  rosterArchived: ['roster', 'archived'] as const,
  manager: ['roster', 'manager'] as const,
  scenarioDetails: ['scenarios', 'details'] as const,
  leagueTable: ['leagueTable'] as const,
  ssrWorkingCapital: (season: string) => ['ssr', 'workingCapital', season] as const,
  ssrLiquidity: (season: string) => ['ssr', 'liquidity', season] as const,
  ssrEquity: (season: string) => ['ssr', 'equity', season] as const,
  // Settings surfaces — cached so re-entering a settings tab is instant.
  me: ['me'] as const,
  teamMembers: ['team', 'members'] as const,
  invites: ['team', 'invites'] as const,
  auditLog: (page: number, limit: number) => ['audit', page, limit] as const,
}

/** Active squad (with contracts). Season-independent, matching the prior load. */
export function useRosterQuery() {
  return useQuery({
    queryKey: queryKeys.roster,
    queryFn: async () => (await api.roster.list()).players,
  })
}

/** Archived players. */
export function useArchivedRosterQuery() {
  return useQuery({
    queryKey: queryKeys.rosterArchived,
    queryFn: async () => (await api.roster.listArchived()).players,
  })
}

/** Head coach / manager — resolves to null when none is set or the call fails. */
export function useManagerQuery() {
  return useQuery({
    queryKey: queryKeys.manager,
    queryFn: async () => {
      try {
        return (await api.roster.getManager()).manager
      } catch {
        return null
      }
    },
  })
}

/** All scenarios with their actions folded in (needed for Active Baseline math). */
export function useScenarioDetailsQuery() {
  return useQuery({
    queryKey: queryKeys.scenarioDetails,
    queryFn: async () => {
      const list = await api.scenarios.list(1, 100)
      return Promise.all(list.scenarios.map((s) => api.scenarios.get(s.id)))
    },
  })
}

/** Live real-world league standings. */
export function useLeagueTableQuery() {
  return useQuery({
    queryKey: queryKeys.leagueTable,
    queryFn: () => api.leagueTable.get(),
  })
}

/** SSR working-capital test for a season. */
export function useSsrWorkingCapitalQuery(season: string) {
  return useQuery({
    queryKey: queryKeys.ssrWorkingCapital(season),
    queryFn: () => api.ssr.getWorkingCapital(season),
  })
}

/** SSR liquidity test for a season. */
export function useSsrLiquidityQuery(season: string) {
  return useQuery({
    queryKey: queryKeys.ssrLiquidity(season),
    queryFn: () => api.ssr.getLiquidity(season),
  })
}

/** SSR positive-equity test for a season. */
export function useSsrEquityQuery(season: string) {
  return useQuery({
    queryKey: queryKeys.ssrEquity(season),
    queryFn: () => api.ssr.getEquity(season),
  })
}

/** Current user (`/me`): identity, permissions, 2FA state, shared AI balance.
 *  A single cache entry shared by every consumer — the Settings → Profile tab,
 *  the Team tab, AND the TopBar/Sidebar identity (via `useMe`). Because they all
 *  read this one key, a profile save that invalidates `['me']` updates the name
 *  everywhere at once. Pass `enabled: false` to hold the fetch until there's a
 *  session (the TopBar mounts before login resolves). */
export function useMeQuery(enabled = true) {
  return useQuery({
    queryKey: queryKeys.me,
    queryFn: () => api.me.get(),
    enabled,
  })
}

/** Team members (Settings → Team). */
export function useTeamMembersQuery() {
  return useQuery({
    queryKey: queryKeys.teamMembers,
    queryFn: async () => (await api.team.list()).members,
  })
}

/** Pending invites (Settings → Team). */
export function useInvitesQuery() {
  return useQuery({
    queryKey: queryKeys.invites,
    queryFn: async () => (await api.invites.list()).invites,
  })
}

/** Paginated audit log (Settings → Activity). `keepPreviousData` holds the
 *  current page on screen while the next one loads — no skeleton between pages,
 *  skeleton only on the genuine first load. */
export function useAuditLogQuery(page: number, limit: number) {
  return useQuery({
    queryKey: queryKeys.auditLog(page, limit),
    queryFn: () => api.audit.list({ page, limit }),
    placeholderData: keepPreviousData,
  })
}
