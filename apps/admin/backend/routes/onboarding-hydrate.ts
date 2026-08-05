// Pure hydration transform for onboarding. Takes a template club + its cached
// roster items and produces the exact row payloads we insert into the live
// tenant tables — with NO database I/O — so it can be unit-tested in isolation
// and exercised against real template data. The route in onboarding.ts owns the
// DB reads/writes and the "empty club / existing manager" guards; this module
// owns the shape of what gets written.

import { randomUUID } from 'crypto'
import { currentBookValuePence } from '@85percent/engine'

export type LeagueId = 'premier-league' | 'efl-championship'
export type TemplateLeague = 'PREMIER_LEAGUE' | 'CHAMPIONSHIP'

// Raw template_roster_items row as returned by Supabase REST.
export interface TemplateRosterItemRow {
  name: string
  date_of_birth: string | null
  nationality: string | null
  position: string | null
  squad_number: number | null
  is_manager: boolean
  estimated_transfer_fee: string | number | null
  contract_start: string | null
  contract_end: string | null
  joined_date?: string | null
  contract_start_from_extension?: boolean | null
}

export interface HydratedRoster {
  players: Array<Record<string, unknown>>
  contracts: Array<Record<string, unknown>>
  registrationAssets: Array<Record<string, unknown>>
  manager: Record<string, unknown> | null
  managerContract: Record<string, unknown> | null
  identity: { name: string; shortName: string; leagueId: LeagueId }
}

// ── enum / league mapping ────────────────────────────────────────────────────
export function leagueIdToTemplate(id: string): TemplateLeague | null {
  if (id === 'premier-league') return 'PREMIER_LEAGUE'
  if (id === 'efl-championship') return 'CHAMPIONSHIP'
  return null
}
export function templateToLeagueId(l: string): LeagueId {
  return l === 'PREMIER_LEAGUE' ? 'premier-league' : 'efl-championship'
}

// Decimal contract years between two ISO dates — readability only; engine math
// uses the Date objects. Mirrors the helper in roster.ts.
export function yearsBetween(startISO: string, endISO: string): number {
  const start = new Date(startISO + 'T00:00:00Z')
  const end = new Date(endISO + 'T00:00:00Z')
  const ms = end.getTime() - start.getTime()
  return Math.round((ms / (365.25 * 24 * 60 * 60 * 1000)) * 100) / 100
}

// Normalise a possibly-null DB timestamp into YYYY-MM-DD, or null.
export function toDateOnly(v: unknown): string | null {
  if (v == null) return null
  const s = String(v).slice(0, 10)
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null
}

// Derive a 3-letter short name from a club name ("Chelsea FC" → "CHE").
export function deriveShortName(name: string): string {
  const cleaned = name.replace(/\bFC\b|\bAFC\b|\bCF\b/gi, '').trim()
  const letters = cleaned.replace(/[^A-Za-z]/g, '')
  return (letters.slice(0, 3) || 'CLB').toUpperCase()
}

// Resolve a contract window for a hydrated row. Templates often lack precise
// dates, so fall back to today → +3 years (a neutral, editable default).
export function resolveContractWindow(
  contractStart: unknown,
  contractEnd: unknown,
  todayISO: string,
): { startDate: string; endDate: string } {
  const start = toDateOnly(contractStart) ?? todayISO
  let end = toDateOnly(contractEnd)
  if (!end || new Date(end + 'T00:00:00Z') <= new Date(start + 'T00:00:00Z')) {
    const d = new Date(start + 'T00:00:00Z')
    d.setUTCFullYear(d.getUTCFullYear() + 3)
    end = d.toISOString().slice(0, 10)
  }
  return { startDate: start, endDate: end }
}

function feePence(raw: string | number | null): number {
  return raw == null ? 0 : Number(raw)
}

// Build every insert payload from a template. `newId` is injectable so tests
// can make ids deterministic; defaults to randomUUID.
export function buildHydratedRoster(args: {
  clubId: string
  templateName: string
  templateLeague: string
  items: TemplateRosterItemRow[]
  now?: Date
  newId?: () => string
}): HydratedRoster {
  const { clubId, templateName, templateLeague, items } = args
  const now = args.now ?? new Date()
  const newId = args.newId ?? randomUUID
  const nowISO = now.toISOString()
  const todayISO = nowISO.slice(0, 10)

  const playerRows = items.filter((r) => !r.is_manager)
  const managerRow = items.find((r) => r.is_manager) ?? null

  const players: Array<Record<string, unknown>> = []
  const contracts: Array<Record<string, unknown>> = []
  const registrationAssets: Array<Record<string, unknown>> = []

  for (const r of playerRows) {
    const playerId = newId()
    const contractId = newId()
    const fee = feePence(r.estimated_transfer_fee)
    const { startDate, endDate } = resolveContractWindow(r.contract_start, r.contract_end, todayISO)
    const bookVal = currentBookValuePence(
      fee,
      new Date(startDate + 'T00:00:00Z'),
      new Date(endDate + 'T00:00:00Z'),
      now,
    )

    players.push({
      id: playerId,
      club_id: clubId,
      name: r.name,
      position: r.position, // GK/DEF/MID/FWD or null
      squad_number: r.squad_number ?? null,
      nationality: r.nationality,
      date_of_birth: toDateOnly(r.date_of_birth),
      // Original join date — falls back to the contract start when the template
      // didn't carry a separate joined date.
      joined_date: toDateOnly(r.joined_date) ?? startDate,
      is_active: true,
      created_at: nowISO,
      updated_at: nowISO,
    })

    // An extension block (start derived from last_extension) becomes an
    // EXTENSION phase with no carried value yet — the UI flags it so the CFO
    // records the remaining Net Book Value (the original fee is unknown).
    const isExtension = r.contract_start_from_extension === true

    contracts.push({
      id: contractId,
      player_id: playerId,
      club_id: clubId,
      transfer_fee: fee,
      carried_book_value: null,
      annual_wage: 0, // wages unknown from Transfermarkt — CFO fills these in
      agent_fee: 0,
      start_date: startDate,
      end_date: endDate,
      contract_length_years: yearsBetween(startDate, endDate),
      book_value: bookVal,
      is_active: true,
      phase_type: isExtension ? 'EXTENSION' : 'INITIAL',
      is_current: true,
      created_at: nowISO,
      updated_at: nowISO,
    })
    registrationAssets.push({
      player_id: playerId,
      club_id: clubId,
      acquisition_fee: fee,
      acquisition_agent_fee: 0,
      acquisition_date: startDate,
      carrying_value: null,
      created_at: nowISO,
      updated_at: nowISO,
    })
  }

  let manager: Record<string, unknown> | null = null
  let managerContract: Record<string, unknown> | null = null
  if (managerRow) {
    const managerId = newId()
    manager = {
      id: managerId,
      club_id: clubId,
      name: managerRow.name,
      nationality: managerRow.nationality,
      is_active: true,
      created_at: nowISO,
      updated_at: nowISO,
    }

    // Transfermarkt's Coaching Staff page often lists no contract-expiry date for
    // a head coach (the column shows " - "). We must NOT fabricate one — a made-up
    // today→+3yr window surfaces a wrong, sometimes already-expired, expiry date.
    // Only seed a contract phase when the template carries a genuine scraped end
    // date; otherwise leave the manager contract empty for the CFO to fill in.
    const realEnd = toDateOnly(managerRow.contract_end)
    if (realEnd) {
      const mcId = newId()
      const fee = feePence(managerRow.estimated_transfer_fee)
      const { startDate, endDate } = resolveContractWindow(managerRow.contract_start, realEnd, todayISO)
      const bookVal = currentBookValuePence(
        fee,
        new Date(startDate + 'T00:00:00Z'),
        new Date(endDate + 'T00:00:00Z'),
        now,
      )
      managerContract = {
        id: mcId,
        manager_id: managerId,
        club_id: clubId,
        compensation_fee: fee,
        annual_wage: 0,
        agent_fee: 0,
        start_date: startDate,
        end_date: endDate,
        contract_length_years: yearsBetween(startDate, endDate),
        book_value: bookVal,
        phase_type: 'INITIAL',
        is_current: true,
        created_at: nowISO,
        updated_at: nowISO,
      }
    }
  }

  return {
    players,
    contracts,
    registrationAssets,
    manager,
    managerContract,
    identity: {
      name: templateName,
      shortName: deriveShortName(templateName),
      leagueId: templateToLeagueId(templateLeague),
    },
  }
}
