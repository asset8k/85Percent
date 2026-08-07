/**
 * Pure diff/verification logic for the template-club catalog. Kept free of
 * any Supabase/network calls so it is unit-testable — the seed/verify CLI
 * scripts in backend/scripts/ do the I/O and call these functions.
 */

import type { CanonicalTemplateClub } from './reference-data/template-clubs'

export interface ExistingTemplateClubRow {
  id: string
  name: string
  league: string
  logoUrl: string | null
  isActive: boolean
}

export interface ExistingMappingRow {
  provider: string
  entityType: string
  externalId: string
  internalId: string
  templateClubId: string | null
}

export interface ClubUpdatePlan {
  id: string
  name: string
  changes: Partial<Record<'league' | 'logoUrl' | 'isActive', { from: unknown; to: unknown }>>
}

export interface ClubDeactivatePlan {
  id: string
  name: string
}

export interface TemplateClubSeedPlan {
  toInsert: CanonicalTemplateClub[]
  toUpdate: ClubUpdatePlan[]
  toDeactivate: ClubDeactivatePlan[]
  unchanged: string[]
}

/**
 * Diffs the canonical catalog against what's actually in the database.
 * Matches by `name` (the DB-unique business key), never by `id` — `id` is
 * only used as the insert value for genuinely new rows, so an environment
 * that already has a same-named row (e.g. Bolton Wanderers in Production,
 * inserted by an earlier migration with its own id) keeps its existing id
 * and simply gets its metadata reconciled.
 */
export function planTemplateClubSeed(
  canonical: readonly CanonicalTemplateClub[],
  existing: readonly ExistingTemplateClubRow[],
): TemplateClubSeedPlan {
  const existingByName = new Map(existing.map((row) => [row.name, row]))
  const canonicalNames = new Set(canonical.map((c) => c.name))

  const toInsert: CanonicalTemplateClub[] = []
  const toUpdate: ClubUpdatePlan[] = []
  const unchanged: string[] = []

  for (const club of canonical) {
    const row = existingByName.get(club.name)
    if (!row) {
      toInsert.push(club)
      continue
    }
    const changes: ClubUpdatePlan['changes'] = {}
    if (row.league !== club.league) changes.league = { from: row.league, to: club.league }
    if (row.logoUrl !== club.logoUrl) changes.logoUrl = { from: row.logoUrl, to: club.logoUrl }
    if (!row.isActive) changes.isActive = { from: row.isActive, to: true }
    if (Object.keys(changes).length > 0) {
      toUpdate.push({ id: row.id, name: club.name, changes })
    } else {
      unchanged.push(club.name)
    }
  }

  // Rows that are currently active but no longer in the canonical catalog
  // (e.g. relegated last season) get deactivated, never deleted — they may
  // return to the catalog on promotion, and their roster/import history
  // must stay intact either way.
  const toDeactivate: ClubDeactivatePlan[] = existing
    .filter((row) => row.isActive && !canonicalNames.has(row.name))
    .map((row) => ({ id: row.id, name: row.name }))

  return { toInsert, toUpdate, toDeactivate, unchanged }
}

export interface MappingUpsertPlan {
  templateClubId: string
  clubName: string
  provider: 'football-data.org'
  entityType: 'CLUB'
  externalId: string
}

/**
 * Plans football-data.org club-mapping upserts once club ids are known
 * (i.e. after planTemplateClubSeed's inserts/updates have been applied and
 * re-read). Skips any club whose mapping already matches.
 */
export function planMappingSeed(
  canonical: readonly CanonicalTemplateClub[],
  resolvedIdsByName: ReadonlyMap<string, string>,
  existingMappings: readonly ExistingMappingRow[],
): MappingUpsertPlan[] {
  const existingByExternalId = new Map(
    existingMappings
      .filter((m) => m.provider === 'football-data.org' && m.entityType === 'CLUB')
      .map((m) => [m.externalId, m]),
  )

  const plans: MappingUpsertPlan[] = []
  for (const club of canonical) {
    const clubId = resolvedIdsByName.get(club.name)
    if (!clubId) continue // should not happen once seeding has run
    const existingMapping = existingByExternalId.get(club.footballDataClubId)
    if (existingMapping && existingMapping.templateClubId === clubId && existingMapping.internalId === clubId) {
      continue
    }
    plans.push({
      templateClubId: clubId,
      clubName: club.name,
      provider: 'football-data.org',
      entityType: 'CLUB',
      externalId: club.footballDataClubId,
    })
  }
  return plans
}

export interface TemplateCatalogVerification {
  ok: boolean
  errors: string[]
  counts: {
    totalActive: number
    activePremierLeague: number
    activeChampionship: number
  }
  clubsMissingLogo: string[]
  clubsMissingMapping: string[]
  duplicateProviderIds: string[]
  clubsWithRoster: string[]
  clubsWithoutRoster: string[]
}

/**
 * Structural + coverage assertions for Dev/Prod parity checks. Deliberately
 * separates "does the club exist in the catalog" from "does it have a synced
 * squad" — those are two different states and callers must not conflate them.
 */
export function verifyTemplateCatalog(
  activeRows: readonly ExistingTemplateClubRow[],
  mappingRows: readonly ExistingMappingRow[],
  clubIdsWithRosterItems: ReadonlySet<string>,
): TemplateCatalogVerification {
  const errors: string[] = []

  const activePremierLeague = activeRows.filter((r) => r.league === 'PREMIER_LEAGUE').length
  const activeChampionship = activeRows.filter((r) => r.league === 'CHAMPIONSHIP').length

  if (activePremierLeague !== 20) errors.push(`Expected 20 active Premier League clubs, found ${activePremierLeague}`)
  if (activeChampionship !== 24) errors.push(`Expected 24 active Championship clubs, found ${activeChampionship}`)
  if (activeRows.length !== 44) errors.push(`Expected 44 active template clubs total, found ${activeRows.length}`)

  const clubsMissingLogo = activeRows.filter((r) => !r.logoUrl).map((r) => r.name)
  if (clubsMissingLogo.length > 0) errors.push(`${clubsMissingLogo.length} active club(s) missing a logo: ${clubsMissingLogo.join(', ')}`)

  const mappingByClubId = new Map<string, ExistingMappingRow[]>()
  for (const m of mappingRows) {
    if (!m.templateClubId) continue
    const list = mappingByClubId.get(m.templateClubId) ?? []
    list.push(m)
    mappingByClubId.set(m.templateClubId, list)
  }

  const clubsMissingMapping = activeRows
    .filter((r) => !(mappingByClubId.get(r.id) ?? []).some((m) => m.provider === 'football-data.org' && m.entityType === 'CLUB'))
    .map((r) => r.name)
  if (clubsMissingMapping.length > 0) {
    errors.push(`${clubsMissingMapping.length} active club(s) missing a football-data.org mapping: ${clubsMissingMapping.join(', ')}`)
  }

  const seenExternalIds = new Map<string, string>() // `${provider}:${entityType}:${externalId}` -> clubName
  const duplicateProviderIds: string[] = []
  for (const row of activeRows) {
    for (const m of mappingByClubId.get(row.id) ?? []) {
      const key = `${m.provider}:${m.entityType}:${m.externalId}`
      const owner = seenExternalIds.get(key)
      if (owner && owner !== row.name) {
        duplicateProviderIds.push(`${key} used by both ${owner} and ${row.name}`)
      } else {
        seenExternalIds.set(key, row.name)
      }
    }
  }
  if (duplicateProviderIds.length > 0) errors.push(`Duplicate provider mapping(s): ${duplicateProviderIds.join('; ')}`)

  const clubsWithRoster = activeRows.filter((r) => clubIdsWithRosterItems.has(r.id)).map((r) => r.name)
  const clubsWithoutRoster = activeRows.filter((r) => !clubIdsWithRosterItems.has(r.id)).map((r) => r.name)

  return {
    ok: errors.length === 0,
    errors,
    counts: { totalActive: activeRows.length, activePremierLeague, activeChampionship },
    clubsMissingLogo,
    clubsMissingMapping,
    duplicateProviderIds,
    clubsWithRoster,
    clubsWithoutRoster,
  }
}
