import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  buildFallback,
  CURRENT_LEAGUE_SEASON,
} from '../lib/league-table-source'

describe('2026-27 league fallback catalog', () => {
  it('uses the current season and does not present prior-season results as current', () => {
    for (const [leagueId, expectedCount] of [['premier-league', 20], ['efl-championship', 24]] as const) {
      const table = buildFallback(leagueId)
      assert.equal(table.season, CURRENT_LEAGUE_SEASON)
      assert.equal(table.standings.length, expectedCount)
      assert.ok(table.standings.every((row) => row.played === 0 && row.points === 0))
    }
  })

  it('uses the 2026-27 promoted and relegated club membership', () => {
    const premierLeague = new Set(buildFallback('premier-league').standings.map((row) => row.team))
    const championship = new Set(buildFallback('efl-championship').standings.map((row) => row.team))

    for (const club of ['Coventry City', 'Hull City', 'Ipswich Town']) assert.ok(premierLeague.has(club))
    for (const club of ['Burnley FC', 'West Ham United', 'Wolverhampton Wanderers', 'Bolton Wanderers', 'Cardiff City', 'Lincoln City']) {
      assert.ok(championship.has(club))
    }
    for (const club of ['Burnley FC', 'West Ham United', 'Wolverhampton Wanderers']) assert.ok(!premierLeague.has(club))
    for (const club of ['Leicester City', 'Oxford United', 'Sheffield Wednesday']) assert.ok(!championship.has(club))
  })
})
