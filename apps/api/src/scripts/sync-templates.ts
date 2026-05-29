// ─────────────────────────────────────────────────────────────────────────────
// Background Template Sync Worker (MVP 2.0 onboarding)
//
// Populates the template_clubs / template_roster_items dictionary from the
// unofficial felipeall/transfermarkt-api scraper. This is meant to run on a
// controlled MONTHLY schedule (cron / admin trigger), NOT during user
// onboarding — onboarding reads only our local cache, insulating us from the
// scraper's downtime and Cloudflare rate-limiting.
//
// Run it with:
//   pnpm --filter @headroom/api sync:templates
// Configure via env (all optional):
//   TRANSFERMARKT_API_URL        base URL of the scraper      (default http://localhost:8000)
//   TRANSFERMARKT_SEASON_ID      season start year, e.g. 2025 (default: derived from today)
//   TRANSFERMARKT_SYNC_DELAY_MS  delay between clubs          (default 3000)
//   TRANSFERMARKT_TIMEOUT_MS     per-request timeout          (default 20000)
//
// Safety nets:
//   • A generous, configurable delay between every club request (anti-Cloudflare).
//   • Each club sync is wrapped in its own try/catch — one broken DOM selector or
//     timeout logs a warning and the batch continues; it never crashes wholesale.
// ─────────────────────────────────────────────────────────────────────────────

import { randomUUID } from 'crypto'
import { pathToFileURL } from 'url'
import { supabase } from '../lib/supabase.js'
import {
  mapCoachToRosterItem,
  mapPlayerToRosterItem,
  parseShirtNumber,
  type TemplateLeagueValue,
  type TemplateRosterItemInput,
  type TransfermarktPlayer,
} from './transfermarkt-mappers.js'

// ── Config ───────────────────────────────────────────────────────────────────
const API_BASE = (process.env['TRANSFERMARKT_API_URL'] ?? 'http://localhost:8000').replace(/\/+$/, '')
const SEASON_ID = process.env['TRANSFERMARKT_SEASON_ID'] ?? deriveSeasonId()
const REQUEST_DELAY_MS = Number(process.env['TRANSFERMARKT_SYNC_DELAY_MS'] ?? 3000)
const REQUEST_TIMEOUT_MS = Number(process.env['TRANSFERMARKT_TIMEOUT_MS'] ?? 20000)
// Shirt numbers are NOT in the bulk squad endpoint — they live on each player's
// profile, so we make one extra request per player. Its own (shorter) delay
// keeps the run tolerable while still pacing requests. Set
// TRANSFERMARKT_FETCH_SHIRT_NUMBERS=0 to skip the enrichment entirely.
const PLAYER_DELAY_MS = Number(process.env['TRANSFERMARKT_PLAYER_DELAY_MS'] ?? 500)
const FETCH_SHIRT_NUMBERS = process.env['TRANSFERMARKT_FETCH_SHIRT_NUMBERS'] !== '0'

// The two English competitions whose membership defines exactly the 44 clubs we
// cache. We fetch the club list live from each competition rather than hardcode
// 44 club IDs so promotion/relegation is handled automatically each season; the
// hardcoded part is the competition set itself, which never changes.
const COMPETITIONS: ReadonlyArray<{ competitionId: string; league: TemplateLeagueValue }> = [
  { competitionId: 'GB1', league: 'PREMIER_LEAGUE' },
  { competitionId: 'GB2', league: 'CHAMPIONSHIP' },
]

interface ClubRef {
  tmId: string
  name: string
  league: TemplateLeagueValue
}

// ── Transfermarkt API response shapes (partial / untrusted) ───────────────────
interface CompetitionClubsResponse {
  clubs?: Array<{ id?: string; name?: string }>
}
interface ClubPlayersResponse {
  players?: TransfermarktPlayer[]
}
interface ClubProfileResponse {
  name?: string
  image?: string | null
  // The scraper does not reliably expose the coach; read defensively if present.
  coach?: { name?: string | null; contract?: string | null; joined?: string | null } | null
}
interface PlayerProfileResponse {
  shirtNumber?: string | number | null // e.g. "#10"
}

// ── Small utilities ───────────────────────────────────────────────────────────
function deriveSeasonId(): string {
  const now = new Date()
  const year = now.getUTCFullYear()
  // Transfermarkt season_id is the calendar year a season STARTS (Aug → May).
  // From July onward we are in the new season; before that, the previous year.
  return String(now.getUTCMonth() >= 6 ? year : year - 1)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchJson<T>(path: string): Promise<T> {
  const url = `${API_BASE}${path}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    })
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} for ${path}`)
    }
    return (await res.json()) as T
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`Timeout after ${REQUEST_TIMEOUT_MS}ms for ${path}`)
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}

// ── DB writers (Supabase service client — bypasses RLS for this admin job) ─────

// Upsert the club by its unique name and return its id. Mirrors the explicit
// select-then-update/insert pattern used elsewhere (id has no DB-level default).
async function upsertTemplateClub(club: ClubRef, logoUrl: string | null): Promise<string> {
  const nowIso = new Date().toISOString()

  const { data: existing, error: findErr } = await supabase
    .from('template_clubs')
    .select('id')
    .eq('name', club.name)
    .maybeSingle()
  if (findErr) throw findErr

  if (existing) {
    const { error } = await supabase
      .from('template_clubs')
      .update({ league: club.league, logo_url: logoUrl, updated_at: nowIso })
      .eq('id', existing.id)
    if (error) throw error
    return String(existing.id)
  }

  const id = randomUUID()
  const { error } = await supabase
    .from('template_clubs')
    .insert({ id, name: club.name, league: club.league, logo_url: logoUrl, updated_at: nowIso })
  if (error) throw error
  return id
}

// Replace a club's cached roster wholesale: clear the old rows, insert the
// fresh scrape. Done per-club so a partial run leaves earlier clubs intact.
async function replaceRosterItems(templateClubId: string, items: TemplateRosterItemInput[]): Promise<void> {
  const { error: delErr } = await supabase
    .from('template_roster_items')
    .delete()
    .eq('template_club_id', templateClubId)
  if (delErr) throw delErr

  if (items.length === 0) return

  const nowIso = new Date().toISOString()
  const rows = items.map((it) => ({
    id: randomUUID(),
    template_club_id: templateClubId,
    name: it.name,
    date_of_birth: it.dateOfBirth ? it.dateOfBirth.toISOString() : null,
    nationality: it.nationality,
    position: it.position,
    squad_number: it.squadNumber,
    is_manager: it.isManager,
    // BIGINT column — values are well within Number.MAX_SAFE_INTEGER.
    estimated_transfer_fee: it.estimatedTransferFee == null ? null : Number(it.estimatedTransferFee),
    contract_start: it.contractStart ? it.contractStart.toISOString() : null,
    contract_end: it.contractEnd ? it.contractEnd.toISOString() : null,
    updated_at: nowIso,
  }))

  const { error } = await supabase.from('template_roster_items').insert(rows)
  if (error) throw error
}

// ── Sync steps ─────────────────────────────────────────────────────────────────

// Discover the club roster for both competitions. A failure in one competition
// is logged and skipped so the other still syncs.
async function collectClubs(): Promise<ClubRef[]> {
  const clubs: ClubRef[] = []
  for (const comp of COMPETITIONS) {
    try {
      const data = await fetchJson<CompetitionClubsResponse>(
        `/competitions/${comp.competitionId}/clubs?season_id=${SEASON_ID}`,
      )
      for (const c of data.clubs ?? []) {
        const tmId = c.id?.trim()
        const name = c.name?.trim()
        if (tmId && name) clubs.push({ tmId, name, league: comp.league })
      }
      console.log(`[sync-templates] ${comp.competitionId}: found ${data.clubs?.length ?? 0} clubs`)
    } catch (err) {
      console.warn(`[sync-templates] competition ${comp.competitionId} failed: ${(err as Error).message}`)
    }
    await sleep(REQUEST_DELAY_MS)
  }
  return clubs
}

// Fetch a player's current shirt number from their profile (the only place the
// scraper exposes it). Best-effort: returns null on any failure.
async function fetchShirtNumber(playerId: string): Promise<number | null> {
  try {
    const profile = await fetchJson<PlayerProfileResponse>(`/players/${playerId}/profile`)
    return parseShirtNumber(profile.shirtNumber)
  } catch {
    return null
  }
}

// Sync a single club: fetch its profile (logo + best-effort coach) and squad,
// map them, and replace the cached rows. Returns the number of roster items.
async function syncClub(club: ClubRef): Promise<number> {
  // Profile is non-essential (logo + maybe coach); tolerate its failure.
  let logoUrl: string | null = null
  let coachItem: TemplateRosterItemInput | null = null
  try {
    const profile = await fetchJson<ClubProfileResponse>(`/clubs/${club.tmId}/profile`)
    logoUrl = profile.image ?? null
    if (profile.coach?.name) {
      coachItem = mapCoachToRosterItem(profile.coach.name, {
        joined: profile.coach.joined ?? null,
        contract: profile.coach.contract ?? null,
      })
    }
  } catch (err) {
    console.warn(`[sync-templates]   profile for ${club.name} unavailable: ${(err as Error).message}`)
  }

  // Squad is essential — let a failure here propagate to the per-club boundary.
  const squad = await fetchJson<ClubPlayersResponse>(`/clubs/${club.tmId}/players?season_id=${SEASON_ID}`)

  const items: TemplateRosterItemInput[] = []
  for (const p of squad.players ?? []) {
    const mapped = mapPlayerToRosterItem(p)
    if (!mapped) continue
    // Enrich with the shirt number from the per-player profile (best-effort).
    if (FETCH_SHIRT_NUMBERS && p.id) {
      mapped.squadNumber = await fetchShirtNumber(p.id)
      await sleep(PLAYER_DELAY_MS) // pace the extra per-player requests
    }
    items.push(mapped)
  }
  if (coachItem) items.push(coachItem)

  const templateClubId = await upsertTemplateClub(club, logoUrl)
  await replaceRosterItems(templateClubId, items)
  return items.length
}

// ── Entrypoint ──────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  console.log(
    `[sync-templates] starting — api=${API_BASE} season=${SEASON_ID} delay=${REQUEST_DELAY_MS}ms timeout=${REQUEST_TIMEOUT_MS}ms ` +
      `shirtNumbers=${FETCH_SHIRT_NUMBERS ? `on (playerDelay=${PLAYER_DELAY_MS}ms)` : 'off'}`,
  )

  const clubs = await collectClubs()
  console.log(`[sync-templates] discovered ${clubs.length} clubs across ${COMPETITIONS.length} competitions`)

  let synced = 0
  let failed = 0
  let totalItems = 0

  for (const club of clubs) {
    try {
      const count = await syncClub(club)
      synced++
      totalItems += count
      console.log(`[sync-templates] ✓ ${club.name} — ${count} roster items`)
    } catch (err) {
      failed++
      console.warn(`[sync-templates] ✗ ${club.name} [${club.tmId}] failed: ${(err as Error).message}`)
    }
    // Anti-scraping safeguard: always pause between clubs, even after a failure.
    await sleep(REQUEST_DELAY_MS)
  }

  console.log(
    `[sync-templates] done — ${synced} clubs synced, ${failed} failed, ${totalItems} roster items cached.`,
  )
}

// Only run when invoked directly (so the file can be imported by tests without
// executing the worker or requiring DB env vars at import time).
const invokedDirectly =
  Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1] as string).href

if (invokedDirectly) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[sync-templates] fatal:', err)
      process.exit(1)
    })
}

export { main, syncClub, collectClubs, deriveSeasonId }
