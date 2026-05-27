/**
 * Headroom — local development seed (MVP 2.0)
 *
 * Creates one test club, one test admin user, club financials, and a 5-player
 * squad with contracts so the Dashboard has realistic data to display.
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
const serviceKey  = process.env['SUPABASE_SERVICE_ROLE_KEY']

if (!supabaseUrl || !serviceKey) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const SEED_EMAIL      = 'dev@headroom.test'
const SEED_PASSWORD   = 'Dev@headroom1!'
const SEED_CLUB_NAME  = 'Headroom Dev FC'
const SEED_CLUB_SHORT = 'HDF'
const SEASON          = '2026-27'
const now             = new Date().toISOString()

// ---------------------------------------------------------------------------
// Squad data — 5 Championship-level players (all values in pence)
// Book values are approximate straight-line amortisation as of seed date.
// ---------------------------------------------------------------------------
const SQUAD = [
  {
    name: 'Marcus Ward',
    position: 'GK',
    nationality: 'English',
    // Free transfer — £0 fee
    transferFee:         0n,
    annualWage:          20_800_000n,  // £4,000/wk × 52
    agentFee:            3_000_000n,   // £30k
    startDate:           '2024-07-01',
    endDate:             '2027-06-30',
    contractLengthYears: '3.0',
    bookValue:           0n,           // free transfer
  },
  {
    name: 'Alex Deane',
    position: 'DEF',
    nationality: 'Scottish',
    transferFee:         150_000_000n, // £1.5M
    annualWage:          26_000_000n,  // £5,000/wk × 52
    agentFee:            5_000_000n,   // £50k
    startDate:           '2023-01-01',
    endDate:             '2027-01-01',
    contractLengthYears: '4.0',
    // ~8 months remaining of 48 → £1.5M × 8/48 ≈ £250k
    bookValue:           25_000_000n,
  },
  {
    name: 'Oliver Marsh',
    position: 'DEF',
    nationality: 'Welsh',
    transferFee:         250_000_000n, // £2.5M
    annualWage:          36_400_000n,  // £7,000/wk × 52
    agentFee:            7_500_000n,   // £75k
    startDate:           '2025-07-01',
    endDate:             '2028-06-30',
    contractLengthYears: '3.0',
    // ~25 months remaining of 36 → £2.5M × 25/36 ≈ £1.74M
    bookValue:           173_611_111n,
  },
  {
    name: 'Jordan Hayes',
    position: 'MID',
    nationality: 'English',
    transferFee:         350_000_000n, // £3.5M
    annualWage:          52_000_000n,  // £10,000/wk × 52
    agentFee:            12_000_000n,  // £120k
    startDate:           '2024-07-01',
    endDate:             '2028-06-30',
    contractLengthYears: '4.0',
    // ~25 months remaining of 48 → £3.5M × 25/48 ≈ £1.82M
    bookValue:           182_291_666n,
  },
  {
    name: 'Carlos Ramos',
    position: 'FWD',
    nationality: 'Spanish',
    transferFee:         550_000_000n, // £5.5M
    annualWage:          72_800_000n,  // £14,000/wk × 52
    agentFee:            20_000_000n,  // £200k
    startDate:           '2024-01-01',
    endDate:             '2027-07-01',
    contractLengthYears: '3.5',
    // ~14 months remaining of 42 → £5.5M × 14/42 ≈ £1.83M
    bookValue:           183_333_333n,
  },
]

async function seed() {
  console.log('🌱 Seeding Headroom development data (MVP 2.0)…\n')

  // ── 1. Create auth user ────────────────────────────────────────────────────
  console.log(`Creating auth user: ${SEED_EMAIL}`)
  const { data: authData, error: authErr } = await supabase.auth.admin.createUser({
    email:         SEED_EMAIL,
    password:      SEED_PASSWORD,
    email_confirm: true,
  })
  if (authErr && !authErr.message.includes('already been registered')) {
    console.error('Auth user creation failed:', authErr.message)
    process.exit(1)
  }

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
      id:          clubId,
      name:        SEED_CLUB_NAME,
      short_name:  SEED_CLUB_SHORT,
      league_id:   'efl-championship',
      created_at:  now,
      updated_at:  now,
    },
    { onConflict: 'name', ignoreDuplicates: true }
  )
  if (clubErr) {
    console.error('Club creation failed:', clubErr.message)
    process.exit(1)
  }

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
      id:         userId,
      club_id:    resolvedClubId,
      role:       'cfo',
      full_name:  'Dev Admin',
      email:      SEED_EMAIL,
      created_at: now,
    },
    { onConflict: 'id', ignoreDuplicates: true }
  )
  if (userErr) {
    console.error('User record creation failed:', userErr.message)
    process.exit(1)
  }
  console.log(`  ✓ users record linked`)

  // ── 4. Seed financials (no current_squad_costs — derived from contracts) ──
  console.log(`\nSeeding club_financials for ${SEASON}`)
  const { error: finErr } = await supabase.from('club_financials').upsert(
    {
      id:                       randomUUID(),
      club_id:                  resolvedClubId,
      season:                   SEASON,
      football_related_revenue: 95_000_000_00, // £95M in pence
      current_allowance_ratio:  0.30,
      owner_equity_used_1yr:    null,
      owner_equity_used_3yr:    null,
      season_start_date:        '2026-08-01T00:00:00.000Z',
      season_end_date:          '2027-05-31T00:00:00.000Z',
      created_at:               now,
      updated_at:               now,
    },
    { onConflict: 'club_id,season', ignoreDuplicates: true }
  )
  if (finErr) {
    console.error('Financials seed failed:', finErr.message)
    process.exit(1)
  }
  console.log(`  ✓ Financials seeded (£95M revenue, 30% allowance — squad costs now derived)`)

  // ── 5. Seed players + contracts ────────────────────────────────────────────
  console.log(`\nSeeding ${SQUAD.length}-player squad…`)

  for (const player of SQUAD) {
    // Check if player already exists
    const { data: existing } = await supabase
      .from('players')
      .select('id')
      .eq('club_id', resolvedClubId)
      .eq('name', player.name)
      .maybeSingle()

    let playerId: string

    if (existing?.id) {
      playerId = existing.id
      console.log(`  · ${player.name} already exists — skipping`)
      continue
    }

    playerId = randomUUID()
    const { error: playerErr } = await supabase.from('players').insert({
      id:          playerId,
      club_id:     resolvedClubId,
      name:        player.name,
      position:    player.position,
      nationality: player.nationality,
      is_active:   true,
      created_at:  now,
      updated_at:  now,
    })
    if (playerErr) {
      console.error(`  ✗ Player insert failed (${player.name}):`, playerErr.message)
      continue
    }

    const contractId = randomUUID()
    const { error: contractErr } = await supabase.from('contracts').insert({
      id:                    contractId,
      player_id:             playerId,
      club_id:               resolvedClubId,
      transfer_fee:          player.transferFee.toString(),
      annual_wage:           player.annualWage.toString(),
      agent_fee:             player.agentFee.toString(),
      start_date:            `${player.startDate}T00:00:00.000Z`,
      end_date:              `${player.endDate}T00:00:00.000Z`,
      contract_length_years: player.contractLengthYears,
      book_value:            player.bookValue.toString(),
      is_active:             true,
      created_at:            now,
      updated_at:            now,
    })
    if (contractErr) {
      console.error(`  ✗ Contract insert failed (${player.name}):`, contractErr.message)
      continue
    }

    console.log(`  ✓ ${player.name} (${player.position}) — £${Number(player.annualWage) / 100 / 52}k/wk`)
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  const totalWage = SQUAD.reduce((s, p) => s + Number(p.annualWage), 0)
  console.log(`
✅ Seed complete (MVP 2.0).

   Club     : ${SEED_CLUB_NAME} (${resolvedClubId})
   Email    : ${SEED_EMAIL}
   Password : ${SEED_PASSWORD}
   Season   : ${SEASON}
   Players  : ${SQUAD.length} (total annual wage: £${(totalWage / 100 / 1000).toFixed(0)}k)

   Apply migration : Dashboard → SQL Editor → prisma/migrations/20260527000001_.../migration.sql
   Apply RLS       : Dashboard → SQL Editor → prisma/rls.sql
   Start API       : pnpm --filter @headroom/api dev
   Start web       : pnpm --filter @headroom/web dev
  `)
}

seed().catch((err) => {
  console.error(err)
  process.exit(1)
})
