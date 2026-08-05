import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { validateStandingsSnapshot } from './standings'
import type { ImportedStandingsSnapshot, SourceMapping } from './types'

function fixture(count: number, competition: 'PREMIER_LEAGUE' | 'CHAMPIONSHIP'): {
  snapshot: ImportedStandingsSnapshot
  mappings: SourceMapping[]
} {
  const standings = Array.from({ length: count }, (_, index) => ({
    externalClubId: `external-${index + 1}`, team: `Club ${index + 1}`,
    shortName: `C${index + 1}`, crest: null, position: index + 1,
    played: 10, won: 5, drawn: 2, lost: 3, goalsFor: 20, goalsAgainst: 10,
    goalDifference: 10, points: 17,
  }))
  return {
    snapshot: {
      provider: 'fixture', competition,
      leagueId: competition === 'PREMIER_LEAGUE' ? 'premier-league' : 'efl-championship',
      competitionName: competition === 'PREMIER_LEAGUE' ? 'Premier League' : 'EFL Championship',
      season: '2026-27', standings, retrievedAt: '2026-08-05T00:00:00.000Z',
    },
    mappings: standings.map((row, index) => ({
      provider: 'fixture', entityType: 'CLUB', internalId: `club-${index + 1}`,
      externalId: row.externalClubId, templateClubId: `club-${index + 1}`,
    })),
  }
}

describe('standings validation', () => {
  it('accepts complete Premier League and Championship tables', () => {
    for (const [count, competition] of [[20, 'PREMIER_LEAGUE'], [24, 'CHAMPIONSHIP']] as const) {
      const { snapshot, mappings } = fixture(count, competition)
      assert.equal(validateStandingsSnapshot(snapshot, mappings).length, count)
    }
  })

  it('rejects incomplete, duplicate, invalid-total, and unmapped tables before publication', () => {
    const incomplete = fixture(19, 'PREMIER_LEAGUE')
    assert.throws(() => validateStandingsSnapshot(incomplete.snapshot, incomplete.mappings), /Expected 20/)

    const duplicate = fixture(20, 'PREMIER_LEAGUE')
    duplicate.snapshot.standings[1]!.position = 1
    assert.throws(() => validateStandingsSnapshot(duplicate.snapshot, duplicate.mappings), /Duplicate position/)

    const invalid = fixture(20, 'PREMIER_LEAGUE')
    invalid.snapshot.standings[0]!.played = 9
    assert.throws(() => validateStandingsSnapshot(invalid.snapshot, invalid.mappings), /Invalid totals/)

    const unmapped = fixture(20, 'PREMIER_LEAGUE')
    unmapped.mappings.pop()
    assert.throws(() => validateStandingsSnapshot(unmapped.snapshot, unmapped.mappings), /No fixture mapping/)
  })
})
