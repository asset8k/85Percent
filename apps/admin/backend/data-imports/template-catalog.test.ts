import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  planTemplateClubSeed,
  planMappingSeed,
  verifyTemplateCatalog,
  type ExistingTemplateClubRow,
  type ExistingMappingRow,
} from './template-catalog'
import type { CanonicalTemplateClub } from './reference-data/template-clubs'

const ARSENAL: CanonicalTemplateClub = { id: 'canonical-arsenal', name: 'Arsenal FC', league: 'PREMIER_LEAGUE', logoUrl: 'https://logos/arsenal.png', footballDataClubId: '57' }
const BOLTON: CanonicalTemplateClub = { id: 'canonical-bolton', name: 'Bolton Wanderers', league: 'CHAMPIONSHIP', logoUrl: 'https://logos/bolton.png', footballDataClubId: '60' }
const CANONICAL: CanonicalTemplateClub[] = [ARSENAL, BOLTON]

describe('planTemplateClubSeed', () => {
  // The exact production bug this exists to fix: Production already has a row
  // for a club, created by an earlier migration with its own id. Seeding must
  // never fight that id — only reconcile league/logo/active-ness.
  it('preserves the existing row id and only updates changed metadata when a name already exists', () => {
    const existing: ExistingTemplateClubRow[] = [
      { id: 'prod-bolton-id', name: 'Bolton Wanderers', league: 'CHAMPIONSHIP', logoUrl: null, isActive: true },
    ]
    const plan = planTemplateClubSeed(CANONICAL, existing)
    assert.equal(plan.toInsert.length, 1)
    const [inserted] = plan.toInsert
    assert.equal(inserted?.name, 'Arsenal FC')
    assert.equal(plan.toUpdate.length, 1)
    const [updated] = plan.toUpdate
    assert.equal(updated?.id, 'prod-bolton-id')
    assert.deepEqual(updated?.changes.logoUrl, { from: null, to: 'https://logos/bolton.png' })
    assert.equal(updated?.changes.league, undefined)
  })

  it('inserts every canonical club with its catalog id when the database is empty (fresh project)', () => {
    const plan = planTemplateClubSeed(CANONICAL, [])
    assert.equal(plan.toInsert.length, 2)
    assert.deepEqual(plan.toInsert.map((c) => c.id).sort(), ['canonical-arsenal', 'canonical-bolton'])
    assert.deepEqual(plan.toUpdate, [])
    assert.deepEqual(plan.toDeactivate, [])
  })

  it('reports no changes needed when the database already matches the catalog exactly', () => {
    const existing: ExistingTemplateClubRow[] = CANONICAL.map((c) => ({
      id: c.id,
      name: c.name,
      league: c.league,
      logoUrl: c.logoUrl,
      isActive: true,
    }))
    const plan = planTemplateClubSeed(CANONICAL, existing)
    assert.deepEqual(plan.toInsert, [])
    assert.deepEqual(plan.toUpdate, [])
    assert.deepEqual(plan.toDeactivate, [])
    assert.deepEqual(plan.unchanged.sort(), ['Arsenal FC', 'Bolton Wanderers'])
  })

  it('reactivates a catalog club that was previously deactivated, without touching id', () => {
    const existing: ExistingTemplateClubRow[] = [
      { id: 'arsenal-id', name: 'Arsenal FC', league: 'PREMIER_LEAGUE', logoUrl: 'https://logos/arsenal.png', isActive: false },
    ]
    const plan = planTemplateClubSeed(CANONICAL, existing)
    const arsenalUpdate = plan.toUpdate.find((u) => u.name === 'Arsenal FC')
    assert.ok(arsenalUpdate)
    assert.deepEqual(arsenalUpdate.changes.isActive, { from: false, to: true })
  })

  // Relegation: a club drops out of the canonical list. Its row must be
  // deactivated, never deleted — roster/import history has to survive so the
  // club can come back on promotion without re-importing everything.
  it('deactivates an active row that has fallen out of the canonical catalog, and never deletes it', () => {
    const existing: ExistingTemplateClubRow[] = [
      ...CANONICAL.map((c) => ({ id: c.id, name: c.name, league: c.league, logoUrl: c.logoUrl, isActive: true })),
      { id: 'relegated-id', name: 'Leicester City', league: 'CHAMPIONSHIP', logoUrl: 'https://logos/leicester.png', isActive: true },
    ]
    const plan = planTemplateClubSeed(CANONICAL, existing)
    assert.deepEqual(plan.toDeactivate, [{ id: 'relegated-id', name: 'Leicester City' }])
  })

  it('leaves an already-inactive out-of-catalog row alone', () => {
    const existing: ExistingTemplateClubRow[] = [
      { id: 'relegated-id', name: 'Leicester City', league: 'CHAMPIONSHIP', logoUrl: null, isActive: false },
    ]
    const plan = planTemplateClubSeed(CANONICAL, existing)
    assert.deepEqual(plan.toDeactivate, [])
  })
})

describe('planMappingSeed', () => {
  it('plans a football-data.org mapping upsert for a club with none yet', () => {
    const resolvedIds = new Map([['Arsenal FC', 'arsenal-id']])
    const plan = planMappingSeed([ARSENAL], resolvedIds, [])
    assert.equal(plan.length, 1)
    assert.deepEqual(plan[0], {
      templateClubId: 'arsenal-id',
      clubName: 'Arsenal FC',
      provider: 'football-data.org',
      entityType: 'CLUB',
      externalId: '57',
    })
  })

  it('skips a club whose mapping already points at the resolved id', () => {
    const resolvedIds = new Map([['Arsenal FC', 'arsenal-id']])
    const existing: ExistingMappingRow[] = [
      { provider: 'football-data.org', entityType: 'CLUB', externalId: '57', internalId: 'arsenal-id', templateClubId: 'arsenal-id' },
    ]
    const plan = planMappingSeed([ARSENAL], resolvedIds, existing)
    assert.deepEqual(plan, [])
  })

  it('replans when an existing mapping points at a stale template_club_id', () => {
    const resolvedIds = new Map([['Arsenal FC', 'new-arsenal-id']])
    const existing: ExistingMappingRow[] = [
      { provider: 'football-data.org', entityType: 'CLUB', externalId: '57', internalId: 'old-arsenal-id', templateClubId: 'old-arsenal-id' },
    ]
    const plan = planMappingSeed([ARSENAL], resolvedIds, existing)
    assert.equal(plan.length, 1)
    assert.equal(plan[0]?.templateClubId, 'new-arsenal-id')
  })
})

function row(overrides: Partial<ExistingTemplateClubRow> & Pick<ExistingTemplateClubRow, 'id' | 'name'>): ExistingTemplateClubRow {
  return { league: 'PREMIER_LEAGUE', logoUrl: 'https://logo.png', isActive: true, ...overrides }
}

function mapping(templateClubId: string, externalId = '1'): ExistingMappingRow {
  return { provider: 'football-data.org', entityType: 'CLUB', externalId, internalId: templateClubId, templateClubId }
}

describe('verifyTemplateCatalog', () => {
  it('passes for a well-formed 44-club catalog', () => {
    const plRows = Array.from({ length: 20 }, (_, i) => row({ id: `pl-${i}`, name: `PL Club ${i}`, league: 'PREMIER_LEAGUE' }))
    const chRows = Array.from({ length: 24 }, (_, i) => row({ id: `ch-${i}`, name: `Champ Club ${i}`, league: 'CHAMPIONSHIP' }))
    const rows = [...plRows, ...chRows]
    const mappings = rows.map((r, i) => mapping(r.id, String(i)))
    const result = verifyTemplateCatalog(rows, mappings, new Set())
    assert.equal(result.ok, true)
    assert.deepEqual(result.errors, [])
    assert.equal(result.counts.totalActive, 44)
  })

  // This is the exact bug this diagnosis started from: Production had 3
  // Championship clubs and 0 Premier League clubs.
  it('reports the wrong-count case precisely, the way Production actually looked', () => {
    const rows = [
      row({ id: '1', name: 'Bolton Wanderers', league: 'CHAMPIONSHIP' }),
      row({ id: '2', name: 'Cardiff City', league: 'CHAMPIONSHIP' }),
      row({ id: '3', name: 'Lincoln City', league: 'CHAMPIONSHIP' }),
    ]
    const result = verifyTemplateCatalog(rows, [], new Set())
    assert.equal(result.ok, false)
    assert.equal(result.counts.activePremierLeague, 0)
    assert.equal(result.counts.activeChampionship, 3)
    assert.ok(result.errors.some((e) => e.includes('Expected 20 active Premier League')))
    assert.ok(result.errors.some((e) => e.includes('Expected 44 active template clubs total, found 3')))
  })

  it('flags a missing logo separately from a missing provider mapping', () => {
    const rows = [row({ id: '1', name: 'No Logo FC', logoUrl: null }), row({ id: '2', name: 'No Mapping FC' })]
    const result = verifyTemplateCatalog(rows, [mapping('1')], new Set())
    assert.deepEqual(result.clubsMissingLogo, ['No Logo FC'])
    assert.deepEqual(result.clubsMissingMapping, ['No Mapping FC'])
  })

  it('flags two clubs sharing the same provider external id as a collision', () => {
    const rows = [row({ id: '1', name: 'Club A' }), row({ id: '2', name: 'Club B' })]
    const mappings = [mapping('1', '999'), mapping('2', '999')]
    const result = verifyTemplateCatalog(rows, mappings, new Set())
    assert.equal(result.ok, false)
    assert.equal(result.duplicateProviderIds.length, 1)
  })

  // Existing in the catalog and having a synced squad are two different
  // states; verify must report them as two separate lists, never merge them.
  it('reports catalog membership and squad-cache coverage as two distinct lists', () => {
    const rows = [row({ id: '1', name: 'Has Squad' }), row({ id: '2', name: 'No Squad Yet' })]
    const mappings = [mapping('1'), mapping('2', '2')]
    const result = verifyTemplateCatalog(rows, mappings, new Set(['1']))
    assert.deepEqual(result.clubsWithRoster, ['Has Squad'])
    assert.deepEqual(result.clubsWithoutRoster, ['No Squad Yet'])
  })
})
