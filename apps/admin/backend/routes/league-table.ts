/**
 * League Table route — real-world standings for the Consequence Engine.
 *
 *   GET /league-table  — current standings for the caller's club's league
 *
 * Resolution order:
 *   1. Newest ACTIVE snapshot stored by an admin "update league table" run
 *      (league_table_snapshots). This is what the admin panel controls.
 *   2. Live fetch from football-data.org (held in a 6h process cache).
 *   3. Bundled end-of-2025-26 snapshot.
 *
 * The endpoint must NEVER hard-fail the dashboard, hence the layered fallback.
 * `source` tells the client which path produced the data.
 */

import type { ApiApp } from '../serverless/types'
import { supabase } from '../lib/supabase'
import { authMiddleware } from '../middleware/auth'
import {
  buildFallback,
  fetchLive,
  COMPETITION_LABEL,
  type LeagueId,
  type LeagueTableResponse,
  type LeagueTableRow,
} from '../lib/league-table-source'

export type { LeagueTableRow, LeagueTableResponse } from '../lib/league-table-source'

// In-memory cache of the last successful LIVE fetch, per league. football-data
// free tier is rate-limited (~10 req/min) and standings change only on match
// days, so we hold a live result for 6h between callers.
const LIVE_TTL_MS = 6 * 60 * 60 * 1000
const liveCache = new Map<string, { data: LeagueTableResponse; expires: number }>()

// Read the newest active admin snapshot for a league, if one exists.
async function readActiveSnapshot(leagueId: LeagueId): Promise<LeagueTableResponse | null> {
  const { data, error } = await supabase
    .from('league_table_snapshots')
    .select('competition, season, source, standings, fetched_at')
    .eq('league_id', leagueId)
    .eq('is_active', true)
    .order('fetched_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error || !data) return null
  return {
    leagueId,
    competition: (data.competition as string) ?? COMPETITION_LABEL[leagueId],
    season: (data.season as string) ?? '',
    source: (data.source as 'live' | 'fallback') ?? 'live',
    fetchedAt: new Date(data.fetched_at as string).toISOString(),
    standings: (data.standings as LeagueTableRow[]) ?? [],
  }
}

export async function leagueTableRoutes(app: ApiApp) {
  app.addHook('preHandler', authMiddleware)

  app.get('/league-table', async (request, reply) => {
    // Resolve the caller's league from their club. Defaults to the Championship
    // when the club row can't be read — this is a read-only convenience view.
    let leagueId: LeagueId = 'efl-championship'
    try {
      const { data: club } = await supabase
        .from('clubs')
        .select('league_id')
        .eq('id', request.clubId)
        .maybeSingle()
      if (club?.league_id === 'premier-league') leagueId = 'premier-league'
    } catch (err) {
      request.log.warn({ err }, 'league-table: club lookup failed, defaulting to Championship')
    }

    // 1. Admin-managed snapshot wins, when present.
    try {
      const snapshot = await readActiveSnapshot(leagueId)
      if (snapshot && snapshot.standings.length > 0) return reply.send(snapshot)
    } catch (err) {
      request.log.warn({ err }, 'league-table: snapshot read failed, trying live')
    }

    // 2. Live fetch (cached).
    const apiKey = process.env['FOOTBALL_DATA_API_KEY']
    if (apiKey) {
      const cached = liveCache.get(leagueId)
      if (cached && cached.expires > Date.now()) return reply.send(cached.data)

      const live = await fetchLive(leagueId, apiKey)
      if (live) {
        liveCache.set(leagueId, { data: live, expires: Date.now() + LIVE_TTL_MS })
        return reply.send(live)
      }
      request.log.warn('league-table: live fetch failed, serving fallback snapshot')
    }

    // 3. Bundled fallback.
    return reply.send(buildFallback(leagueId))
  })
}
