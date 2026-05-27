/**
 * Headroom — local development seed
 *
 * Creates one test club and one test admin user so any developer can get a
 * working local environment without manual Supabase dashboard steps.
 *
 * ─── Credentials ────────────────────────────────────────────────────────────
 *   Email    : dev@headroom.test
 *   Password : Dev@headroom1!
 *   Club     : Headroom Dev FC  (EFL Championship)
 * ────────────────────────────────────────────────────────────────────────────
 *
 * Usage (from apps/api/):
 *   pnpm tsx --env-file=.env prisma/seed.ts
 */

import { createClient } from '@supabase/supabase-js'
import { randomUUID } from 'crypto'

const supabaseUrl = process.env['SUPABASE_URL']
const serviceKey = process.env['SUPABASE_SERVICE_ROLE_KEY']

if (!supabaseUrl || !serviceKey) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const SEED_EMAIL = 'dev@headroom.test'
const SEED_PASSWORD = 'Dev@headroom1!'
const SEED_CLUB_NAME = 'Headroom Dev FC'
const SEED_CLUB_SHORT = 'HDF'
const SEASON = '2026-27'
const now = new Date().toISOString()

async function seed() {
  console.log('🌱 Seeding Headroom development data…\n')

  // ── 1. Create auth user ────────────────────────────────────────────────────
  console.log(`Creating auth user: ${SEED_EMAIL}`)
  const { data: authData, error: authErr } = await supabase.auth.admin.createUser({
    email: SEED_EMAIL,
    password: SEED_PASSWORD,
    email_confirm: true,
  })
  if (authErr && !authErr.message.includes('already been registered')) {
    console.error('Auth user creation failed:', authErr.message)
    process.exit(1)
  }

  // Resolve user id — may already exist
  let userId: string
  if (authData?.user) {
    userId = authData.user.id
    console.log(`  ✓ Auth user created: ${userId}`)
  } else {
    const { data: existing } = await supabase.auth.admin.listUsers()
    const match = existing?.users?.find((u) => u.email === SEED_EMAIL)
    if (!match) {
      console.error('Could not resolve auth user id')
      process.exit(1)
    }
    userId = match.id
    console.log(`  ✓ Auth user already exists: ${userId}`)
  }

  // ── 2. Create club ─────────────────────────────────────────────────────────
  const clubId = randomUUID()
  console.log(`\nCreating club: ${SEED_CLUB_NAME}`)
  const { error: clubErr } = await supabase.from('clubs').upsert(
    {
      id: clubId,
      name: SEED_CLUB_NAME,
      short_name: SEED_CLUB_SHORT,
      league_id: 'efl-championship',
      created_at: now,
      updated_at: now,
    },
    { onConflict: 'name', ignoreDuplicates: true }
  )
  if (clubErr) {
    console.error('Club creation failed:', clubErr.message)
    process.exit(1)
  }

  // Resolve actual club id (may have existed already)
  const { data: clubRow } = await supabase
    .from('clubs')
    .select('id')
    .eq('name', SEED_CLUB_NAME)
    .single()

  const resolvedClubId: string = clubRow?.id ?? clubId
  console.log(`  ✓ Club id: ${resolvedClubId}`)

  // ── 3. Create app user record ─────────────────────────────────────────────
  console.log(`\nCreating users record for ${SEED_EMAIL}`)
  const { error: userErr } = await supabase.from('users').upsert(
    {
      id: userId,
      club_id: resolvedClubId,
      role: 'cfo',
      full_name: 'Dev Admin',
      email: SEED_EMAIL,
      created_at: now,
    },
    { onConflict: 'id', ignoreDuplicates: true }
  )
  if (userErr) {
    console.error('User record creation failed:', userErr.message)
    process.exit(1)
  }
  console.log(`  ✓ users record linked`)

  // ── 4. Seed financials ─────────────────────────────────────────────────────
  console.log(`\nSeeding club_financials for ${SEASON}`)
  const finId = randomUUID()
  const { error: finErr } = await supabase.from('club_financials').upsert(
    {
      id: finId,
      club_id: resolvedClubId,
      season: SEASON,
      football_related_revenue: 95_000_000_00, // £95M in pence
      current_squad_costs:      80_000_000_00, // £80M in pence
      current_allowance_ratio:  0.30,
      owner_equity_used_1yr:    null,
      owner_equity_used_3yr:    null,
      created_at: now,
      updated_at: now,
    },
    { onConflict: 'club_id,season', ignoreDuplicates: true }
  )
  if (finErr) {
    console.error('Financials seed failed:', finErr.message)
    process.exit(1)
  }
  console.log(`  ✓ Financials seeded (£95M revenue, £80M squad costs, 30% allowance)`)

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log(`
✅ Seed complete.

   Club     : ${SEED_CLUB_NAME} (${resolvedClubId})
   Email    : ${SEED_EMAIL}
   Password : ${SEED_PASSWORD}
   Season   : ${SEASON}

   Start the API: pnpm --filter @headroom/api dev
   Start the web: pnpm --filter @headroom/web dev
  `)
}

seed().catch((err) => {
  console.error(err)
  process.exit(1)
})
