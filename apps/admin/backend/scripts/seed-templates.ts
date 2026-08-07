/**
 * db:seed:templates — idempotent reference-data seed for the onboarding club
 * catalog (`template_clubs` + its football-data.org mappings).
 *
 * This is deliberately NOT part of `prisma migrate deploy`. The Production
 * outage this script exists to fix and prevent (see docs/BUILD_LOG.md) was
 * caused by exactly that conflation: a migration tried to UPDATE 41 catalog
 * rows by name into a Production database that had never received the
 * original seed, so the UPDATE silently matched zero rows and only the
 * unconditional INSERTs took effect. Schema shape is a migration's job;
 * populating/refreshing the reference catalog is this script's job, and it
 * can be re-run any time the catalog changes (promotion/relegation) or
 * against a brand-new Supabase project with no manual SQL required.
 *
 * Safety:
 *  - Touches only `template_clubs` and `external_source_mappings` — disjoint
 *    tables from `clubs`/`players`/`contracts` (real customer workspaces),
 *    so it structurally cannot read or write customer financial data.
 *  - Never touches `template_roster_items` (template squads) — those come
 *    from Data Sync, a separate, provider-scraped, versioned-by-import-run
 *    system; baking squad data into this seed would fight that system's own
 *    idempotency instead of composing with it.
 *  - Upserts by `name` (a real DB-unique constraint), never deletes a row,
 *    and deactivates (never deletes) a club that has fallen out of the
 *    canonical catalog. See template-catalog.ts for the diff logic.
 *  - Defaults to a dry run. Pass --apply to actually write.
 *
 * Usage (from apps/admin/):
 *   pnpm tsx --env-file=.env.local backend/scripts/seed-templates.ts dev
 *   pnpm tsx --env-file=.env.local backend/scripts/seed-templates.ts dev --apply
 *   pnpm tsx --env-file=.env.local backend/scripts/seed-templates.ts prod --apply
 * or via the wired-up root scripts:
 *   pnpm db:seed:templates:dev
 *   pnpm db:seed:templates:prod
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { TEMPLATE_CLUB_CATALOG } from '../data-imports/reference-data/template-clubs'
import {
  planTemplateClubSeed,
  planMappingSeed,
  type ExistingTemplateClubRow,
  type ExistingMappingRow,
} from '../data-imports/template-catalog'

type Target = 'dev' | 'prod'

function resolveClient(target: Target): SupabaseClient {
  const url = target === 'dev' ? process.env['SUPABASE_URL'] : process.env['SUPABASE_PROD_URL']
  const key = target === 'dev' ? process.env['SUPABASE_SERVICE_ROLE_KEY'] : process.env['SUPABASE_PROD_SECRET_KEY']
  if (!url || !key) {
    const urlVar = target === 'dev' ? 'SUPABASE_URL' : 'SUPABASE_PROD_URL'
    const keyVar = target === 'dev' ? 'SUPABASE_SERVICE_ROLE_KEY' : 'SUPABASE_PROD_SECRET_KEY'
    console.error(`Missing ${urlVar} / ${keyVar} in the environment.`)
    process.exit(2)
  }
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
}

async function fetchExistingClubs(client: SupabaseClient): Promise<ExistingTemplateClubRow[]> {
  const { data, error } = await client.from('template_clubs').select('id, name, league, logo_url, is_active')
  if (error) throw new Error(`Failed to read template_clubs: ${error.message}`)
  return (data ?? []).map((r) => ({ id: r.id, name: r.name, league: r.league, logoUrl: r.logo_url, isActive: r.is_active }))
}

async function fetchExistingMappings(client: SupabaseClient): Promise<ExistingMappingRow[]> {
  const { data, error } = await client
    .from('external_source_mappings')
    .select('provider, entity_type, external_id, internal_id, template_club_id')
    .not('template_club_id', 'is', null)
  if (error) throw new Error(`Failed to read external_source_mappings: ${error.message}`)
  return (data ?? []).map((r) => ({
    provider: r.provider,
    entityType: r.entity_type,
    externalId: r.external_id,
    internalId: r.internal_id,
    templateClubId: r.template_club_id,
  }))
}

async function main() {
  const args = process.argv.slice(2)
  const target = args.find((a) => a === 'dev' || a === 'prod') as Target | undefined
  const apply = args.includes('--apply')

  if (!target) {
    console.error('Usage: seed-templates.ts <dev|prod> [--apply]')
    process.exit(2)
  }

  const client = resolveClient(target)

  console.log(`\n85Percent template-club catalog seed — target: ${target.toUpperCase()}${apply ? ' (APPLYING)' : ' (dry run)'}\n`)

  const existingClubs = await fetchExistingClubs(client)
  const clubPlan = planTemplateClubSeed(TEMPLATE_CLUB_CATALOG, existingClubs)

  console.log(`Catalog: ${TEMPLATE_CLUB_CATALOG.length} clubs. Database currently has: ${existingClubs.length} rows.\n`)
  console.log(`Insert: ${clubPlan.toInsert.length}`)
  for (const c of clubPlan.toInsert) console.log(`  + ${c.name} (${c.league})`)
  console.log(`Update: ${clubPlan.toUpdate.length}`)
  for (const u of clubPlan.toUpdate) console.log(`  ~ ${u.name}: ${JSON.stringify(u.changes)}`)
  console.log(`Deactivate (out of catalog, kept, not deleted): ${clubPlan.toDeactivate.length}`)
  for (const d of clubPlan.toDeactivate) console.log(`  - ${d.name}`)
  console.log(`Unchanged: ${clubPlan.unchanged.length}\n`)

  if (!apply) {
    // Preview the mapping plan too: for a club that already exists, its real
    // id; for a club about to be inserted, the id it WILL get (its catalog
    // id — applying never invents a different one for a fresh insert).
    const previewIdsByName = new Map(existingClubs.map((r) => [r.name, r.id]))
    for (const c of clubPlan.toInsert) previewIdsByName.set(c.name, c.id)
    const existingMappings = await fetchExistingMappings(client)
    const mappingPlan = planMappingSeed(TEMPLATE_CLUB_CATALOG, previewIdsByName, existingMappings)
    console.log(`Provider mapping upserts that would run: ${mappingPlan.length}`)
    for (const m of mappingPlan) console.log(`  ~ ${m.clubName} → football-data.org:${m.externalId}`)
    console.log('\nDry run only — no writes made. Re-run with --apply to write these changes.\n')
    return
  }

  // template_clubs.updated_at is NOT NULL with no DB default — Prisma's
  // @updatedAt only stamps it at the ORM layer, so raw REST writes here must
  // set it explicitly on every insert/update.
  const nowISO = () => new Date().toISOString()

  for (const club of clubPlan.toInsert) {
    const { error } = await client.from('template_clubs').insert({
      id: club.id,
      name: club.name,
      league: club.league,
      logo_url: club.logoUrl,
      is_active: true,
      updated_at: nowISO(),
    })
    if (error) throw new Error(`Insert failed for ${club.name}: ${error.message}`)
  }

  for (const update of clubPlan.toUpdate) {
    const patch: Record<string, unknown> = { updated_at: nowISO() }
    if (update.changes.league) patch.league = update.changes.league.to
    if (update.changes.logoUrl) patch.logo_url = update.changes.logoUrl.to
    if (update.changes.isActive) patch.is_active = update.changes.isActive.to
    const { error } = await client.from('template_clubs').update(patch).eq('id', update.id)
    if (error) throw new Error(`Update failed for ${update.name}: ${error.message}`)
  }

  for (const deactivate of clubPlan.toDeactivate) {
    const { error } = await client.from('template_clubs').update({ is_active: false, updated_at: nowISO() }).eq('id', deactivate.id)
    if (error) throw new Error(`Deactivate failed for ${deactivate.name}: ${error.message}`)
  }

  console.log('Club catalog written. Resolving ids for mapping seed…')

  const resolvedRows = await fetchExistingClubs(client)
  const resolvedIdsByName = new Map(resolvedRows.map((r) => [r.name, r.id]))
  const existingMappings = await fetchExistingMappings(client)
  const mappingPlan = planMappingSeed(TEMPLATE_CLUB_CATALOG, resolvedIdsByName, existingMappings)

  console.log(`Provider mapping upserts: ${mappingPlan.length}`)
  for (const m of mappingPlan) {
    const { error } = await client.from('external_source_mappings').upsert(
      {
        provider: m.provider,
        entity_type: m.entityType,
        external_id: m.externalId,
        internal_id: m.templateClubId,
        template_club_id: m.templateClubId,
      },
      { onConflict: 'provider,entity_type,external_id' },
    )
    if (error) throw new Error(`Mapping upsert failed for ${m.clubName}: ${error.message}`)
  }

  console.log('\nSeed complete.\n')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
