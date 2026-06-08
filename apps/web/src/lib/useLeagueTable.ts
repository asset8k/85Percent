/**
 * useLeagueTable — fetches the live real-world standings for the club's league
 * and resolves which row is the user's own club.
 *
 * Shared by the dedicated League Table page (read-only view) and the Dashboard
 * Consequence Engine (before/after impact simulation). The API proxies a sports
 * data provider and falls back to a bundled snapshot, so `error` here only ever
 * reflects a transport failure reaching *our* API — the table itself is always
 * present on a 200.
 */

import { type LeagueTableResponse, type LeagueTableRow } from '@/lib/api'
import { useClubStore } from '@/stores/club'
import { useLeagueTableQuery } from '@/lib/queries'

// Normalise a team name for fuzzy matching between our club record and the
// sports-API naming ("Arsenal" vs "Arsenal FC" vs "AFC Bournemouth"). Strips
// the common FC/AFC affixes, punctuation, and collapses whitespace.
export function normaliseTeam(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[.'’]/g, '')
    .replace(/\b(fc|afc|cf)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

// Index of the row matching `clubName`, or -1. Tries exact normalised equality
// first, then a containment match (handles "Brighton" ⊂ "Brighton Hove Albion").
export function findClubRow(standings: LeagueTableRow[], clubName: string | null): number {
  if (!clubName) return -1
  const target = normaliseTeam(clubName)
  if (!target) return -1
  const exact = standings.findIndex(
    (r) => normaliseTeam(r.team) === target || normaliseTeam(r.shortName) === target,
  )
  if (exact !== -1) return exact
  return standings.findIndex((r) => {
    const t = normaliseTeam(r.team)
    return t.includes(target) || target.includes(t)
  })
}

export interface UseLeagueTableResult {
  data: LeagueTableResponse | null
  loading: boolean
  error: string | null
  /** Index of the user's club within `data.standings`, or -1 if not found. */
  clubRowIndex: number
  reload: () => void
}

export function useLeagueTable(): UseLeagueTableResult {
  const clubName = useClubStore((s) => s.clubName)
  // Backed by the shared QueryClient cache (above the router): the standings
  // survive tab switches, so revisiting the Dashboard or League Table is instant.
  // `loading` is the genuine first-load only (isPending) — a stale background
  // refresh keeps the existing table on screen.
  const query = useLeagueTableQuery()
  const data = query.data ?? null
  const error = query.error instanceof Error ? query.error.message : null
  const clubRowIndex = data ? findClubRow(data.standings, clubName) : -1

  return {
    data,
    loading: query.isPending,
    error,
    clubRowIndex,
    reload: () => { void query.refetch() },
  }
}
