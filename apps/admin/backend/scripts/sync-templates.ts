// ─────────────────────────────────────────────────────────────────────────────
// Background Template Sync Worker (MVP 2.0 onboarding) — BIO-ONLY model.
//
// Populates the template_clubs / template_roster_items dictionary. We ingest
// ONLY biographical data; no financials. This keeps the payload tiny (one API
// call per club for the squad), avoids Cloudflare rate-limiting, and forces the
// CFO to enter their own official accounting figures on the Roster page.
//
//   • Players  — one felipeall API call per club: /clubs/{id}/players.
//                Name, position, squad number, nationality, DOB, contract
//                start/end. estimatedTransferFee / wages are left NULL.
//   • Manager  — one native HTML fetch per club from transfermarkt.com's
//                Coaching Staff page (the felipeall wrapper has no reliable
//                /staff endpoint). Name, nationality, appointed/contract dates.
//                Financial fields left NULL.
//
// This is meant to run on a controlled MONTHLY schedule (cron / admin trigger),
// NOT during user onboarding — onboarding reads only our local cache.
//
// Run it with:
//   pnpm --filter @85percent/admin sync:templates
// Configure via env (all optional):
//   TRANSFERMARKT_API_URL        base URL of the felipeall API (default http://localhost:8000)
//   TRANSFERMARKT_SEASON_ID      season start year, e.g. 2025  (default: derived from today)
//   TRANSFERMARKT_SYNC_DELAY_MS  delay between clubs           (default 3000)
//   TRANSFERMARKT_TIMEOUT_MS     per-request timeout           (default 20000)
//   TRANSFERMARKT_FETCH_MANAGER  set to 0 to skip the coach scrape
//   TRANSFERMARKT_FETCH_EXTENSIONS set to 1 to scrape each player's profile for
//                                the real "last contract extension" date (slow:
//                                ~1 fetch/player; flags extension blocks on import)
//   TRANSFERMARKT_PLAYER_DELAY_MS throttle between player-profile fetches (default 400)
//
// Safety nets:
//   • A generous, configurable delay between every club (anti-Cloudflare).
//   • Each club sync is wrapped in its own try/catch — one broken selector or
//     timeout logs a warning and the batch continues; it never crashes wholesale.
// ─────────────────────────────────────────────────────────────────────────────

import { randomUUID } from 'crypto'
import { pathToFileURL } from 'url'
import { supabase } from '../lib/supabase'
import {
  mapCoachToRosterItem,
  mapPlayerToRosterItem,
  type TemplateLeagueValue,
  type TemplateRosterItemInput,
  type TransfermarktPlayer,
} from './transfermarkt-mappers'
import { extractHeadCoach } from './transfermarkt-coach-scraper'
import { parseSquadNumbers } from './transfermarkt-squad-scraper'
import { parsePlayerContractDates } from './transfermarkt-player-scraper'

// ── Config ───────────────────────────────────────────────────────────────────
const API_BASE = (process.env['TRANSFERMARKT_API_URL'] ?? 'http://localhost:8000').replace(/\/+$/, '')
const SEASON_ID = process.env['TRANSFERMARKT_SEASON_ID'] ?? deriveSeasonId()
const REQUEST_DELAY_MS = Number(process.env['TRANSFERMARKT_SYNC_DELAY_MS'] ?? 3000)
const REQUEST_TIMEOUT_MS = Number(process.env['TRANSFERMARKT_TIMEOUT_MS'] ?? 20000)
// One native HTML fetch per club for the head coach; on by default.
const FETCH_MANAGER = process.env['TRANSFERMARKT_FETCH_MANAGER'] !== '0'
// One native HTML fetch per club for shirt numbers (kader page); on by default.
const FETCH_SQUAD_NUMBERS = process.env['TRANSFERMARKT_FETCH_SQUAD_NUMBERS'] !== '0'
// One native HTML fetch PER PLAYER for the "last contract extension" date (only
// on the individual profile page). OFF by default — it adds ~1 fetch per player
// (slow, and hits transfermarkt.com directly), so it's opt-in for the runs where
// accurate extension/amortisation data is wanted. Throttled by PLAYER_DELAY_MS.
const FETCH_EXTENSIONS = process.env['TRANSFERMARKT_FETCH_EXTENSIONS'] === '1'
const PLAYER_DELAY_MS = Number(process.env['TRANSFERMARKT_PLAYER_DELAY_MS'] ?? 400)
// transfermarkt.com base for the native coach scrape (not the felipeall API).
const TM_WEB_BASE = (process.env['TRANSFERMARKT_WEB_URL'] ?? 'https://www.transfermarkt.com').replace(/\/+$/, '')
// A browser-like UA so transfermarkt.com serves the full staff page.
const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

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

// felipeall sits behind Cloudflare and throttles bursts with transient 405 /
// 429 / 5xx responses (observed: it alternates 200 ↔ 405 on rapid repeats).
// Treating those as a hard failure would silently zero out real transfer fees,
// so we retry them with exponential backoff before giving up.
const RETRY_STATUSES = new Set([405, 408, 425, 429, 500, 502, 503, 504])
const MAX_RETRIES = Number(process.env['TRANSFERMARKT_MAX_RETRIES'] ?? 3)
const RETRY_BASE_MS = Number(process.env['TRANSFERMARKT_RETRY_BASE_MS'] ?? 1500)

async function fetchOnce<T>(path: string): Promise<T> {
  const url = `${API_BASE}${path}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    })
    if (!res.ok) {
      const e = new Error(`HTTP ${res.status} for ${path}`) as Error & { status?: number }
      e.status = res.status
      throw e
    }
    return (await res.json()) as T
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      const e = new Error(`Timeout after ${REQUEST_TIMEOUT_MS}ms for ${path}`) as Error & { status?: number }
      e.status = 408
      throw e
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}

async function fetchJson<T>(path: string): Promise<T> {
  let lastErr: unknown
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fetchOnce<T>(path)
    } catch (err) {
      lastErr = err
      const status = (err as { status?: number }).status
      const retryable = status != null && RETRY_STATUSES.has(status)
      if (!retryable || attempt === MAX_RETRIES) break
      const backoff = RETRY_BASE_MS * Math.pow(2, attempt) // 1.5s, 3s, 6s, …
      console.warn(`[sync-templates]     ${path} → HTTP ${status}, retry ${attempt + 1}/${MAX_RETRIES} in ${backoff}ms`)
      await sleep(backoff)
    }
  }
  throw lastErr
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
    // Original join date, kept separately from contract_start (an extension date).
    joined_date: it.joinedDate ? it.joinedDate.toISOString() : null,
    // True when contract_start came from a last_extension date — flags an
    // extension block whose carried book value the CFO must audit on import.
    contract_start_from_extension: it.contractStartFromExtension,
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

// Fetch the club's logo from its felipeall profile. Non-essential — returns null
// on any failure so a missing crest never aborts the squad sync.
async function fetchClubLogo(clubTmId: string): Promise<string | null> {
  try {
    const profile = await fetchJson<ClubProfileResponse>(`/clubs/${clubTmId}/profile`)
    return profile.image ?? null
  } catch {
    return null
  }
}

// Fetch a transfermarkt.com HTML page (browser UA so the full markup is served).
// Throws on non-OK / timeout so callers can log and degrade gracefully.
async function fetchHtml(path: string): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const res = await fetch(`${TM_WEB_BASE}${path}`, {
      signal: controller.signal,
      headers: {
        'User-Agent': BROWSER_UA,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    return await res.text()
  } finally {
    clearTimeout(timer)
  }
}

// Native shirt-number scrape: ONE HTML fetch of the club's detailed squad
// ("kader") page (the felipeall players API carries no shirt number). Returns a
// player-id → number map; an empty map on any failure so numbers are simply left
// null and the club's sync still completes.
async function fetchSquadNumbers(clubTmId: string, clubName: string): Promise<Map<string, number>> {
  try {
    const html = await fetchHtml(`/-/kader/verein/${clubTmId}/saison_id/${SEASON_ID}/plus/1`)
    return parseSquadNumbers(html)
  } catch (err) {
    console.warn(`[sync-templates]   squad numbers for ${clubName} unavailable: ${(err as Error).message}`)
    return new Map()
  }
}

// Native per-player extension scrape: ONE HTML fetch of the player's profile
// page, parsed for the "Date of last contract extension". Returns null on any
// failure (logged at debug level) so a single bad profile never aborts the club.
async function fetchPlayerExtension(playerTmId: string): Promise<string | null> {
  try {
    const html = await fetchHtml(`/-/profil/spieler/${playerTmId}`)
    return parsePlayerContractDates(html).lastExtension
  } catch {
    return null
  }
}

// Native head-coach scrape: ONE HTML fetch of transfermarkt.com's Coaching Staff
// page, parsed by the pure scraper. Financial fields are left null (bio-only).
// Returns null (logged) when no head coach can be parsed, so a missing manager
// never aborts the club's sync.
async function fetchClubManager(clubTmId: string, clubName: string): Promise<TemplateRosterItemInput | null> {
  try {
    const html = await fetchHtml(`/-/mitarbeiter/verein/${clubTmId}`)
    const coach = extractHeadCoach(html)
    if (!coach) {
      console.warn(`[sync-templates]   no head coach parsed for ${clubName}`)
      return null
    }
    // Bio-only: name + nationality + appointed/contract dates. No financials.
    return mapCoachToRosterItem(coach.name, {
      nationality: coach.nationality,
      joined: coach.appointed,
      contract: coach.contractExpires,
    })
  } catch (err) {
    console.warn(`[sync-templates]   manager for ${clubName} unavailable: ${(err as Error).message}`)
    return null
  }
}

// Sync a single club (BIO-ONLY): one API call for the squad, plus one native
// HTML fetch for the head coach. No fee/market-value/shirt-profile calls.
// Returns the number of roster items written.
async function syncClub(club: ClubRef): Promise<number> {
  // Logo (one profile call) — non-essential, tolerate failure.
  const logoUrl = await fetchClubLogo(club.tmId)

  // Squad — the single essential API call. A failure propagates to the per-club
  // boundary in main(). Bio-only mapping; financials stay null.
  const squad = await fetchJson<ClubPlayersResponse>(`/clubs/${club.tmId}/players?season_id=${SEASON_ID}`)

  // Shirt numbers aren't in the API; enrich from the kader page (best-effort).
  const squadNumbers = FETCH_SQUAD_NUMBERS
    ? await fetchSquadNumbers(club.tmId, club.name)
    : new Map<string, number>()

  const items: TemplateRosterItemInput[] = []
  for (const p of squad.players ?? []) {
    // Enrich with the real last-extension date from the profile page (opt-in).
    // When present this becomes the contract start and flags an extension block
    // so the CFO is prompted for the carried book value on import.
    if (FETCH_EXTENSIONS && p.id) {
      p.lastExtension = await fetchPlayerExtension(String(p.id))
      if (PLAYER_DELAY_MS > 0) await sleep(PLAYER_DELAY_MS)
    }
    const mapped = mapPlayerToRosterItem(p)
    if (!mapped) continue
    if (p.id) mapped.squadNumber = squadNumbers.get(String(p.id)) ?? null
    items.push(mapped) // estimatedTransferFee already null (bio-only)
  }

  // Head coach (isManager = true) via one native HTML fetch. Financials null.
  if (FETCH_MANAGER) {
    const coachItem = await fetchClubManager(club.tmId, club.name)
    if (coachItem) items.push(coachItem)
  }

  const templateClubId = await upsertTemplateClub(club, logoUrl)
  await replaceRosterItems(templateClubId, items)
  return items.length
}

// ── Entrypoint ──────────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  console.log(
    `[sync-templates] starting (bio-only) — api=${API_BASE} season=${SEASON_ID} ` +
      `delay=${REQUEST_DELAY_MS}ms timeout=${REQUEST_TIMEOUT_MS}ms ` +
      `manager=${FETCH_MANAGER ? 'on' : 'off'} squadNumbers=${FETCH_SQUAD_NUMBERS ? 'on' : 'off'}`,
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
