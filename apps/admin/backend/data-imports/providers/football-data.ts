import { DataImportError } from '../errors'
import {
  importedStandingsSnapshotSchema,
  type ImportCompetition,
  type StandingsProvider,
} from '../types'
import { providerJson } from './http'

const COMPETITION_CODE: Record<ImportCompetition, string> = {
  PREMIER_LEAGUE: 'PL',
  CHAMPIONSHIP: 'ELC',
}
const LEAGUE_ID = {
  PREMIER_LEAGUE: 'premier-league',
  CHAMPIONSHIP: 'efl-championship',
} as const
const COMPETITION_NAME = {
  PREMIER_LEAGUE: 'Premier League',
  CHAMPIONSHIP: 'EFL Championship',
} as const

interface FootballDataResponse {
  filters?: { season?: string }
  competition?: { code?: string; name?: string }
  season?: { startDate?: string; endDate?: string }
  standings?: Array<{
    type?: string
    table?: Array<{
      position?: number
      team?: { id?: number; name?: string; shortName?: string; tla?: string; crest?: string }
      playedGames?: number
      won?: number
      draw?: number
      lost?: number
      goalsFor?: number
      goalsAgainst?: number
      goalDifference?: number
      points?: number
    }>
  }>
}

export class FootballDataStandingsProvider implements StandingsProvider {
  readonly name = 'football-data.org'

  async fetchStandings(input: { competition: ImportCompetition; season: string }) {
    const apiKey = process.env['FOOTBALL_DATA_API_KEY']
    if (!apiKey) {
      throw new DataImportError('IMPORT_CONFIGURATION_INVALID', 'FOOTBALL_DATA_API_KEY is not configured')
    }

    const code = COMPETITION_CODE[input.competition]
    const data = await providerJson<FootballDataResponse>(
      `https://api.football-data.org/v4/competitions/${code}/standings?season=${encodeURIComponent(input.season)}`,
      { headers: { 'X-Auth-Token': apiKey, accept: 'application/json' } },
    )
    if (data.competition?.code && data.competition.code !== code) {
      throw new DataImportError('INVALID_PROVIDER_RESPONSE', 'Competition did not match the request')
    }
    const total = data.standings?.find((standing) => standing.type === 'TOTAL') ?? data.standings?.[0]
    if (!total?.table?.length) {
      throw new DataImportError('INVALID_PROVIDER_RESPONSE', 'No total standings table was returned')
    }

    const startYear = data.season?.startDate?.slice(0, 4)
    const endYear = data.season?.endDate?.slice(2, 4)
    const season = startYear && endYear ? `${startYear}-${endYear}` : String(data.filters?.season ?? input.season)

    return importedStandingsSnapshotSchema.parse({
      provider: this.name,
      competition: input.competition,
      leagueId: LEAGUE_ID[input.competition],
      competitionName: COMPETITION_NAME[input.competition],
      season,
      standings: total.table.map((row) => ({
        externalClubId: String(row.team?.id ?? ''),
        team: row.team?.name ?? row.team?.shortName ?? '',
        shortName: row.team?.shortName ?? row.team?.tla ?? row.team?.name ?? '',
        crest: row.team?.crest ?? null,
        position: row.position,
        played: row.playedGames,
        won: row.won,
        drawn: row.draw,
        lost: row.lost,
        goalsFor: row.goalsFor,
        goalsAgainst: row.goalsAgainst,
        goalDifference: row.goalDifference,
        points: row.points,
      })),
      retrievedAt: new Date().toISOString(),
    })
  }
}
