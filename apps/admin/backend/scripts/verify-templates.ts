/**
 * db:verify:templates — asserts the onboarding club catalog is complete:
 * 20 active Premier League + 24 active Championship template clubs, every
 * active club has a league/logo/stable id, provider mappings don't collide,
 * and (reported separately, per product intent — see backend/routes/
 * onboarding-hydrate.ts) which clubs additionally have a synced template
 * squad available for hydration.
 *
 * Usage (from apps/admin/):
 *   pnpm tsx --env-file=.env.local backend/scripts/verify-templates.ts dev
 *   pnpm tsx --env-file=.env.local backend/scripts/verify-templates.ts prod
 * or: pnpm db:verify:templates:dev / :prod
 *
 * Exits non-zero on failure, so it can gate a release manually or in CI once
 * the environment has DB credentials available.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { verifyTemplateCatalog, type ExistingTemplateClubRow, type ExistingMappingRow } from '../data-imports/template-catalog'

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

async function main() {
  const target = process.argv.slice(2).find((a) => a === 'dev' || a === 'prod') as Target | undefined
  if (!target) {
    console.error('Usage: verify-templates.ts <dev|prod>')
    process.exit(2)
  }
  const client = resolveClient(target)

  const { data: clubRows, error: clubErr } = await client
    .from('template_clubs')
    .select('id, name, league, logo_url, is_active')
    .eq('is_active', true)
  if (clubErr) throw new Error(`Failed to read template_clubs: ${clubErr.message}`)
  const activeRows: ExistingTemplateClubRow[] = (clubRows ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    league: r.league,
    logoUrl: r.logo_url,
    isActive: r.is_active,
  }))

  const { data: mappingRows, error: mappingErr } = await client
    .from('external_source_mappings')
    .select('provider, entity_type, external_id, internal_id, template_club_id')
    .not('template_club_id', 'is', null)
  if (mappingErr) throw new Error(`Failed to read external_source_mappings: ${mappingErr.message}`)
  const mappings: ExistingMappingRow[] = (mappingRows ?? []).map((r) => ({
    provider: r.provider,
    entityType: r.entity_type,
    externalId: r.external_id,
    internalId: r.internal_id,
    templateClubId: r.template_club_id,
  }))

  const { data: rosterRows, error: rosterErr } = await client.from('template_roster_items').select('template_club_id')
  if (rosterErr) throw new Error(`Failed to read template_roster_items: ${rosterErr.message}`)
  const clubIdsWithRoster = new Set((rosterRows ?? []).map((r) => r.template_club_id))

  const result = verifyTemplateCatalog(activeRows, mappings, clubIdsWithRoster)

  console.log(`\nTemplate catalog verification — target: ${target.toUpperCase()}\n`)
  console.log(`Active clubs: ${result.counts.totalActive} (PL: ${result.counts.activePremierLeague}, Championship: ${result.counts.activeChampionship})`)
  console.log(`Clubs with a synced template squad: ${result.clubsWithRoster.length}/${result.counts.totalActive}`)
  if (result.clubsWithoutRoster.length > 0) {
    console.log(`  Missing squad cache (catalog membership is fine — run Data Sync for these): ${result.clubsWithoutRoster.join(', ')}`)
  }

  if (result.ok) {
    console.log('\nPASS\n')
    return
  }

  console.error('\nFAIL')
  for (const e of result.errors) console.error(`  - ${e}`)
  console.error('')
  process.exit(1)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
