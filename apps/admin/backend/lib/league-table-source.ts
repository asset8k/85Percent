/**
 * league-table-source — shared football-data.org fetch + bundled fallback for
 * real-world standings. Used by:
 *   • routes/league-table.ts  (serves the table; prefers a stored snapshot)
 *   • Data Sync standings import (validated atomic snapshot publication)
 *
 * The football-data.org key (FOOTBALL_DATA_API_KEY) is read server-side only.
 */

export type LeagueId = 'premier-league' | 'efl-championship'
export const LEAGUE_IDS: LeagueId[] = ['premier-league', 'efl-championship']
export const CURRENT_LEAGUE_SEASON_START_YEAR = 2026
export const CURRENT_LEAGUE_SEASON = '2026-27'

export interface LeagueTableRow {
  position: number
  team: string
  shortName: string
  crest: string | null
  played: number
  won: number
  drawn: number
  lost: number
  goalsFor: number
  goalsAgainst: number
  goalDifference: number
  points: number
}

export interface LeagueTableResponse {
  leagueId: LeagueId
  competition: string
  season: string
  /** 'live' from the upstream API, 'fallback' from the bundled seed. */
  source: 'live' | 'fallback'
  fetchedAt: string
  standings: LeagueTableRow[]
}

// football-data.org competition codes.
const COMPETITION_CODE: Record<LeagueId, string> = {
  'premier-league': 'PL',
  'efl-championship': 'ELC',
}

export const COMPETITION_LABEL: Record<LeagueId, string> = {
  'premier-league': 'Premier League',
  'efl-championship': 'EFL Championship',
}

// ---------------------------------------------------------------------------
// Bundled fallback — the 2026-27 membership before a live table is available.
// Results deliberately start at zero; serving final 2025-26 results as current
// standings would be materially misleading.
// ---------------------------------------------------------------------------
type Seed = [team: string, short: string]

const PL_SEED: Seed[] = [
  ['AFC Bournemouth', 'Bournemouth'],
  ['Arsenal FC', 'Arsenal'],
  ['Aston Villa', 'Aston Villa'],
  ['Brentford FC', 'Brentford'],
  ['Brighton & Hove Albion', 'Brighton'],
  ['Chelsea FC', 'Chelsea'],
  ['Coventry City', 'Coventry'],
  ['Crystal Palace', 'Crystal Palace'],
  ['Everton FC', 'Everton'],
  ['Fulham FC', 'Fulham'],
  ['Hull City', 'Hull City'],
  ['Ipswich Town', 'Ipswich'],
  ['Leeds United', 'Leeds'],
  ['Liverpool FC', 'Liverpool'],
  ['Manchester City', 'Man City'],
  ['Manchester United', 'Man United'],
  ['Newcastle United', 'Newcastle'],
  ['Nottingham Forest', "Nott'm Forest"],
  ['Sunderland AFC', 'Sunderland'],
  ['Tottenham Hotspur', 'Tottenham'],
]

const ELC_SEED: Seed[] = [
  ['Birmingham City', 'Birmingham'],
  ['Blackburn Rovers', 'Blackburn'],
  ['Bolton Wanderers', 'Bolton'],
  ['Bristol City', 'Bristol City'],
  ['Burnley FC', 'Burnley'],
  ['Cardiff City', 'Cardiff'],
  ['Charlton Athletic', 'Charlton'],
  ['Derby County', 'Derby'],
  ['Lincoln City', 'Lincoln'],
  ['Middlesbrough FC', 'Middlesbrough'],
  ['Millwall FC', 'Millwall'],
  ['Norwich City', 'Norwich'],
  ['Portsmouth FC', 'Portsmouth'],
  ['Preston North End', 'Preston'],
  ['Queens Park Rangers', 'QPR'],
  ['Sheffield United', 'Sheffield Utd'],
  ['Southampton FC', 'Southampton'],
  ['Stoke City', 'Stoke'],
  ['Swansea City', 'Swansea'],
  ['Watford FC', 'Watford'],
  ['West Bromwich Albion', 'West Brom'],
  ['West Ham United', 'West Ham'],
  ['Wolverhampton Wanderers', 'Wolves'],
  ['Wrexham AFC', 'Wrexham'],
]

export function buildFallback(leagueId: LeagueId): LeagueTableResponse {
  const seed = leagueId === 'premier-league' ? PL_SEED : ELC_SEED
  const standings: LeagueTableRow[] = seed.map(([team, shortName], i) => ({
    position: i + 1,
    team,
    shortName,
    crest: null,
    played: 0,
    won: 0,
    drawn: 0,
    lost: 0,
    goalsFor: 0,
    goalsAgainst: 0,
    goalDifference: 0,
    points: 0,
  }))
  return {
    leagueId,
    competition: COMPETITION_LABEL[leagueId],
    season: CURRENT_LEAGUE_SEASON,
    source: 'fallback',
    fetchedAt: new Date().toISOString(),
    standings,
  }
}

// ---------------------------------------------------------------------------
// Live fetch — football-data.org /v4/competitions/{code}/standings
// ---------------------------------------------------------------------------
interface FDTeam { name?: string; shortName?: string; tla?: string; crest?: string }
interface FDRow {
  position: number
  team: FDTeam
  playedGames: number
  won: number
  draw: number
  lost: number
  goalsFor: number
  goalsAgainst: number
  goalDifference: number
  points: number
}
interface FDStandings {
  filters?: { season?: string }
  season?: { startDate?: string; endDate?: string }
  standings?: Array<{ type: string; table: FDRow[] }>
}

export async function fetchLive(
  leagueId: LeagueId,
  apiKey: string,
  seasonStartYear = CURRENT_LEAGUE_SEASON_START_YEAR,
): Promise<LeagueTableResponse | null> {
  const code = COMPETITION_CODE[leagueId]
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 6000)
  try {
    const res = await fetch(`https://api.football-data.org/v4/competitions/${code}/standings?season=${seasonStartYear}`, {
      headers: { 'X-Auth-Token': apiKey },
      signal: controller.signal,
    })
    if (!res.ok) return null
    const data = (await res.json()) as FDStandings
    // The "TOTAL" table is the conventional overall league table (vs HOME/AWAY).
    const total = data.standings?.find((s) => s.type === 'TOTAL') ?? data.standings?.[0]
    if (!total || !Array.isArray(total.table) || total.table.length === 0) return null

    const standings: LeagueTableRow[] = total.table.map((r) => ({
      position: r.position,
      team: r.team.name ?? r.team.shortName ?? 'Unknown',
      shortName: r.team.shortName ?? r.team.tla ?? r.team.name ?? 'Unknown',
      crest: r.team.crest ?? null,
      played: r.playedGames,
      won: r.won,
      drawn: r.draw,
      lost: r.lost,
      goalsFor: r.goalsFor,
      goalsAgainst: r.goalsAgainst,
      goalDifference: r.goalDifference,
      points: r.points,
    }))

    const startYear = data.season?.startDate?.slice(0, 4)
    const endYY = data.season?.endDate?.slice(2, 4)
    const season = startYear && endYY ? `${startYear}-${endYY}` : String(data.filters?.season ?? '')

    return {
      leagueId,
      competition: COMPETITION_LABEL[leagueId],
      season,
      source: 'live',
      fetchedAt: new Date().toISOString(),
      standings,
    }
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
  }
}
