import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import { FootballDataStandingsProvider } from './football-data'
import { providerFetch } from './http'
import { TransfermarktSquadProvider } from './transfermarkt'

const originalFetch = globalThis.fetch
const originalEnv = {
  transfermarktApi: process.env['TRANSFERMARKT_API_URL'],
  transfermarktWeb: process.env['TRANSFERMARKT_WEB_URL'],
  footballData: process.env['FOOTBALL_DATA_API_KEY'],
}

afterEach(() => {
  globalThis.fetch = originalFetch
  if (originalEnv.transfermarktApi == null) delete process.env['TRANSFERMARKT_API_URL']
  else process.env['TRANSFERMARKT_API_URL'] = originalEnv.transfermarktApi
  if (originalEnv.transfermarktWeb == null) delete process.env['TRANSFERMARKT_WEB_URL']
  else process.env['TRANSFERMARKT_WEB_URL'] = originalEnv.transfermarktWeb
  if (originalEnv.footballData == null) delete process.env['FOOTBALL_DATA_API_KEY']
  else process.env['FOOTBALL_DATA_API_KEY'] = originalEnv.footballData
})

describe('provider adapters', () => {
  it('normalises Transfermarkt public fields without introducing financial data', async () => {
    process.env['TRANSFERMARKT_API_URL'] = 'https://transfer.test'
    process.env['TRANSFERMARKT_WEB_URL'] = 'https://web.test'
    globalThis.fetch = async (input) => {
      const url = String(input)
      if (url.endsWith('/profile')) return Response.json({ name: 'Fixture FC', image: 'https://img.test/club.png' })
      if (url.endsWith('/players')) return Response.json({ players: Array.from({ length: 11 }, (_, index) => ({
        id: String(index + 1), name: `Player ${index + 1}`, position: index === 0 ? 'Goalkeeper' : 'Central Midfield',
        dateOfBirth: 'Jan 01, 2000', nationality: ['England'], joinedOn: 'Jul 01, 2024', contract: 'Jun 30, 2029',
        weeklyWage: 0, transferFee: 0,
      })) })
      if (url.includes('/kader/')) return new Response('<div class="rn_nummer">8</div><a href="/profil/spieler/2">Player</a>')
      if (url.includes('/mitarbeiter/')) return new Response('<html>No staff fixture</html>')
      throw new Error(`Unexpected URL ${url}`)
    }
    const snapshot = await new TransfermarktSquadProvider().fetchClubSquad({
      externalClubId: '100', competition: 'PREMIER_LEAGUE', season: '2026',
    })
    assert.equal(snapshot.players.length, 11)
    assert.equal(snapshot.players[0]?.position, 'GK')
    assert.equal(snapshot.players[1]?.squadNumber, 8)
    assert.equal(snapshot.players[0]?.dateOfBirth, '2000-01-01')
    assert.equal('weeklyWage' in snapshot.players[0]!, false)
    assert.equal('transferFee' in snapshot.players[0]!, false)
  })

  it('normalises a football-data.org standings response', async () => {
    process.env['FOOTBALL_DATA_API_KEY'] = 'fixture-key'
    globalThis.fetch = async (_input, init) => {
      assert.equal((init?.headers as Record<string, string>)['X-Auth-Token'], 'fixture-key')
      return Response.json({
        competition: { code: 'PL', name: 'Premier League' },
        season: { startDate: '2026-08-01', endDate: '2027-05-20' },
        standings: [{ type: 'TOTAL', table: Array.from({ length: 20 }, (_, index) => ({
          position: index + 1, team: { id: index + 1, name: `Club ${index + 1}`, shortName: `Club ${index + 1}`, crest: null },
          playedGames: 10, won: 5, draw: 2, lost: 3, goalsFor: 20, goalsAgainst: 10,
          goalDifference: 10, points: 17,
        })) }],
      })
    }
    const snapshot = await new FootballDataStandingsProvider().fetchStandings({ competition: 'PREMIER_LEAGUE', season: '2026' })
    assert.equal(snapshot.season, '2026-27')
    assert.equal(snapshot.standings.length, 20)
    assert.equal(snapshot.standings[0]?.drawn, 2)
  })

  it('honours Retry-After and retries a rate-limited request', async () => {
    let calls = 0
    globalThis.fetch = async () => {
      calls++
      return calls === 1
        ? new Response('rate limited', { status: 429, headers: { 'Retry-After': '0' } })
        : Response.json({ ok: true })
    }
    const response = await providerFetch('https://provider.test', {}, 2)
    assert.equal(response.status, 200)
    assert.equal(calls, 2)
  })
})
