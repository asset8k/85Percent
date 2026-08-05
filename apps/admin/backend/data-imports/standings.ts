import { DataImportError } from './errors'
import type { ImportedStandingsSnapshot, SourceMapping } from './types'

const EXPECTED_TEAMS = { PREMIER_LEAGUE: 20, CHAMPIONSHIP: 24 } as const

export interface ValidatedStanding {
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
  templateClubId: string
}

export function validateStandingsSnapshot(
  snapshot: ImportedStandingsSnapshot,
  mappings: SourceMapping[],
): ValidatedStanding[] {
  const expected = EXPECTED_TEAMS[snapshot.competition]
  if (snapshot.standings.length !== expected) {
    throw new DataImportError(
      'INVALID_PROVIDER_RESPONSE',
      `Expected ${expected} teams but received ${snapshot.standings.length}`,
      false,
      undefined,
      `Expected ${expected} teams but received ${snapshot.standings.length}. The previous table was preserved.`,
    )
  }

  const ids = new Set<string>()
  const positions = new Set<number>()
  const internalIds = new Set<string>()
  const mappingByExternalId = new Map(
    mappings
      .filter((mapping) => mapping.provider === snapshot.provider && mapping.entityType === 'CLUB')
      .map((mapping) => [mapping.externalId, mapping.internalId]),
  )

  const result = snapshot.standings.map((row) => {
    if (ids.has(row.externalClubId)) throw new DataImportError('INVALID_PROVIDER_RESPONSE', 'Duplicate team ID')
    if (positions.has(row.position)) throw new DataImportError('INVALID_PROVIDER_RESPONSE', 'Duplicate position')
    ids.add(row.externalClubId)
    positions.add(row.position)

    if (row.played !== row.won + row.drawn + row.lost || row.goalDifference !== row.goalsFor - row.goalsAgainst) {
      throw new DataImportError('INVALID_PROVIDER_RESPONSE', `Invalid totals for ${row.team}`)
    }
    const templateClubId = mappingByExternalId.get(row.externalClubId)
    if (!templateClubId) {
      throw new DataImportError(
        'CLUB_MAPPING_MISSING',
        `No ${snapshot.provider} mapping for ${row.team}`,
        false,
        undefined,
        `${row.team} is not mapped to an internal club. The previous table was preserved.`,
      )
    }
    if (internalIds.has(templateClubId)) {
      throw new DataImportError('INVALID_PROVIDER_RESPONSE', 'Two source teams map to the same club')
    }
    internalIds.add(templateClubId)
    return {
      position: row.position,
      team: row.team,
      shortName: row.shortName,
      crest: row.crest,
      played: row.played,
      won: row.won,
      drawn: row.drawn,
      lost: row.lost,
      goalsFor: row.goalsFor,
      goalsAgainst: row.goalsAgainst,
      goalDifference: row.goalDifference,
      points: row.points,
      templateClubId,
    }
  })

  for (let position = 1; position <= expected; position++) {
    if (!positions.has(position)) {
      throw new DataImportError('INVALID_PROVIDER_RESPONSE', `Position ${position} is missing`)
    }
  }
  return result.sort((a, b) => a.position - b.position)
}
