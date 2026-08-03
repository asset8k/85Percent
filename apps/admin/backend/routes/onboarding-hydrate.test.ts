// Tests for the onboarding hydration transform.
//
//   pnpm --filter @85percent/admin test:onboarding
//
// Two layers:
//  1. Pure unit tests of the helpers + buildHydratedRoster (synthetic input).
//  2. DB-backed tests that read the REAL template data filled by the sync
//     worker and run the transform over actual clubs + players, asserting the
//     hydration invariants (every wage 0, dates valid, fees ≥ 0, 1:1 linkage…).
//     These soft-skip if the template cache is empty (sync not yet run).

import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { supabase } from '../lib/supabase'
import {
  buildHydratedRoster,
  leagueIdToTemplate,
  templateToLeagueId,
  yearsBetween,
  toDateOnly,
  deriveShortName,
  resolveContractWindow,
  type TemplateRosterItemRow,
} from './onboarding-hydrate'

// ── 1. Pure helpers ──────────────────────────────────────────────────────────

describe('league mapping', () => {
  it('maps app league_id → template enum and back', () => {
    assert.equal(leagueIdToTemplate('premier-league'), 'PREMIER_LEAGUE')
    assert.equal(leagueIdToTemplate('efl-championship'), 'CHAMPIONSHIP')
    assert.equal(leagueIdToTemplate('la-liga'), null)
    assert.equal(templateToLeagueId('PREMIER_LEAGUE'), 'premier-league')
    assert.equal(templateToLeagueId('CHAMPIONSHIP'), 'efl-championship')
  })
})

describe('toDateOnly', () => {
  it('slices timestamps to YYYY-MM-DD', () => {
    assert.equal(toDateOnly('1997-11-18T00:00:00'), '1997-11-18')
    assert.equal(toDateOnly('2030-06-30'), '2030-06-30')
  })
  it('returns null for null / malformed', () => {
    assert.equal(toDateOnly(null), null)
    assert.equal(toDateOnly('not-a-date'), null)
  })
})

describe('deriveShortName', () => {
  it('produces a 3-letter upper code, stripping FC/AFC/CF', () => {
    assert.equal(deriveShortName('Chelsea FC'), 'CHE')
    assert.equal(deriveShortName('AFC Bournemouth'), 'BOU')
    assert.equal(deriveShortName('Wrexham AFC'), 'WRE')
    assert.equal(deriveShortName('Hull City'), 'HUL')
  })
})

describe('yearsBetween', () => {
  it('computes decimal years', () => {
    assert.equal(yearsBetween('2023-07-01', '2026-07-01'), 3)
    assert.ok(Math.abs(yearsBetween('2025-01-01', '2025-07-01') - 0.5) < 0.02)
  })
})

describe('resolveContractWindow', () => {
  const today = '2026-05-30'
  it('keeps valid template dates', () => {
    assert.deepEqual(resolveContractWindow('2023-05-08T00:00:00', '2030-06-30T00:00:00', today), {
      startDate: '2023-05-08',
      endDate: '2030-06-30',
    })
  })
  it('falls back to today → +3y when end is missing', () => {
    const w = resolveContractWindow('2024-01-01', null, today)
    assert.equal(w.startDate, '2024-01-01')
    assert.equal(w.endDate, '2027-01-01')
  })
  it('falls back when end ≤ start (bad data)', () => {
    const w = resolveContractWindow('2024-01-01', '2020-01-01', today)
    assert.equal(w.endDate, '2027-01-01')
  })
  it('uses today as start when start missing', () => {
    const w = resolveContractWindow(null, null, today)
    assert.equal(w.startDate, today)
    assert.equal(w.endDate, '2029-05-30')
  })
})

describe('buildHydratedRoster (synthetic)', () => {
  // Deterministic ids: p1,c1,p2,c2,... so we can assert player↔contract linkage.
  function seqIds() {
    let n = 0
    return () => `id${++n}`
  }
  const items: TemplateRosterItemRow[] = [
    {
      name: 'Cole Palmer',
      position: 'MID',
      squad_number: 10,
      nationality: 'England',
      is_manager: false,
      estimated_transfer_fee: 13_000_000_000,
      contract_start: '2023-09-01T00:00:00',
      contract_end: '2033-06-30T00:00:00',
      date_of_birth: '2002-05-06T00:00:00',
    },
    {
      name: 'No-Fee Trialist',
      position: null,
      squad_number: null,
      nationality: null,
      is_manager: false,
      estimated_transfer_fee: null,
      contract_start: null,
      contract_end: null,
      date_of_birth: null,
    },
    {
      name: 'Enzo Maresca',
      position: null,
      squad_number: null,
      nationality: 'Italy',
      is_manager: true,
      estimated_transfer_fee: 0,
      contract_start: '2024-07-01T00:00:00',
      contract_end: '2029-06-30T00:00:00',
      date_of_birth: null,
    },
  ]

  it('separates players from the manager and links contracts 1:1', () => {
    const h = buildHydratedRoster({
      clubId: 'club-1',
      templateName: 'Chelsea FC',
      templateLeague: 'PREMIER_LEAGUE',
      items,
      now: new Date('2026-05-30T00:00:00Z'),
      newId: seqIds(),
    })
    assert.equal(h.players.length, 2)
    assert.equal(h.contracts.length, 2)
    // Shirt number carries through to the player row (null when unknown).
    assert.equal(h.players[0]!['squad_number'], 10)
    assert.equal(h.players[1]!['squad_number'], null)
    for (let i = 0; i < h.players.length; i++) {
      assert.equal(h.contracts[i]!['player_id'], h.players[i]!['id'])
      assert.equal(h.contracts[i]!['club_id'], 'club-1')
    }
    // Manager produced separately.
    assert.ok(h.manager)
    assert.ok(h.managerContract)
    assert.equal(h.managerContract!['manager_id'], h.manager!['id'])
    assert.equal(h.manager!['name'], 'Enzo Maresca')
  })

  it('creates the manager with NO contract when Transfermarkt has no expiry', () => {
    // A head coach whose Coaching Staff row showed " - " for "Contract expires":
    // the manager should still be created (so the name shows), but we must NOT
    // fabricate a contract window — managerContract stays null for the CFO.
    const noEndItems: TemplateRosterItemRow[] = [
      {
        name: 'Pep Guardiola',
        position: null,
        squad_number: null,
        nationality: 'Spain',
        is_manager: true,
        estimated_transfer_fee: 0,
        contract_start: '2016-07-01T00:00:00',
        contract_end: null,
        date_of_birth: null,
      },
    ]
    const h = buildHydratedRoster({
      clubId: 'club-1', templateName: 'Man City', templateLeague: 'PREMIER_LEAGUE', items: noEndItems, now: new Date('2026-05-30T00:00:00Z'), newId: seqIds(),
    })
    assert.ok(h.manager)
    assert.equal(h.manager!['name'], 'Pep Guardiola')
    assert.equal(h.managerContract, null)
  })

  it('forces every wage to 0 and zeroes agent fees', () => {
    const h = buildHydratedRoster({
      clubId: 'c', templateName: 'X FC', templateLeague: 'CHAMPIONSHIP', items, now: new Date(),
    })
    for (const c of h.contracts) {
      assert.equal(c['annual_wage'], 0)
      assert.equal(c['agent_fee'], 0)
      assert.equal(c['phase_type'], 'INITIAL')
      assert.equal(c['is_current'], true)
      assert.equal(c['is_active'], true)
    }
    assert.equal(h.managerContract!['annual_wage'], 0)
  })

  it('seeds fee from the estimate, defaults missing fee to 0', () => {
    const h = buildHydratedRoster({
      clubId: 'c', templateName: 'X FC', templateLeague: 'CHAMPIONSHIP', items, now: new Date(), newId: seqIds(),
    })
    assert.equal(h.contracts[0]!['transfer_fee'], 13_000_000_000)
    assert.equal(h.contracts[1]!['transfer_fee'], 0)
    // Book value never exceeds the fee and is non-negative.
    for (const c of h.contracts) {
      const bv = Number(c['book_value'])
      assert.ok(bv >= 0)
      assert.ok(bv <= Number(c['transfer_fee']))
    }
  })

  it('marks extension-block rows as EXTENSION phases with no carried value yet', () => {
    const extItems: TemplateRosterItemRow[] = [
      {
        name: 'Reece James',
        position: 'DEF',
        squad_number: 24,
        nationality: 'England',
        is_manager: false,
        estimated_transfer_fee: null,
        contract_start: '2023-03-15T00:00:00',
        contract_end: '2028-06-30T00:00:00',
        date_of_birth: '1999-12-08T00:00:00',
        contract_start_from_extension: true,
      },
    ]
    const h = buildHydratedRoster({
      clubId: 'c', templateName: 'X FC', templateLeague: 'PREMIER_LEAGUE', items: extItems, now: new Date(),
    })
    assert.equal(h.contracts[0]!['phase_type'], 'EXTENSION')
    assert.equal(h.contracts[0]!['carried_book_value'], null)
    assert.equal(h.contracts[0]!['transfer_fee'], 0)
  })

  it('defaults non-extension rows to INITIAL with a null carried value', () => {
    const h = buildHydratedRoster({
      clubId: 'c', templateName: 'X FC', templateLeague: 'CHAMPIONSHIP', items, now: new Date(),
    })
    for (const c of h.contracts) {
      assert.equal(c['phase_type'], 'INITIAL')
      assert.equal(c['carried_book_value'], null)
    }
  })

  it('adopts club identity from the template', () => {
    const h = buildHydratedRoster({
      clubId: 'c', templateName: 'Chelsea FC', templateLeague: 'PREMIER_LEAGUE', items, now: new Date(),
    })
    assert.deepEqual(h.identity, { name: 'Chelsea FC', shortName: 'CHE', leagueId: 'premier-league' })
  })
})

// ── 2. DB-backed: run the transform over the real filled template data ───────

const VALID_POSITIONS = new Set(['GK', 'DEF', 'MID', 'FWD'])

async function loadTemplateClubs() {
  const { data, error } = await supabase.from('template_clubs').select('id, name, league, logo_url')
  if (error) throw error
  return data ?? []
}
async function loadItems(templateClubId: string): Promise<TemplateRosterItemRow[]> {
  const { data, error } = await supabase
    .from('template_roster_items')
    .select('name, date_of_birth, nationality, position, squad_number, is_manager, estimated_transfer_fee, contract_start, contract_end')
    .eq('template_club_id', templateClubId)
  if (error) throw error
  return (data ?? []) as TemplateRosterItemRow[]
}

describe('DB-backed hydration over the filled template library', () => {
  it('has 20 Premier League + 24 Championship clubs cached', async () => {
    const clubs = await loadTemplateClubs()
    if (clubs.length === 0) {
      console.warn('  ⚠ no template data — run `pnpm --filter @85percent/admin sync:templates` first; skipping')
      return
    }
    const pl = clubs.filter((c) => c.league === 'PREMIER_LEAGUE').length
    const ch = clubs.filter((c) => c.league === 'CHAMPIONSHIP').length
    assert.equal(pl, 20)
    assert.equal(ch, 24)
  })

  it('hydrates every cached club into a valid, zero-wage roster', async () => {
    const clubs = await loadTemplateClubs()
    if (clubs.length === 0) {
      console.warn('  ⚠ no template data; skipping')
      return
    }

    let totalPlayers = 0
    for (const club of clubs) {
      const items = await loadItems(String(club.id))
      const h = buildHydratedRoster({
        clubId: 'test-club',
        templateName: String(club.name),
        templateLeague: String(club.league),
        items,
        now: new Date('2026-05-30T00:00:00Z'),
      })

      const playerItems = items.filter((i) => !i.is_manager).length
      assert.equal(h.players.length, playerItems, `${club.name}: player count`)
      assert.equal(h.contracts.length, h.players.length, `${club.name}: 1 contract per player`)
      assert.ok(h.players.length >= 15, `${club.name}: realistic squad size (got ${h.players.length})`)

      const playerIds = new Set(h.players.map((p) => p['id']))
      for (const c of h.contracts) {
        assert.ok(playerIds.has(c['player_id']), `${club.name}: contract links to a player`)
        // Wages always 0 (the core financial rule).
        assert.equal(c['annual_wage'], 0, `${club.name}: zero wage`)
        // Fee is a non-negative integer.
        const fee = Number(c['transfer_fee'])
        assert.ok(Number.isFinite(fee) && fee >= 0, `${club.name}: fee ≥ 0`)
        // Dates valid: end strictly after start.
        const start = new Date(String(c['start_date']) + 'T00:00:00Z')
        const end = new Date(String(c['end_date']) + 'T00:00:00Z')
        assert.ok(end > start, `${club.name}: end after start`)
        assert.ok(Number(c['contract_length_years']) > 0, `${club.name}: positive length`)
        // Book value within [0, fee].
        const bv = Number(c['book_value'])
        assert.ok(bv >= 0 && bv <= fee, `${club.name}: book value in range`)
      }

      // Positions on hydrated players are GK/DEF/MID/FWD or null (managers excl.);
      // squad numbers are null or a valid 1–99 shirt number.
      for (const p of h.players) {
        const pos = p['position']
        assert.ok(pos == null || VALID_POSITIONS.has(String(pos)), `${club.name}: valid position`)
        const num = p['squad_number']
        assert.ok(
          num == null || (Number.isInteger(num) && (num as number) >= 1 && (num as number) <= 99),
          `${club.name}: valid squad number (${String(num)})`,
        )
      }

      // Identity matches the league of the template row.
      assert.equal(h.identity.leagueId, templateToLeagueId(String(club.league)))
      assert.match(h.identity.shortName, /^[A-Z]{3}$/)

      totalPlayers += h.players.length
    }

    console.log(`  hydrated ${clubs.length} clubs → ${totalPlayers} players, all wages £0`)
    assert.ok(totalPlayers > 800, 'expected a full library of players')
  })

  it('hydrates a known club (Chelsea FC) with a crest and a full squad', async () => {
    const clubs = await loadTemplateClubs()
    const chelsea = clubs.find((c) => c.name === 'Chelsea FC')
    if (!chelsea) {
      console.warn('  ⚠ Chelsea FC not in cache; skipping')
      return
    }
    assert.ok(chelsea.logo_url, 'Chelsea has a crest URL')
    const items = await loadItems(String(chelsea.id))
    const h = buildHydratedRoster({
      clubId: 'test-club',
      templateName: String(chelsea.name),
      templateLeague: String(chelsea.league),
      items,
      now: new Date('2026-05-30T00:00:00Z'),
    })
    assert.ok(h.players.length >= 20)
    assert.equal(h.identity.leagueId, 'premier-league')
    assert.equal(h.identity.shortName, 'CHE')
  })
})
