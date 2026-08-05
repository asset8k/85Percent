import {
  mapPosition,
  normaliseNationality,
  parseShirtNumber,
  parseTransfermarktDate,
  type TransfermarktPlayer,
} from '../../scripts/transfermarkt-mappers'
import { extractHeadCoach } from '../../scripts/transfermarkt-coach-scraper'
import { parseSquadNumbers } from '../../scripts/transfermarkt-squad-scraper'
import { DataImportError } from '../errors'
import {
  importedSquadSnapshotSchema,
  type ImportedCoach,
  type ImportedPlayer,
  type ImportCompetition,
  type SquadProvider,
} from '../types'
import { providerJson, providerText } from './http'

const COMPETITION_ID: Record<ImportCompetition, string> = {
  PREMIER_LEAGUE: 'GB1',
  CHAMPIONSHIP: 'GB2',
}

interface CompetitionClubsResponse { clubs?: Array<{ id?: string; name?: string }> }
interface ClubPlayersResponse { players?: TransfermarktPlayer[] }
interface ClubProfileResponse { name?: string; image?: string | null }

function isoDate(date: Date | null): string | null {
  return date ? date.toISOString().slice(0, 10) : null
}

function fieldsOf(record: Record<string, unknown>): ImportedPlayer['sourceFields'] {
  const supported = [
    'name', 'position', 'squadNumber', 'nationality', 'dateOfBirth',
    'joinedDate', 'contractStart', 'contractEnd',
  ] as const
  return supported.filter((field) => record[field] != null)
}

export class TransfermarktSquadProvider implements SquadProvider {
  readonly name = 'transfermarkt'
  private readonly apiBase = (process.env['TRANSFERMARKT_API_URL'] ?? 'http://localhost:8000').replace(/\/+$/, '')
  private readonly webBase = (process.env['TRANSFERMARKT_WEB_URL'] ?? 'https://www.transfermarkt.com').replace(/\/+$/, '')

  async discoverClubs(competition: ImportCompetition, season: string) {
    const data = await providerJson<CompetitionClubsResponse>(
      `${this.apiBase}/competitions/${COMPETITION_ID[competition]}/clubs?season_id=${encodeURIComponent(season)}`,
      { headers: { accept: 'application/json' } },
    )
    return (data.clubs ?? []).flatMap((club) => {
      const externalClubId = club.id?.trim()
      const name = club.name?.trim()
      return externalClubId && name ? [{ externalClubId, name }] : []
    })
  }

  async fetchClubSquad(input: {
    externalClubId: string
    competition: ImportCompetition
    season: string
  }) {
    const { externalClubId, competition, season } = input
    const headers = { accept: 'application/json' }
    const [profile, squad, numbers, coach] = await Promise.all([
      providerJson<ClubProfileResponse>(`${this.apiBase}/clubs/${externalClubId}/profile`, { headers }),
      providerJson<ClubPlayersResponse>(`${this.apiBase}/clubs/${externalClubId}/players`, { headers }),
      this.fetchSquadNumbers(externalClubId, season),
      this.fetchCoach(externalClubId),
    ])

    const players = (squad.players ?? []).flatMap((raw): ImportedPlayer[] => {
      const name = raw.name?.trim()
      if (!name) return []
      const extension = parseTransfermarktDate(raw.lastExtension ?? raw.last_extension ?? raw.contractExtension)
      const joined = parseTransfermarktDate(raw.joinedOn ?? raw.joined)
      const record = {
        provider: this.name,
        externalId: raw.id?.trim() || null,
        name,
        position: mapPosition(raw.position),
        squadNumber: raw.id ? (numbers.get(raw.id) ?? null) : null,
        nationality: normaliseNationality(raw.nationality),
        dateOfBirth: isoDate(parseTransfermarktDate(raw.dateOfBirth)),
        joinedDate: isoDate(joined),
        contractStart: isoDate(extension ?? joined),
        contractEnd: isoDate(parseTransfermarktDate(raw.contract)),
      }
      return [{ ...record, sourceFields: fieldsOf(record) }]
    })

    if (!profile.name?.trim() || players.length === 0) {
      throw new DataImportError('INVALID_PROVIDER_RESPONSE', 'Club profile or player list was empty')
    }

    return importedSquadSnapshotSchema.parse({
      provider: this.name,
      externalClubId,
      clubName: profile.name.trim(),
      competition,
      season,
      logoUrl: profile.image ?? null,
      players,
      coach,
      retrievedAt: new Date().toISOString(),
    })
  }

  private browserHeaders() {
    return {
      'user-agent': 'Mozilla/5.0 (compatible; 85PercentDataSync/1.0; +https://85percent.pro)',
      accept: 'text/html,application/xhtml+xml',
      'accept-language': 'en-GB,en;q=0.9',
    }
  }

  private async fetchSquadNumbers(clubId: string, season: string): Promise<Map<string, number>> {
    try {
      const html = await providerText(
        `${this.webBase}/-/kader/verein/${clubId}/saison_id/${season}/plus/1`,
        { headers: this.browserHeaders() },
      )
      const parsed = parseSquadNumbers(html)
      return new Map([...parsed.entries()].flatMap(([id, value]) => {
        const number = parseShirtNumber(value)
        return number == null ? [] : [[id, number]]
      }))
    } catch {
      return new Map()
    }
  }

  private async fetchCoach(clubId: string): Promise<ImportedCoach | null> {
    try {
      const html = await providerText(`${this.webBase}/-/mitarbeiter/verein/${clubId}`, {
        headers: this.browserHeaders(),
      })
      const raw = extractHeadCoach(html)
      if (!raw) return null
      const record = {
        provider: this.name,
        externalId: null,
        name: raw.name,
        nationality: raw.nationality,
        dateOfBirth: null,
        contractStart: raw.appointed,
        contractEnd: raw.contractExpires,
      }
      return { ...record, sourceFields: fieldsOf(record) }
    } catch {
      return null
    }
  }
}
