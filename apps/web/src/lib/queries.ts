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
 *
 * ORDERING RULE: every hook below except `useMeQuery` hits a workspace-scoped
 * route, which the API can only answer once the caller's application user and
 * club exist. They therefore all gate on `useWorkspaceReady()` — the bootstrap
 * in ProtectedRoute resolves `/me` + `/club` first, and only then do these
 * become enabled. A disabled query stays `isPending`, so consumers keep showing
 * their skeleton exactly as they do for a real first load. `useMeQuery` is
 * deliberately ungated: it *is* part of the bootstrap.
 */
import { useQuery, keepPreviousData, type QueryClient } from '@tanstack/react-query'
import { api } from './api'
import { seasonAsOfDate, useSeasonStore } from '@/stores/season'
import { useClubStore } from '@/stores/club'
import { useWorkspaceReady } from '@/lib/workspace'

/** Centralised query keys — one source of truth so invalidation stays in sync. */
export const queryKeys = {
  roster: (asOf: string) => ['roster', 'active', asOf] as const,
  rosterArchived: ['roster', 'archived'] as const,
  playerPhases: (id: string, asOf: string) => ['roster', 'player-phases', id, asOf] as const,
  manager: ['roster', 'manager'] as const,
  scenarioDetails: ['scenarios', 'details'] as const,
  leagueTable: (leagueId: string) => ['leagueTable', leagueId] as const,
  ssrWorkingCapital: (season: string) => ['ssr', 'workingCapital', season] as const,
  ssrLiquidity: (season: string) => ['ssr', 'liquidity', season] as const,
  ssrEquity: (season: string) => ['ssr', 'equity', season] as const,
  // Settings surfaces — cached so re-entering a settings tab is instant.
  me: ['me'] as const,
  teamMembers: ['team', 'members'] as const,
  invites: ['team', 'invites'] as const,
  auditLog: (page: number, limit: number) => ['audit', page, limit] as const,
}

/**
 * Roster writes affect more than the table: Dashboard derives the current SCR
 * from this cache, Scenarios uses it as its player picker, Calendar uses its
 * expiry dates, and SSR surfaces can consume the same financial baseline.
 * Keep that fan-out in one place so individual mutation flows cannot forget a
 * dependent module.
 */
export async function invalidateRosterDerivedQueries(queryClient: QueryClient): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: ['roster'] }),
    queryClient.invalidateQueries({ queryKey: queryKeys.scenarioDetails }),
    queryClient.invalidateQueries({ queryKey: ['ssr'] }),
  ])
}

/** Active squad resolved at the selected season's reporting date. */
export function useRosterQuery() {
  const seasonStartYear = useSeasonStore((state) => state.startYear)
  const workspaceReady = useWorkspaceReady()
  const asOf = seasonAsOfDate(seasonStartYear).toISOString().slice(0, 10)
  return useQuery({
    queryKey: queryKeys.roster(asOf),
    queryFn: async () => (await api.roster.list(asOf)).players,
    enabled: workspaceReady,
  })
}

/** Archived players. */
export function useArchivedRosterQuery() {
  const workspaceReady = useWorkspaceReady()
  return useQuery({
    queryKey: queryKeys.rosterArchived,
    queryFn: async () => (await api.roster.listArchived()).players,
    enabled: workspaceReady,
  })
}

/** A player ledger is loaded only for the open editor and shares the roster's valuation date. */
export function usePlayerPhasesQuery(playerId: string | undefined, enabled = true) {
  const seasonStartYear = useSeasonStore((state) => state.startYear)
  const workspaceReady = useWorkspaceReady()
  const asOf = seasonAsOfDate(seasonStartYear).toISOString().slice(0, 10)
  return useQuery({
    queryKey: queryKeys.playerPhases(playerId ?? '', asOf),
    queryFn: async () => (await api.roster.playerPhases(playerId!, asOf)).phases,
    enabled: workspaceReady && enabled && Boolean(playerId),
  })
}

/** Head coach / manager — resolves to null when none is set or the call fails. */
export function useManagerQuery() {
  const workspaceReady = useWorkspaceReady()
  return useQuery({
    queryKey: queryKeys.manager,
    queryFn: async () => {
      try {
        return (await api.roster.getManager()).manager
      } catch {
        return null
      }
    },
    enabled: workspaceReady,
  })
}

/** All scenarios with their actions folded in (needed for Active Baseline math). */
export function useScenarioDetailsQuery() {
  const workspaceReady = useWorkspaceReady()
  return useQuery({
    queryKey: queryKeys.scenarioDetails,
    queryFn: async () => {
      const list = await api.scenarios.list(1, 100)
      return Promise.all(list.scenarios.map((s) => api.scenarios.get(s.id)))
    },
    enabled: workspaceReady,
  })
}

/**
 * Live real-world league standings. The API derives which league (PL or
 * Championship) to return from the caller's current club server-side — it
 * doesn't take a leagueId param — but the cache key still needs one: without
 * it, switching from a Premier League club to a Championship club (or back)
 * keeps serving the previously-cached league's table until a hard reload,
 * since React Query has no way to know the underlying data changed.
 */
export function useLeagueTableQuery() {
  const workspaceReady = useWorkspaceReady()
  const leagueId = useClubStore((state) => state.leagueId)
  return useQuery({
    queryKey: queryKeys.leagueTable(leagueId ?? ''),
    queryFn: () => api.leagueTable.get(),
    enabled: workspaceReady && !!leagueId,
  })
}

/** SSR working-capital test for a season. */
export function useSsrWorkingCapitalQuery(season: string) {
  const workspaceReady = useWorkspaceReady()
  return useQuery({
    queryKey: queryKeys.ssrWorkingCapital(season),
    queryFn: () => api.ssr.getWorkingCapital(season),
    enabled: workspaceReady,
  })
}

/** SSR liquidity test for a season. */
export function useSsrLiquidityQuery(season: string) {
  const workspaceReady = useWorkspaceReady()
  return useQuery({
    queryKey: queryKeys.ssrLiquidity(season),
    queryFn: () => api.ssr.getLiquidity(season),
    enabled: workspaceReady,
  })
}

/** SSR positive-equity test for a season. */
export function useSsrEquityQuery(season: string) {
  const workspaceReady = useWorkspaceReady()
  return useQuery({
    queryKey: queryKeys.ssrEquity(season),
    queryFn: () => api.ssr.getEquity(season),
    enabled: workspaceReady,
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
  const workspaceReady = useWorkspaceReady()
  return useQuery({
    queryKey: queryKeys.teamMembers,
    queryFn: async () => (await api.team.list()).members,
    enabled: workspaceReady,
  })
}

/** Pending invites (Settings → Team). */
export function useInvitesQuery() {
  const workspaceReady = useWorkspaceReady()
  return useQuery({
    queryKey: queryKeys.invites,
    queryFn: async () => (await api.invites.list()).invites,
    enabled: workspaceReady,
  })
}

/** Paginated audit log (Settings → Activity). `keepPreviousData` holds the
 *  current page on screen while the next one loads — no skeleton between pages,
 *  skeleton only on the genuine first load. */
export function useAuditLogQuery(page: number, limit: number) {
  const workspaceReady = useWorkspaceReady()
  return useQuery({
    queryKey: queryKeys.auditLog(page, limit),
    queryFn: () => api.audit.list({ page, limit }),
    placeholderData: keepPreviousData,
    enabled: workspaceReady,
  })
}
