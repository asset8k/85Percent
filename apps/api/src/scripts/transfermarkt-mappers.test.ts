// Unit tests for the pure Transfermarkt mappers. Run with:
//   pnpm --filter @headroom/api test:scripts
// (node:test via tsx — no extra deps, no DB connection required).

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  mapPosition,
  parseTransfermarktDate,
  parseMarketValueToPence,
  parseShirtNumber,
  normaliseNationality,
  mapPlayerToRosterItem,
  mapCoachToRosterItem,
} from './transfermarkt-mappers.js'

describe('mapPosition', () => {
  it('maps keepers to GK', () => {
    assert.equal(mapPosition('Goalkeeper'), 'GK')
    assert.equal(mapPosition('GK'), 'GK')
  })
  it('maps defenders to DEF', () => {
    assert.equal(mapPosition('Centre-Back'), 'DEF')
    assert.equal(mapPosition('Left-Back'), 'DEF')
    assert.equal(mapPosition('Defender'), 'DEF')
    assert.equal(mapPosition('Sweeper'), 'DEF')
  })
  it('maps midfielders to MID', () => {
    assert.equal(mapPosition('Defensive Midfield'), 'MID')
    assert.equal(mapPosition('Attacking Midfield'), 'MID')
    assert.equal(mapPosition('Central Midfield'), 'MID')
  })
  it('maps attackers to FWD', () => {
    assert.equal(mapPosition('Left Winger'), 'FWD')
    assert.equal(mapPosition('Centre-Forward'), 'FWD')
    assert.equal(mapPosition('Second Striker'), 'FWD')
    assert.equal(mapPosition('Attacker'), 'FWD')
  })
  it('returns null for unknown / blank', () => {
    assert.equal(mapPosition(''), null)
    assert.equal(mapPosition(null), null)
    assert.equal(mapPosition('Bench Coach'), null)
  })
})

describe('parseTransfermarktDate', () => {
  it('parses Transfermarkt-style dates', () => {
    const d = parseTransfermarktDate('Mar 13, 1990')
    assert.ok(d)
    assert.equal(d.getFullYear(), 1990)
    assert.equal(d.getMonth(), 2) // March
    assert.equal(d.getDate(), 13)
  })
  it('parses ISO dates', () => {
    const d = parseTransfermarktDate('2027-06-30')
    assert.ok(d)
    assert.equal(d.getUTCFullYear(), 2027)
  })
  it('returns null for blanks / dashes / garbage', () => {
    assert.equal(parseTransfermarktDate(''), null)
    assert.equal(parseTransfermarktDate('-'), null)
    assert.equal(parseTransfermarktDate(null), null)
    assert.equal(parseTransfermarktDate('not a date'), null)
  })
})

describe('parseMarketValueToPence', () => {
  it('treats a raw number as major units → pence', () => {
    assert.equal(parseMarketValueToPence(50_000_000), 5_000_000_000n)
  })
  it('parses suffixed strings', () => {
    assert.equal(parseMarketValueToPence('€50.00m'), 5_000_000_000n)
    assert.equal(parseMarketValueToPence('€800k'), 80_000_000n)
    assert.equal(parseMarketValueToPence('€1.2bn'), 120_000_000_000n)
  })
  it('handles comma grouping', () => {
    assert.equal(parseMarketValueToPence('1,500,000'), 150_000_000n)
  })
  it('returns null for missing / non-positive / dash', () => {
    assert.equal(parseMarketValueToPence(null), null)
    assert.equal(parseMarketValueToPence(0), null)
    assert.equal(parseMarketValueToPence(-5), null)
    assert.equal(parseMarketValueToPence('-'), null)
    assert.equal(parseMarketValueToPence(''), null)
  })
})

describe('parseShirtNumber', () => {
  it('parses "#10" style strings', () => {
    assert.equal(parseShirtNumber('#10'), 10)
    assert.equal(parseShirtNumber('#1'), 1)
    assert.equal(parseShirtNumber('7'), 7)
    assert.equal(parseShirtNumber(23), 23)
  })
  it('rejects out-of-range / blank / dash', () => {
    assert.equal(parseShirtNumber('#0'), null)
    assert.equal(parseShirtNumber('100'), null)
    assert.equal(parseShirtNumber('-'), null)
    assert.equal(parseShirtNumber(''), null)
    assert.equal(parseShirtNumber(null), null)
    assert.equal(parseShirtNumber(undefined), null)
  })
})

describe('normaliseNationality', () => {
  it('keeps the primary nationality from an array', () => {
    assert.equal(normaliseNationality(['England', 'Jamaica']), 'England')
  })
  it('trims a string', () => {
    assert.equal(normaliseNationality('  Spain '), 'Spain')
  })
  it('returns null for empty', () => {
    assert.equal(normaliseNationality([]), null)
    assert.equal(normaliseNationality(null), null)
    assert.equal(normaliseNationality(''), null)
  })
})

describe('mapPlayerToRosterItem', () => {
  it('maps a full player record', () => {
    const item = mapPlayerToRosterItem({
      name: 'Cole Palmer',
      position: 'Attacking Midfield',
      dateOfBirth: 'May 6, 2002',
      nationality: ['England'],
      joined: 'Sep 1, 2023',
      contract: 'Jun 30, 2033',
      marketValue: 130_000_000,
    })
    assert.ok(item)
    assert.equal(item.name, 'Cole Palmer')
    assert.equal(item.position, 'MID')
    assert.equal(item.squadNumber, null) // enriched later from the profile call
    assert.equal(item.isManager, false)
    assert.equal(item.nationality, 'England')
    assert.equal(item.estimatedTransferFee, 13_000_000_000n)
    assert.ok(item.contractStart)
    assert.ok(item.contractEnd)
    assert.equal(item.contractEnd.getFullYear(), 2033)
  })
  it('tolerates missing optional fields', () => {
    const item = mapPlayerToRosterItem({ name: 'Trialist' })
    assert.ok(item)
    assert.equal(item.position, null)
    assert.equal(item.estimatedTransferFee, null)
    assert.equal(item.dateOfBirth, null)
    assert.equal(item.contractStart, null)
  })
  it('returns null when the name is blank', () => {
    assert.equal(mapPlayerToRosterItem({ name: '   ' }), null)
    assert.equal(mapPlayerToRosterItem({}), null)
  })
})

describe('mapCoachToRosterItem', () => {
  it('flags the coach as a manager with no position', () => {
    const item = mapCoachToRosterItem('Enzo Maresca', { contract: 'Jun 30, 2028' })
    assert.ok(item)
    assert.equal(item.isManager, true)
    assert.equal(item.position, null)
    assert.equal(item.estimatedTransferFee, null)
    assert.ok(item.contractEnd)
  })
  it('returns null for a blank coach name', () => {
    assert.equal(mapCoachToRosterItem(''), null)
    assert.equal(mapCoachToRosterItem(null), null)
  })
})
