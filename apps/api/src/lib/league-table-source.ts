/**
 * league-table-source — shared football-data.org fetch + bundled fallback for
 * real-world standings. Used by:
 *   • routes/league-table.ts  (serves the table; prefers a stored snapshot)
 *   • scripts/update-league-table.ts  (admin-triggered refresh → snapshot)
 *
 * The football-data.org key (FOOTBALL_DATA_API_KEY) is read server-side only.
 */

export type LeagueId = 'premier-league' | 'efl-championship'
export const LEAGUE_IDS: LeagueId[] = ['premier-league', 'efl-championship']

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
// Bundled fallback — end of 2025-26 season standings.
// `id` is the football-data.org team id, used to build the public crest URL.
// ---------------------------------------------------------------------------
type Seed = [team: string, short: string, id: number, won: number, drawn: number, gf: number, ga: number]

const PL_SEED: Seed[] = [
  ['Liverpool FC', 'Liverpool', 64, 26, 6, 86, 38],
  ['Arsenal FC', 'Arsenal', 57, 25, 6, 78, 34],
  ['Manchester City FC', 'Man City', 65, 23, 6, 80, 44],
  ['Chelsea FC', 'Chelsea', 61, 21, 7, 74, 48],
  ['Newcastle United FC', 'Newcastle', 67, 20, 6, 68, 50],
  ['Aston Villa FC', 'Aston Villa', 58, 19, 7, 66, 52],
  ['Nottingham Forest FC', "Nott'm Forest", 351, 17, 9, 58, 50],
  ['Brighton & Hove Albion FC', 'Brighton', 397, 15, 12, 60, 55],
  ['AFC Bournemouth', 'Bournemouth', 1044, 16, 8, 58, 56],
  ['Brentford FC', 'Brentford', 402, 15, 8, 62, 60],
  ['Crystal Palace FC', 'Crystal Palace', 354, 14, 9, 52, 52],
  ['Fulham FC', 'Fulham', 63, 14, 8, 54, 58],
  ['Everton FC', 'Everton', 62, 12, 11, 44, 50],
  ['Tottenham Hotspur FC', 'Tottenham', 73, 12, 8, 60, 62],
  ['Manchester United FC', 'Man United', 66, 11, 10, 50, 58],
  ['West Ham United FC', 'West Ham', 563, 11, 7, 48, 66],
  ['Wolverhampton Wanderers FC', 'Wolves', 76, 10, 8, 46, 68],
  ['Sunderland AFC', 'Sunderland', 71, 9, 8, 40, 66],
  ['Burnley FC', 'Burnley', 328, 7, 9, 34, 70],
  ['Leeds United FC', 'Leeds', 341, 6, 8, 38, 75],
]

const ELC_SEED: Seed[] = [
  ['Leicester City FC', 'Leicester', 338, 28, 6, 82, 40],
  ['Southampton FC', 'Southampton', 340, 26, 7, 78, 42],
  ['Ipswich Town FC', 'Ipswich', 349, 25, 7, 76, 44],
  ['West Bromwich Albion FC', 'West Brom', 74, 23, 9, 70, 45],
  ['Middlesbrough FC', 'Middlesbrough', 343, 22, 9, 72, 50],
  ['Coventry City FC', 'Coventry', 1076, 21, 9, 74, 55],
  ['Norwich City FC', 'Norwich', 68, 20, 10, 68, 54],
  ['Sheffield United FC', 'Sheffield Utd', 356, 19, 11, 62, 50],
  ['Bristol City FC', 'Bristol City', 387, 18, 12, 60, 52],
  ['Watford FC', 'Watford', 346, 18, 9, 64, 60],
  ['Millwall FC', 'Millwall', 384, 16, 12, 56, 56],
  ['Blackburn Rovers FC', 'Blackburn', 59, 15, 13, 54, 56],
  ['Preston North End FC', 'Preston', 1081, 15, 11, 52, 58],
  ['Swansea City AFC', 'Swansea', 72, 14, 12, 55, 60],
  ['Hull City AFC', 'Hull City', 322, 13, 13, 50, 60],
  ['Cardiff City FC', 'Cardiff', 715, 13, 11, 48, 62],
  ['Queens Park Rangers FC', 'QPR', 69, 12, 12, 46, 60],
  ['Stoke City FC', 'Stoke', 70, 12, 10, 44, 64],
  ['Sheffield Wednesday FC', 'Sheffield Wed', 345, 11, 11, 42, 66],
  ['Derby County FC', 'Derby', 342, 10, 12, 40, 64],
  ['Portsmouth FC', 'Portsmouth', 325, 10, 10, 38, 68],
  ['Oxford United FC', 'Oxford Utd', 1082, 9, 9, 36, 72],
  ['Plymouth Argyle FC', 'Plymouth', 1138, 8, 8, 34, 78],
  ['Luton Town FC', 'Luton', 389, 7, 7, 30, 82],
]

export function buildFallback(leagueId: LeagueId): LeagueTableResponse {
  const seed = leagueId === 'premier-league' ? PL_SEED : ELC_SEED
  const gamesPerTeam = (seed.length - 1) * 2
  const standings: LeagueTableRow[] = seed.map(([team, shortName, id, won, drawn, gf, ga], i) => ({
    position: i + 1,
    team,
    shortName,
    crest: `https://crests.football-data.org/${id}.png`,
    played: gamesPerTeam,
    won,
    drawn,
    lost: gamesPerTeam - won - drawn,
    goalsFor: gf,
    goalsAgainst: ga,
    goalDifference: gf - ga,
    points: won * 3 + drawn,
  }))
  return {
    leagueId,
    competition: COMPETITION_LABEL[leagueId],
    season: '2025-26',
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

export async function fetchLive(leagueId: LeagueId, apiKey: string): Promise<LeagueTableResponse | null> {
  const code = COMPETITION_CODE[leagueId]
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 6000)
  try {
    const res = await fetch(`https://api.football-data.org/v4/competitions/${code}/standings`, {
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
