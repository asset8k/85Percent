/**
 * Roster routes — MVP 2.0
 *
 * Architecture notes:
 * - The CSV "Staging Area" flow uses two endpoints: /roster/parse validates
 *   without writing, /roster/commit writes a validated batch in a single
 *   atomic-ish operation. Postgres RLS + the supabase service role bypass
 *   means we rely on explicit club_id checks at the application layer for
 *   defence in depth.
 * - bookValue is recomputed on every contract write (and on read) via
 *   currentBookValuePence in @85percent/engine. Storage is the snapshot;
 *   reads always recompute against the current date.
 * - Soft-delete only — archived players keep their rows for audit history.
 * - Money is integer pence throughout. Pound conversion happens at the form
 *   boundary and nowhere else.
 */

import { randomUUID } from 'crypto'
import type { ApiApp } from '../serverless/types'
import Papa from 'papaparse'
import { z } from 'zod'
import { supabase } from '../lib/supabase'
import { authMiddleware } from '../middleware/auth'
import { hasPermission } from '../middleware/permissions'
import type { Permissions } from '../middleware/permissions'
import { writeAuditLog } from '../lib/audit'
import {
  RosterRowSchema,
  ManualPlayerSchema,
  ContractPatchSchema,
  RegistrationAssetCorrectionSchema,
  ManagerInputSchema,
  ManagerContractInputSchema,
  ManagerPatchSchema,
  PhasePatchSchema,
  ExtendContractSchema,
  type RosterStagingRow,
  type PlayerWithContract,
  type ManagerWithContract,
  type ContractPhase,
} from '@85percent/shared'
import { currentBookValuePence, calculateRemainingBookValue, resolveContractPhases } from '@85percent/engine'
import {
  phaseStatusForRow,
  resolvePlayerContract,
  treatmentForRow,
  type ContractRow,
  type RegistrationAssetRow,
} from '../services/player-registration'

// Roster mutation requires the explicit canEditRoster grant (admins implicitly).
function canMutateRoster(permissions: Permissions): boolean {
  return hasPermission(permissions, 'canEditRoster')
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Expected CSV header columns (canonical lowercase, snake_case)
const EXPECTED_COLUMNS = [
  'name', 'position', 'transfer_fee_pounds', 'weekly_wage_pounds',
  'agent_fee_pounds', 'contract_start', 'contract_end',
] as const

// Optional CSV columns — accepted when present, ignored otherwise.
const OPTIONAL_COLUMNS = [
  'squad_number', 'nationality', 'date_of_birth', 'joined_date', 'carried_book_value_pounds', 'amortisation_treatment',
] as const

type CsvRow = Record<string, string | number | undefined>

// Normalise CSV cell — strip whitespace, drop wrapping quotes, return undefined for empty.
function normaliseCell(v: unknown): string | undefined {
  if (v == null) return undefined
  const s = String(v).trim()
  return s.length === 0 ? undefined : s
}

// Parse a £-as-string cell into pounds (integer). Accepts "£1,500", "1500", "1500.00".
// Returns NaN if the value cannot be parsed as a number — caller treats NaN as invalid.
function parsePoundsCell(v: unknown): number {
  const s = normaliseCell(v)
  if (s === undefined) return NaN
  const cleaned = s.replace(/[£,\s]/g, '')
  const n = Number(cleaned)
  if (!Number.isFinite(n)) return NaN
  return Math.round(n) // accept "1500.00" by rounding; ban silent fractional pence at the parse layer
}

// Parse an optional integer cell (e.g. squad number). Blank → undefined (the
// column is optional); a non-numeric value → NaN (flagged as an error upstream).
function parseOptionalIntCell(v: unknown): number | undefined {
  const s = normaliseCell(v)
  if (s === undefined) return undefined
  const n = Number(s)
  if (!Number.isFinite(n)) return NaN
  return Math.round(n)
}

// Parse an optional £-as-string cell (e.g. carried book value). Blank →
// undefined (the column is optional); a non-numeric value → NaN (flagged
// upstream). Accepts "£1,500", "1500", "1500.00" like parsePoundsCell.
function parseOptionalPoundsCell(v: unknown): number | undefined {
  const s = normaliseCell(v)
  if (s === undefined) return undefined
  return parsePoundsCell(s)
}

// Compute decimal contract years between two ISO date strings.
// Used purely for human readability in the breakdown table; engine math uses
// the actual Date objects, not this value, so float drift is harmless here.
function yearsBetween(startISO: string, endISO: string): number {
  const start = new Date(startISO + 'T00:00:00Z')
  const end   = new Date(endISO   + 'T00:00:00Z')
  const ms = end.getTime() - start.getTime()
  return Math.round((ms / (365.25 * 24 * 60 * 60 * 1000)) * 100) / 100
}

type ExtensionFailure = {
  status: number
  code: string
  message: string
  diagnostic?: string
}

function extensionFailureFrom(err: unknown): ExtensionFailure {
  const record = err && typeof err === 'object' ? err as { code?: unknown; message?: unknown } : {}
  const databaseCode = typeof record.code === 'string' ? record.code : undefined
  const databaseMessage = typeof record.message === 'string' ? record.message : undefined

  if (databaseCode === '23505') {
    return { status: 409, code: 'FUTURE_EXTENSION_EXISTS', message: 'A future extension already exists' }
  }
  // The route is deployed with a required extension accounting column. This
  // makes an unapplied migration actionable instead of looking like a user
  // input failure, without revealing database internals to the client.
  if (databaseCode === '42703' || databaseCode === 'PGRST204') {
    return {
      status: 503,
      code: 'EXTENSION_SCHEMA_NOT_READY',
      message: 'Contract-extension setup is incomplete. Ask an administrator to apply the latest database migration.',
      diagnostic: databaseCode,
    }
  }
  return {
    status: 500,
    code: 'EXTENSION_FAILED',
    message: 'We could not log this extension. Refresh and try again.',
    diagnostic: databaseCode ?? databaseMessage,
  }
}

function extensionFailurePayload(failure: ExtensionFailure) {
  return {
    error: failure.message,
    code: failure.code,
    ...(process.env.NODE_ENV !== 'production' && failure.diagnostic ? { diagnostic: failure.diagnostic } : {}),
  }
}

// Build a fully-validated staging row from a CSV row dict.
function buildStagingRow(rowIndex: number, rawRow: CsvRow): RosterStagingRow {
  const issues: string[] = []

  // Reshape into RosterRowSchema's input shape (numbers parsed up front so
  // Zod sees a number and can produce a meaningful error).
  const candidate = {
    name:                normaliseCell(rawRow['name']),
    position:            normaliseCell(rawRow['position']),
    // Optional shirt number — blank stays undefined; a bad value becomes NaN
    // and is flagged below.
    squad_number:        parseOptionalIntCell(rawRow['squad_number']),
    nationality:         normaliseCell(rawRow['nationality']),
    date_of_birth:       normaliseCell(rawRow['date_of_birth']),
    // Optional original join date — blank stays undefined.
    joined_date:         normaliseCell(rawRow['joined_date']),
    transfer_fee_pounds: parsePoundsCell(rawRow['transfer_fee_pounds']),
    // Optional Carried Book Value override — blank stays undefined; a bad value
    // becomes NaN and is flagged below.
    carried_book_value_pounds: parseOptionalPoundsCell(rawRow['carried_book_value_pounds']),
    weekly_wage_pounds:  parsePoundsCell(rawRow['weekly_wage_pounds']),
    agent_fee_pounds:    parsePoundsCell(rawRow['agent_fee_pounds']),
    contract_start:      normaliseCell(rawRow['contract_start']),
    contract_end:        normaliseCell(rawRow['contract_end']),
    amortisation_treatment: normaliseCell(rawRow['amortisation_treatment']) || undefined,
  }

  // Catch number parse failures with a friendlier message than Zod would give
  for (const [field, label] of [
    ['squad_number',              'Squad number'],
    ['carried_book_value_pounds', 'Carried book value'],
    ['transfer_fee_pounds',       'Transfer fee'],
    ['weekly_wage_pounds',        'Weekly wage'],
    ['agent_fee_pounds',          'Agent fee'],
  ] as const) {
    if (Number.isNaN(candidate[field])) {
      issues.push(`${label}: must be a number (got "${rawRow[field] ?? ''}")`)
    }
  }

  if (issues.length === 0) {
    const parsed = RosterRowSchema.safeParse(candidate)
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const path = issue.path.length > 0 ? `${issue.path.join('.')}: ` : ''
        issues.push(`${path}${issue.message}`)
      }
    } else {
      const r = parsed.data
      const transferFeePence = r.transfer_fee_pounds * 100
      const annualWagePence  = r.weekly_wage_pounds * 52 * 100
      const agentFeePence    = r.agent_fee_pounds * 100
      const carriedBookValuePence =
        r.carried_book_value_pounds !== undefined ? r.carried_book_value_pounds * 100 : null
      const startDate = r.contract_start
      const endDate   = r.contract_end
      const contractLengthYears = yearsBetween(startDate, endDate)
      // The carried override (when present) replaces the transfer fee as the
      // amortisation principal, matching the manual-add path.
      const bookValuePence = currentBookValuePence(
        transferFeePence,
        new Date(startDate + 'T00:00:00Z'),
        new Date(endDate   + 'T00:00:00Z'),
        new Date(),
        carriedBookValuePence
      )

      return {
        rowIndex, ok: true, issues: [],
        parsed: {
          name: r.name,
          position: r.position,
          ...(r.squad_number !== undefined ? { squadNumber: r.squad_number } : {}),
          ...(r.nationality !== undefined ? { nationality: r.nationality } : {}),
          ...(r.date_of_birth !== undefined ? { dateOfBirth: r.date_of_birth } : {}),
          ...(r.joined_date !== undefined ? { joinedDate: r.joined_date } : {}),
          transferFeePence,
          ...(carriedBookValuePence !== null ? { carriedBookValuePence } : {}),
          annualWagePence,
          agentFeePence,
          startDate,
          endDate,
          amortisationTreatment: r.amortisation_treatment,
          contractLengthYears,
          bookValuePence,
        },
      }
    }
  }

  return { rowIndex, ok: false, issues }
}

// Map a DB player+contract row pair into the wire-format PlayerWithContract.
function buildPlayerResponse(
  player: Record<string, unknown>,
  contracts: ContractRow[],
  asset: RegistrationAssetRow | null,
  asOf: Date,
): PlayerWithContract {
  const now = asOf
  let contractOut: PlayerWithContract['contract'] = null
  let monthsToExpiry: number | null = null

  const resolved = resolvePlayerContract(contracts, asset, now)
  if (resolved) {
    const contract = resolved.row
    const startDate = String(contract.start_date).slice(0, 10)
    const endDate   = String(contract.end_date).slice(0, 10)
    const endObj    = new Date(endDate   + 'T00:00:00Z')

    contractOut = {
      id: String(contract.id),
      transferFeePence: resolved.transferFeePence,
      acquisitionAgentFeePence: resolved.acquisitionAgentFeePence,
      acquisitionDate: resolved.acquisitionDate,
      carriedBookValuePence: resolved.carriedBookValuePence,
      accountingBasis: resolved.accountingBasis,
      annualWagePence: Number(contract.annual_wage),
      agentFeePence:   Number(contract.agent_fee),
      startDate,
      endDate,
      contractLengthYears: Number(contract.contract_length_years),
      bookValuePence: resolved.bookValuePence,
      annualAmortisationPence: resolved.annualAmortisationPence,
      annualisedAgentFeePence: resolved.annualisedAgentFeePence,
      totalAnnualCostPence: resolved.totalAnnualCostPence,
      phaseStatus: resolved.phaseStatus,
      hasRegistrationAsset: resolved.hasRegistrationAsset,
      amortisationTreatment: treatmentForRow(contract),
      isActive: Boolean(contract.is_active),
      phaseType: contract.phase_type === 'EXTENSION' ? 'EXTENSION' : 'INITIAL',
    }

    monthsToExpiry =
      (endObj.getUTCFullYear() - now.getUTCFullYear()) * 12 +
      (endObj.getUTCMonth()    - now.getUTCMonth())
  }

  // date_of_birth comes back from Postgres as either a YYYY-MM-DD string or an
  // ISO timestamp depending on whether the column is DATE or TIMESTAMP. Slice
  // to the first 10 chars defensively so the wire-format is always YYYY-MM-DD.
  const rawDob = player['date_of_birth']
  const dateOfBirth = rawDob == null ? null : String(rawDob).slice(0, 10)
  const rawJoined = player['joined_date']
  const joinedDate = rawJoined == null ? null : String(rawJoined).slice(0, 10)

  return {
    id: String(player['id']),
    clubId: String(player['club_id']),
    name: String(player['name']),
    position: (player['position'] as PlayerWithContract['position']) ?? null,
    squadNumber: player['squad_number'] == null ? null : Number(player['squad_number']),
    nationality: (player['nationality'] as string | null) ?? null,
    dateOfBirth,
    joinedDate,
    isActive: Boolean(player['is_active']),
    archivedAt: (player['archived_at'] as string | null) ?? null,
    createdAt: String(player['created_at']),
    contract: contractOut,
    monthsToExpiry,
  }
}

// Months from now until an ISO date (negative if already past).
function monthsUntil(endISO: string): number {
  const now = new Date()
  const end = new Date(endISO + 'T00:00:00Z')
  return (end.getUTCFullYear() - now.getUTCFullYear()) * 12 + (end.getUTCMonth() - now.getUTCMonth())
}

// Normalise a `contracts` or `manager_contracts` row into the wire-format
// ContractPhase. `feePence` is read from the table-specific fee column by the
// caller (transfer_fee for players, compensation_fee for managers). Book value
// is recomputed live (capped at 5 years) rather than trusting the stored snapshot.
function buildPhase(row: ContractRow, allRows: ContractRow[], asOfDate: Date): ContractPhase {
  const startDate = String(row['start_date']).slice(0, 10)
  const endDate   = String(row['end_date']).slice(0, 10)
  const startObj  = new Date(startDate + 'T00:00:00Z')
  const endObj    = new Date(endDate   + 'T00:00:00Z')
  const carriedBookValuePence =
    row.carried_book_value == null ? null : Number(row.carried_book_value)
  return {
    id: String(row.id),
    phaseType: row.phase_type === 'EXTENSION' ? 'EXTENSION' : 'INITIAL',
    isCurrent: phaseStatusForRow(row, allRows, asOfDate) === 'ACTIVE',
    status: phaseStatusForRow(row, allRows, asOfDate),
    amortisationTreatment: treatmentForRow(row),
    feePence: Number(row.transfer_fee),
    carriedBookValuePence,
    annualWagePence: Number(row.annual_wage),
    agentFeePence:   Number(row.agent_fee),
    extensionSignedDate: row.extension_signed_date == null ? null : String(row.extension_signed_date).slice(0, 10),
    startDate,
    endDate,
    contractLengthYears: Number(row.contract_length_years),
    bookValuePence: currentBookValuePence(Number(row.transfer_fee), startObj, endObj, asOfDate, carriedBookValuePence),
    supersededAt: row.superseded_at == null ? null : String(row.superseded_at),
    createdAt: String(row.created_at ?? ''),
  }
}

function buildManagerPhase(row: Record<string, unknown>, allRows: Record<string, unknown>[], asOfDate: Date): ContractPhase {
  const startDate = String(row['start_date']).slice(0, 10)
  const endDate = String(row['end_date']).slice(0, 10)
  const feePence = Number(row['compensation_fee'])
  const status = resolveContractPhases(allRows.map((phase) => ({
    id: String(phase['id']),
    startDate: String(phase['start_date']).slice(0, 10),
    endDate: String(phase['end_date']).slice(0, 10),
    annualWagePence: Number(phase['annual_wage']),
    agentFeePence: Number(phase['agent_fee']),
    isArchived: phase['is_active'] === false,
  })), asOfDate).find((phase) => phase.id === String(row['id']))?.status ?? 'ARCHIVED'
  return {
    id: String(row['id']),
    phaseType: row['phase_type'] === 'EXTENSION' ? 'EXTENSION' : 'INITIAL',
    isCurrent: status === 'ACTIVE',
    status,
    amortisationTreatment: 'CONTINUE_CURRENT_SCHEDULE',
    feePence,
    carriedBookValuePence: null,
    annualWagePence: Number(row['annual_wage']),
    agentFeePence: Number(row['agent_fee']),
    extensionSignedDate: null,
    startDate,
    endDate,
    contractLengthYears: Number(row['contract_length_years']),
    bookValuePence: currentBookValuePence(feePence, new Date(`${startDate}T00:00:00Z`), new Date(`${endDate}T00:00:00Z`), asOfDate),
    supersededAt: row['superseded_at'] == null ? null : String(row['superseded_at']),
    createdAt: String(row['created_at'] ?? ''),
  }
}

// Assemble a ManagerWithContract from a manager row + its contract phases.
// Phases are expected sorted newest-first; the current phase drives expiry.
function buildManagerResponse(
  manager: Record<string, unknown>,
  phases: ContractPhase[]
): ManagerWithContract {
  const current = phases.find((p) => p.isCurrent) ?? null
  return {
    id: String(manager['id']),
    clubId: String(manager['club_id']),
    name: String(manager['name']),
    nationality: (manager['nationality'] as string | null) ?? null,
    isActive: Boolean(manager['is_active']),
    createdAt: String(manager['created_at']),
    contract: current,
    phases,
    monthsToExpiry: current ? monthsUntil(current.endDate) : null,
  }
}

// ---------------------------------------------------------------------------
// Body schemas
// ---------------------------------------------------------------------------

// JSON-style body for /roster/parse (avoids multipart for a tiny payload).
const ParseBody = z.object({
  csvText: z.string().min(1, 'csvText is required').max(2_000_000, 'CSV too large (>2MB)'),
})

// /roster/commit accepts an array of already-validated staging rows. The server
// re-validates against the schema before writing — never trust the client.
const CommitBody = z.object({
  // 'append' (default) adds the batch on top of the current squad; 'replace'
  // wipes the existing ACTIVE players + their contracts first (the head coach
  // and archived players are left untouched).
  mode: z.enum(['append', 'replace']).optional().default('append'),
  rows: z.array(
    z.object({
      name: z.string().min(1),
      position: z.enum(['GK', 'DEF', 'MID', 'FWD']),
      squadNumber: z.number().int().min(1).max(99).optional(),
      nationality: z.string().max(60).optional(),
      dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date of birth must be YYYY-MM-DD').optional(),
      joinedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Join date must be YYYY-MM-DD').optional(),
      transferFeePence: z.number().int().min(0),
      // Optional Carried Book Value override (pence) supplied from the staging UI.
      carriedBookValuePence: z.number().int().min(0).nullable().optional(),
      annualWagePence:  z.number().int().positive(),
      agentFeePence:    z.number().int().min(0),
      startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      endDate:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      amortisationTreatment: z.enum(['CONTINUE_CURRENT_SCHEDULE', 'SPREAD_REMAINING_BOOK_VALUE']).optional().default('CONTINUE_CURRENT_SCHEDULE'),
    })
  ).min(1, 'No rows to commit').max(100, 'Too many rows (max 100)'),
})

const PlayerPatchBody = z.object({
  name:        z.string().trim().min(1).max(80).optional(),
  position:    z.enum(['GK', 'DEF', 'MID', 'FWD']).optional(),
  // Pass null to clear the shirt number; 1–99 to set it.
  squadNumber: z.number().int().min(1).max(99).nullable().optional(),
  nationality: z.string().trim().max(60).nullable().optional(),
  // Pass null to clear; pass YYYY-MM-DD to set.
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD').nullable().optional(),
  // Original join date. Pass null to clear, YYYY-MM-DD to set.
  joinedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD').nullable().optional(),
}).refine((r) => Object.values(r).some((v) => v !== undefined), { message: 'No fields provided' })

// ---------------------------------------------------------------------------
// Route module
// ---------------------------------------------------------------------------
export async function rosterRoutes(app: ApiApp) {
  app.addHook('preHandler', authMiddleware)

  // ---------------------------------------------------------------------- GET /roster
  app.get('/roster', async (request, reply) => {
    const asOfValue = (request.query as Record<string, string> | undefined)?.asOf
    if (asOfValue && !/^\d{4}-\d{2}-\d{2}$/.test(asOfValue)) {
      return reply.status(400).send({ error: 'asOf must be an ISO date (YYYY-MM-DD)' })
    }
    const asOf = asOfValue && /^\d{4}-\d{2}-\d{2}$/.test(asOfValue)
      ? new Date(`${asOfValue}T00:00:00Z`)
      : new Date()
    if (Number.isNaN(asOf.getTime())) {
      return reply.status(400).send({ error: 'asOf must be an ISO date (YYYY-MM-DD)' })
    }
    try {
      const { data: players, error: playersErr } = await supabase
        .from('players')
        .select('id, club_id, name, position, squad_number, nationality, date_of_birth, joined_date, is_active, archived_at, created_at')
        .eq('club_id', request.clubId)
        .eq('is_active', true)
        .order('name', { ascending: true })

      if (playersErr) throw playersErr

      const playerIds = (players ?? []).map((p) => p.id as string)
      let contractsByPlayer = new Map<string, ContractRow[]>()
      let assetsByPlayer = new Map<string, RegistrationAssetRow>()

      if (playerIds.length > 0) {
        const { data: contracts, error: contractsErr } = await supabase
          .from('contracts')
          .select('id, player_id, transfer_fee, carried_book_value, annual_wage, agent_fee, start_date, end_date, contract_length_years, book_value, is_active, phase_type, amortisation_treatment, extension_signed_date, created_at, superseded_at')
          .eq('club_id', request.clubId)
          .eq('is_active', true)
          .in('player_id', playerIds)

        if (contractsErr) throw contractsErr

        for (const c of contracts ?? []) {
          const row = c as ContractRow
          const rows = contractsByPlayer.get(row.player_id) ?? []
          rows.push(row)
          contractsByPlayer.set(row.player_id, rows)
        }

        const { data: assets, error: assetsErr } = await supabase
          .from('player_registration_assets')
          .select('player_id, acquisition_fee, acquisition_agent_fee, acquisition_date, carrying_value')
          .eq('club_id', request.clubId)
          .in('player_id', playerIds)
        if (assetsErr) throw assetsErr
        assetsByPlayer = new Map((assets ?? []).map((asset) => [String(asset.player_id), asset as RegistrationAssetRow]))
      }

      const out = (players ?? []).map((p) =>
        buildPlayerResponse(
          p as Record<string, unknown>,
          contractsByPlayer.get(p.id as string) ?? [],
          assetsByPlayer.get(p.id as string) ?? null,
          asOf,
        )
      )

      return reply.send({ players: out })
    } catch (err) {
      request.log.error({ err }, 'GET /roster failed')
      return reply.status(500).send({ error: 'Failed to load roster' })
    }
  })

  // ---------------------------------------------------------------------- GET /roster/archived
  app.get('/roster/archived', async (request, reply) => {
    try {
      const { data: players, error } = await supabase
        .from('players')
        .select('id, club_id, name, position, squad_number, nationality, date_of_birth, joined_date, is_active, archived_at, created_at')
        .eq('club_id', request.clubId)
        .eq('is_active', false)
        .order('archived_at', { ascending: false })

      if (error) throw error

      // Archived players don't have an active contract; surface the latest inactive one if useful.
      const playerIds = (players ?? []).map((p) => p.id as string)
      let contractsByPlayer = new Map<string, Record<string, unknown>>()

      if (playerIds.length > 0) {
        const { data: contracts } = await supabase
          .from('contracts')
          .select('id, player_id, transfer_fee, annual_wage, agent_fee, start_date, end_date, contract_length_years, book_value, is_active, extension_signed_date')
          .eq('club_id', request.clubId)
          .in('player_id', playerIds)
          .order('created_at', { ascending: false })

        for (const c of contracts ?? []) {
          // Take the most-recent contract per player (first occurrence wins due to order)
          if (!contractsByPlayer.has(c.player_id as string)) {
            contractsByPlayer.set(c.player_id as string, c as Record<string, unknown>)
          }
        }
      }

      const out = (players ?? []).map((p) =>
        buildPlayerResponse(
          p as Record<string, unknown>,
          [contractsByPlayer.get(p.id as string) ?? null].filter(Boolean) as unknown as ContractRow[],
          null,
          new Date(),
        )
      )

      return reply.send({ players: out })
    } catch (err) {
      request.log.error({ err }, 'GET /roster/archived failed')
      return reply.status(500).send({ error: 'Failed to load archived players' })
    }
  })

  // ---------------------------------------------------------------------- POST /roster/parse
  app.post('/roster/parse', async (request, reply) => {
    if (!canMutateRoster(request.permissions)) {
      return reply.status(403).send({ error: 'Insufficient permissions to import roster' })
    }

    const parsed = ParseBody.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() })
    }

    try {
      const result = Papa.parse<CsvRow>(parsed.data.csvText, {
        header: true,
        skipEmptyLines: true,
        transformHeader: (h) => h.trim().toLowerCase(),
      })

      // Header sanity check — missing required columns return a single global error
      const headers = (result.meta.fields ?? []).map((f) => f.toLowerCase())
      const missing = EXPECTED_COLUMNS.filter((c) => !headers.includes(c))
      if (missing.length > 0) {
        return reply.status(400).send({
          error: `Missing required CSV columns: ${missing.join(', ')}`,
          expectedColumns: EXPECTED_COLUMNS,
          optionalColumns: OPTIONAL_COLUMNS,
        })
      }

      if (!Array.isArray(result.data) || result.data.length === 0) {
        return reply.status(400).send({ error: 'CSV contains no data rows' })
      }

      const rows: RosterStagingRow[] = result.data.map((r, i) => buildStagingRow(i + 1, r))
      const okCount  = rows.filter((r) => r.ok).length
      const errCount = rows.length - okCount

      return reply.send({ rows, summary: { total: rows.length, ok: okCount, error: errCount } })
    } catch (err) {
      request.log.error({ err }, 'POST /roster/parse failed')
      return reply.status(500).send({ error: 'Failed to parse CSV' })
    }
  })

  // ---------------------------------------------------------------------- POST /roster/commit
  app.post('/roster/commit', async (request, reply) => {
    if (!canMutateRoster(request.permissions)) {
      return reply.status(403).send({ error: 'Insufficient permissions to import roster' })
    }

    const parsed = CommitBody.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() })
    }

    // Re-validate every row against the canonical schema. Defence in depth —
    // the client could tamper with values between /parse and /commit.
    const rejected: Array<{ rowIndex: number; issues: string[] }> = []
    const accepted: typeof parsed.data.rows = []
    parsed.data.rows.forEach((r, i) => {
      // Convert pence back to pounds for the canonical RosterRowSchema check
      const candidate = {
        name: r.name,
        position: r.position,
        ...(r.squadNumber !== undefined ? { squad_number: r.squadNumber } : {}),
        nationality: r.nationality ?? '',
        date_of_birth: r.dateOfBirth ?? '',
        joined_date: r.joinedDate ?? '',
        transfer_fee_pounds: Math.floor(r.transferFeePence / 100),
        ...(r.carriedBookValuePence != null
          ? { carried_book_value_pounds: Math.floor(r.carriedBookValuePence / 100) }
          : {}),
        weekly_wage_pounds:  Math.floor(r.annualWagePence / 52 / 100),
        agent_fee_pounds:    Math.floor(r.agentFeePence / 100),
        contract_start: r.startDate,
        contract_end:   r.endDate,
        amortisation_treatment: r.amortisationTreatment,
      }
      const check = RosterRowSchema.safeParse(candidate)
      if (!check.success) {
        rejected.push({
          rowIndex: i + 1,
          issues: check.error.issues.map((iss) => `${iss.path.join('.')}: ${iss.message}`),
        })
      } else {
        accepted.push(r)
      }
    })

    if (rejected.length > 0) {
      return reply.status(400).send({
        error: 'Some rows failed re-validation. Re-run /roster/parse and fix the highlighted rows.',
        rejected,
      })
    }

    try {
      // Replace mode: wipe the current ACTIVE squad before inserting the new
      // batch, so a CSV import doesn't stack on top of a pre-filled template.
      // FK-safe order (no REST transactions): scenario_actions referencing those
      // players → their contracts → the players. The head coach and any archived
      // (soft-deleted) players are intentionally preserved.
      if (parsed.data.mode === 'replace') {
        const { data: activeRows, error: findErr } = await supabase
          .from('players')
          .select('id')
          .eq('club_id', request.clubId)
          .eq('is_active', true)
        if (findErr) throw findErr
        const activeIds = (activeRows ?? []).map((p) => String(p.id))

        if (activeIds.length > 0) {
          const { error: saErr } = await supabase.from('scenario_actions').delete().in('player_id', activeIds)
          if (saErr) throw saErr
          const { error: cDelErr } = await supabase.from('contracts').delete().in('player_id', activeIds)
          if (cDelErr) throw cDelErr
          const { error: pDelErr } = await supabase.from('players').delete().in('id', activeIds)
          if (pDelErr) throw pDelErr
          for (const id of activeIds) {
            await writeAuditLog(request, 'players', id, 'delete', { reason: 'roster CSV replace' })
          }
        }
      }

      const nowISO = new Date().toISOString()
      const playersToInsert: Array<Record<string, unknown>> = []
      const contractsToInsert: Array<Record<string, unknown>> = []
      const assetsToInsert: Array<Record<string, unknown>> = []

      for (const r of accepted) {
        const playerId   = randomUUID()
        const contractId = randomUUID()
        const startObj = new Date(r.startDate + 'T00:00:00Z')
        const endObj   = new Date(r.endDate   + 'T00:00:00Z')
        const carried  = r.carriedBookValuePence ?? null
        const bookVal  = currentBookValuePence(r.transferFeePence, startObj, endObj, new Date(), carried)

        playersToInsert.push({
          id: playerId,
          club_id: request.clubId,
          name: r.name,
          position: r.position,
          squad_number: r.squadNumber ?? null,
          nationality: r.nationality ?? null,
          date_of_birth: r.dateOfBirth ?? null,
          joined_date: r.joinedDate ?? r.startDate, // CSV join date if supplied, else contract start
          is_active: true,
          created_at: nowISO,
          updated_at: nowISO,
        })

        contractsToInsert.push({
          id: contractId,
          player_id: playerId,
          club_id: request.clubId,
          transfer_fee: r.transferFeePence,
          carried_book_value: carried,
          annual_wage:  r.annualWagePence,
          agent_fee:    r.agentFeePence,
          start_date: r.startDate,
          end_date:   r.endDate,
          contract_length_years: yearsBetween(r.startDate, r.endDate),
          book_value: bookVal,
          is_active: true,
          amortisation_treatment: r.amortisationTreatment,
          created_at: nowISO,
          updated_at: nowISO,
        })
        assetsToInsert.push({
          player_id: playerId,
          club_id: request.clubId,
          acquisition_fee: r.transferFeePence,
          acquisition_agent_fee: r.agentFeePence,
          // A carried value is a known balance at the imported contract's
          // start, while an acquisition fee without a carrying override dates
          // from the player's original registration.
          acquisition_date: carried != null ? r.startDate : r.joinedDate ?? r.startDate,
          carrying_value: carried,
          created_at: nowISO,
          updated_at: nowISO,
        })
      }

      // Supabase doesn't expose true transactions over REST — so we do the
      // safe ordering: insert players first; on failure, no contracts exist
      // to leave dangling. On contract failure, attempt to roll back the
      // players we just created (best-effort cleanup).
      const { error: pErr } = await supabase.from('players').insert(playersToInsert)
      if (pErr) throw pErr

      const { error: cErr } = await supabase.from('contracts').insert(contractsToInsert)
      if (cErr) {
        // Rollback players to avoid orphans
        await supabase.from('players')
          .delete()
          .in('id', playersToInsert.map((p) => p['id'] as string))
        throw cErr
      }
      const { error: assetErr } = await supabase.from('player_registration_assets').insert(assetsToInsert)
      if (assetErr) {
        await supabase.from('contracts').delete().in('id', contractsToInsert.map((contract) => contract['id'] as string))
        await supabase.from('players').delete().in('id', playersToInsert.map((player) => player['id'] as string))
        throw assetErr
      }

      // Audit log — one entry per player created
      for (const p of playersToInsert) {
        await writeAuditLog(request, 'players', p['id'] as string, 'create', { name: p['name'], position: p['position'] })
      }

      return reply.status(201).send({
        playersCreated:   playersToInsert.length,
        contractsCreated: contractsToInsert.length,
      })
    } catch (err) {
      request.log.error({ err }, 'POST /roster/commit failed')
      return reply.status(500).send({ error: 'Failed to commit roster' })
    }
  })

  // ---------------------------------------------------------------------- POST /roster/player
  // Manual single-player creation (player + active contract).
  app.post('/roster/player', async (request, reply) => {
    if (!canMutateRoster(request.permissions)) {
      return reply.status(403).send({ error: 'Insufficient permissions' })
    }

    const parsed = ManualPlayerSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() })
    }

    try {
      const r = parsed.data
      const annualWagePence = r.annualWagePence ?? r.weeklyWagePence! * 52
      const nowISO = new Date().toISOString()
      const playerId   = randomUUID()
      const contractId = randomUUID()
      const startObj = new Date(r.startDate + 'T00:00:00Z')
      const endObj   = new Date(r.endDate   + 'T00:00:00Z')
      const carried  = r.carriedBookValuePence ?? null
      const bookVal  = currentBookValuePence(r.transferFeePence, startObj, endObj, new Date(), carried)

      const { error: pErr } = await supabase.from('players').insert({
        id: playerId,
        club_id: request.clubId,
        name: r.name,
        position: r.position,
        squad_number: r.squadNumber ?? null,
        nationality: r.nationality ?? null,
        date_of_birth: r.dateOfBirth ?? null,
        // Explicit join date if given, else default to the contract start (a new
        // signing joins on their start date).
        joined_date: r.joinedDate ?? r.startDate,
        is_active: true,
        created_at: nowISO,
        updated_at: nowISO,
      })
      if (pErr) throw pErr

      const { error: cErr } = await supabase.from('contracts').insert({
        id: contractId,
        player_id: playerId,
        club_id: request.clubId,
        transfer_fee: r.transferFeePence,
        carried_book_value: carried,
        annual_wage:  annualWagePence,
        agent_fee:    r.agentFeePence,
        start_date: r.startDate,
        end_date:   r.endDate,
        contract_length_years: yearsBetween(r.startDate, r.endDate),
        book_value: bookVal,
        is_active: true,
        created_at: nowISO,
        updated_at: nowISO,
      })
      if (cErr) {
        // Rollback the player to avoid an orphan
        await supabase.from('players').delete().eq('id', playerId)
        throw cErr
      }
      const { error: assetErr } = await supabase.from('player_registration_assets').insert({
        player_id: playerId,
        club_id: request.clubId,
        acquisition_fee: r.transferFeePence,
        acquisition_agent_fee: r.agentFeePence,
        acquisition_date: carried != null ? r.startDate : r.joinedDate ?? r.startDate,
        carrying_value: carried,
        created_at: nowISO,
        updated_at: nowISO,
      })
      if (assetErr) {
        await supabase.from('contracts').delete().eq('id', contractId).eq('club_id', request.clubId)
        await supabase.from('players').delete().eq('id', playerId)
        throw assetErr
      }

      await writeAuditLog(request, 'players', playerId, 'create', { name: r.name, position: r.position })

      return reply.status(201).send({ playerId, contractId })
    } catch (err) {
      request.log.error({ err }, 'POST /roster/player failed')
      return reply.status(500).send({ error: 'Failed to create player' })
    }
  })

  // ---------------------------------------------------------------------- PATCH /roster/player/:id
  app.patch('/roster/player/:id', async (request, reply) => {
    if (!canMutateRoster(request.permissions)) {
      return reply.status(403).send({ error: 'Insufficient permissions' })
    }
    const { id } = request.params as { id: string }
    const parsed = PlayerPatchBody.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() })
    }

    try {
      const { data: existing, error: findErr } = await supabase
        .from('players')
        .select('id, name, position, nationality, date_of_birth')
        .eq('id', id)
        .eq('club_id', request.clubId)
        .maybeSingle()

      if (findErr) throw findErr
      if (!existing) return reply.status(404).send({ error: 'Player not found' })

      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
      if (parsed.data.name        !== undefined) patch['name']        = parsed.data.name
      if (parsed.data.position    !== undefined) patch['position']    = parsed.data.position
      if (parsed.data.squadNumber !== undefined) patch['squad_number'] = parsed.data.squadNumber
      if (parsed.data.nationality !== undefined) patch['nationality'] = parsed.data.nationality
      if (parsed.data.dateOfBirth !== undefined) patch['date_of_birth'] = parsed.data.dateOfBirth
      if (parsed.data.joinedDate  !== undefined) patch['joined_date']  = parsed.data.joinedDate

      const { error: updateErr } = await supabase
        .from('players')
        .update(patch)
        .eq('id', id)
        .eq('club_id', request.clubId)

      if (updateErr) throw updateErr

      await writeAuditLog(request, 'players', id, 'update', parsed.data, existing)

      return reply.send({ success: true })
    } catch (err) {
      request.log.error({ err }, 'PATCH /roster/player/:id failed')
      return reply.status(500).send({ error: 'Failed to update player' })
    }
  })

  // ---------------------------------------------------------------------- PATCH /roster/contract/:id
  // Updates contract fields and recomputes book value.
  app.patch('/roster/contract/:id', async (request, reply) => {
    if (!canMutateRoster(request.permissions)) {
      return reply.status(403).send({ error: 'Insufficient permissions' })
    }
    const { id } = request.params as { id: string }
    const parsed = ContractPatchSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() })
    }

    try {
      const { data: existing, error: findErr } = await supabase
        .from('contracts')
        .select('id, player_id, phase_type, transfer_fee, carried_book_value, annual_wage, agent_fee, start_date, end_date')
        .eq('id', id)
        .eq('club_id', request.clubId)
        .maybeSingle()

      if (findErr) throw findErr
      if (!existing) return reply.status(404).send({ error: 'Contract not found' })

      const next = {
        transferFeePence: parsed.data.transferFeePence ?? Number(existing.transfer_fee),
        // undefined ⇒ keep existing, null ⇒ clear override, number ⇒ set it.
        carriedBookValuePence:
          parsed.data.carriedBookValuePence !== undefined
            ? parsed.data.carriedBookValuePence
            : (existing.carried_book_value == null ? null : Number(existing.carried_book_value)),
        annualWagePence:
          parsed.data.annualWagePence
          ?? (parsed.data.weeklyWagePence == null ? undefined : parsed.data.weeklyWagePence * 52)
          ?? Number(existing.annual_wage),
        agentFeePence:    parsed.data.agentFeePence    ?? Number(existing.agent_fee),
        startDate:        parsed.data.startDate        ?? String(existing.start_date).slice(0, 10),
        endDate:          parsed.data.endDate          ?? String(existing.end_date).slice(0, 10),
      }
      // Cross-field validation: end > start, ≤ 10 years.
      // Chelsea's ultra-long deals (Mudryk 8.5y, Caicedo/Enzo 8y) and the
      // follow-on UEFA amortization debate forced the cap upward — 10y still
      // catches obvious typos while accommodating any real-world contract.
      if (new Date(next.endDate) <= new Date(next.startDate)) {
        return reply.status(400).send({ error: 'End date must be after start date' })
      }
      const maxEnd = new Date(next.startDate)
      maxEnd.setFullYear(maxEnd.getFullYear() + 10)
      if (new Date(next.endDate) > maxEnd) {
        return reply.status(400).send({ error: 'Contract cannot exceed 10 years' })
      }

      const startObj = new Date(next.startDate + 'T00:00:00Z')
      const endObj   = new Date(next.endDate   + 'T00:00:00Z')
      const asOfDate = new Date()
      const bookVal  = currentBookValuePence(next.transferFeePence, startObj, endObj, asOfDate, next.carriedBookValuePence)

      const patch: Record<string, unknown> = {
        transfer_fee: next.transferFeePence,
        carried_book_value: next.carriedBookValuePence,
        annual_wage:  next.annualWagePence,
        agent_fee:    next.agentFeePence,
        start_date: next.startDate,
        end_date:   next.endDate,
        contract_length_years: yearsBetween(next.startDate, next.endDate),
        book_value: bookVal,
        updated_at: new Date().toISOString(),
      }

      const { error: updateErr } = await supabase
        .from('contracts')
        .update(patch)
        .eq('id', id)
        .eq('club_id', request.clubId)

      if (updateErr) throw updateErr

      // A registration asset is independent from wage-contract phases. This
      // ordinary correction endpoint never rewrites acquisition cost, source,
      // or acquisition date; otherwise an extension's zero fee can erase the
      // original registration asset. Accounting-source corrections belong in a
      // separately confirmed workflow.

      await writeAuditLog(request, 'contracts', id, 'update', parsed.data, existing)

      return reply.send({ success: true, bookValuePence: bookVal })
    } catch (err) {
      request.log.error({ err }, 'PATCH /roster/contract/:id failed')
      return reply.status(500).send({ error: 'Failed to update contract' })
    }
  })

  // ------------------------------------------------ PATCH /roster/player/:id/registration-asset
  // Explicit, audited correction flow. It never conflates the asset with a
  // wage phase, so editing/renewing a contract cannot replace the acquisition
  // cost with an extension's zero transfer fee.
  app.patch('/roster/player/:id/registration-asset', async (request, reply) => {
    if (!canMutateRoster(request.permissions)) {
      return reply.status(403).send({ error: 'Insufficient permissions' })
    }
    const { id } = request.params as { id: string }
    const parsed = RegistrationAssetCorrectionSchema.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() })

    try {
      const [{ data: player, error: playerErr }, { data: existing, error: assetErr }, { data: earliest, error: contractErr }] = await Promise.all([
        supabase.from('players').select('id').eq('id', id).eq('club_id', request.clubId).maybeSingle(),
        supabase.from('player_registration_assets').select('*').eq('player_id', id).eq('club_id', request.clubId).maybeSingle(),
        supabase.from('contracts').select('transfer_fee, agent_fee, start_date').eq('player_id', id).eq('club_id', request.clubId).order('start_date', { ascending: true }).limit(1).maybeSingle(),
      ])
      if (playerErr) throw playerErr
      if (assetErr) throw assetErr
      if (contractErr) throw contractErr
      if (!player) return reply.status(404).send({ error: 'Player not found' })
      if (!existing && !earliest) return reply.status(409).send({ error: 'A contract is required before accounting data can be corrected' })

      const base = existing ?? {
        acquisition_fee: earliest?.transfer_fee ?? 0,
        acquisition_agent_fee: earliest?.agent_fee ?? 0,
        acquisition_date: earliest?.start_date,
      }
      const patch: {
        player_id: string
        club_id: string
        acquisition_fee: number
        acquisition_agent_fee: number
        acquisition_date: string
        carrying_value: number | null
        updated_at: string
      } = parsed.data.basis === 'ACQUISITION_COST'
        ? {
            player_id: id,
            club_id: request.clubId,
            acquisition_fee: parsed.data.acquisitionFeePence,
            acquisition_agent_fee: Number(base.acquisition_agent_fee ?? 0),
            acquisition_date: String(base.acquisition_date).slice(0, 10),
            carrying_value: null,
            updated_at: new Date().toISOString(),
          }
        : {
            player_id: id,
            club_id: request.clubId,
            acquisition_fee: Number(base.acquisition_fee ?? 0),
            acquisition_agent_fee: Number(base.acquisition_agent_fee ?? 0),
            acquisition_date: String(base.acquisition_date).slice(0, 10),
            carrying_value: parsed.data.currentBookValuePence,
            updated_at: new Date().toISOString(),
          }
      const { error: upsertErr } = await supabase.from('player_registration_assets').upsert(patch, { onConflict: 'player_id' })
      if (upsertErr) throw upsertErr
      await writeAuditLog(request, 'player_registration_assets', id, 'update', parsed.data, existing)
      return reply.send({ success: true })
    } catch (err) {
      request.log.error({ err }, 'PATCH /roster/player/:id/registration-asset failed')
      return reply.status(500).send({ error: 'Failed to correct registration accounting data' })
    }
  })

  // ---------------------------------------------------------------------- POST /roster/player/:id/archive
  // Soft-delete: never hard delete. Keeps the row for audit trail.
  app.post('/roster/player/:id/archive', async (request, reply) => {
    if (!canMutateRoster(request.permissions)) {
      return reply.status(403).send({ error: 'Insufficient permissions' })
    }
    const { id } = request.params as { id: string }

    try {
      const { data: existing, error: findErr } = await supabase
        .from('players')
        .select('id, is_active, name')
        .eq('id', id)
        .eq('club_id', request.clubId)
        .maybeSingle()

      if (findErr) throw findErr
      if (!existing) return reply.status(404).send({ error: 'Player not found' })
      if (existing.is_active === false) {
        return reply.status(409).send({ error: 'Player already archived' })
      }

      const nowISO = new Date().toISOString()

      const { error: pErr } = await supabase
        .from('players')
        .update({ is_active: false, archived_at: nowISO, updated_at: nowISO })
        .eq('id', id)
        .eq('club_id', request.clubId)
      if (pErr) throw pErr

      // Also deactivate all active contracts for this player
      const { error: cErr } = await supabase
        .from('contracts')
        .update({ is_active: false, updated_at: nowISO })
        .eq('player_id', id)
        .eq('club_id', request.clubId)
        .eq('is_active', true)
      if (cErr) {
        // Best-effort: revert the player flag to keep state consistent
        await supabase.from('players')
          .update({ is_active: true, archived_at: null, updated_at: nowISO })
          .eq('id', id)
          .eq('club_id', request.clubId)
        throw cErr
      }

      await writeAuditLog(request, 'players', id, 'delete', { archivedAt: nowISO, name: existing.name })

      return reply.send({ success: true, archivedAt: nowISO })
    } catch (err) {
      request.log.error({ err }, 'POST /roster/player/:id/archive failed')
      return reply.status(500).send({ error: 'Failed to archive player' })
    }
  })

  // ---------------------------------------------------------------------- POST /roster/player/:id/restore
  // Undo a soft-delete: mark the player active again and reactivate the most
  // recently-created contract for them (whether or not it has expired — the
  // expiry chip will render "expired" honestly; users can then edit it).
  app.post('/roster/player/:id/restore', async (request, reply) => {
    if (!canMutateRoster(request.permissions)) {
      return reply.status(403).send({ error: 'Insufficient permissions' })
    }
    const { id } = request.params as { id: string }

    try {
      const { data: existing, error: findErr } = await supabase
        .from('players')
        .select('id, is_active, name')
        .eq('id', id)
        .eq('club_id', request.clubId)
        .maybeSingle()

      if (findErr) throw findErr
      if (!existing) return reply.status(404).send({ error: 'Player not found' })
      if (existing.is_active === true) {
        return reply.status(409).send({ error: 'Player is already active' })
      }

      const nowISO = new Date().toISOString()

      const { error: pErr } = await supabase
        .from('players')
        .update({ is_active: true, archived_at: null, updated_at: nowISO })
        .eq('id', id)
        .eq('club_id', request.clubId)
      if (pErr) throw pErr

      // Reactivate the most-recent contract for this player (if any). If no
      // contracts exist the player simply returns with no contract attached,
      // which the UI already handles (book value / wage / expiry render as "—").
      const { data: contracts } = await supabase
        .from('contracts')
        .select('id, created_at')
        .eq('player_id', id)
        .eq('club_id', request.clubId)
        .order('created_at', { ascending: false })
        .limit(1)

      let reactivatedContractId: string | null = null
      const mostRecent = contracts?.[0]
      if (mostRecent) {
        const contractId = mostRecent.id as string
        const { error: cErr } = await supabase
          .from('contracts')
          .update({ is_active: true, updated_at: nowISO })
          .eq('id', contractId)
          .eq('club_id', request.clubId)
        if (cErr) {
          // Best-effort: revert the player flag so state stays consistent
          await supabase.from('players')
            .update({ is_active: false, archived_at: nowISO, updated_at: nowISO })
            .eq('id', id)
            .eq('club_id', request.clubId)
          throw cErr
        }
        reactivatedContractId = contractId
      }

      await writeAuditLog(request, 'players', id, 'update', {
        restored: true,
        reactivatedContractId,
        name: existing.name,
      })

      return reply.send({ success: true, reactivatedContractId })
    } catch (err) {
      request.log.error({ err }, 'POST /roster/player/:id/restore failed')
      return reply.status(500).send({ error: 'Failed to restore player' })
    }
  })

  // ---------------------------------------------------------------------- DELETE /roster/player/:id
  // Hard delete an archived player. Restricted to already-archived players so
  // an active squad member cannot be removed in a single misclick. Cleans up
  // FK references in this order (Supabase has no transactions over REST so we
  // order operations to minimize damage on partial failure):
  //   1. scenario_actions referencing the player — those actions become
  //      nonsensical once the player is gone, so we drop them outright. A
  //      scenario with zero remaining actions still exists; the user can
  //      clean it up separately.
  //   2. contracts for the player
  //   3. the player row itself
  app.delete('/roster/player/:id', async (request, reply) => {
    if (!canMutateRoster(request.permissions)) {
      return reply.status(403).send({ error: 'Insufficient permissions' })
    }
    const { id } = request.params as { id: string }

    try {
      const { data: existing, error: findErr } = await supabase
        .from('players')
        .select('id, is_active, name')
        .eq('id', id)
        .eq('club_id', request.clubId)
        .maybeSingle()

      if (findErr) throw findErr
      if (!existing) return reply.status(404).send({ error: 'Player not found' })
      if (existing.is_active === true) {
        return reply.status(409).send({
          error: 'Active players cannot be deleted. Archive the player first.',
        })
      }

      // 1. Drop any scenario_actions pointing at this player (e.g. a saved
      //    "sell Smith" action). The scenario row itself is left intact.
      const { error: saErr } = await supabase
        .from('scenario_actions')
        .delete()
        .eq('player_id', id)
      if (saErr) {
        request.log.error({ err: saErr }, 'DELETE /roster/player/:id scenario_actions cleanup failed')
        return reply.status(500).send({ error: 'Failed to delete player (scenario reference cleanup)' })
      }

      // 2. Drop contracts for this player (active or not).
      const { error: cErr } = await supabase
        .from('contracts')
        .delete()
        .eq('player_id', id)
        .eq('club_id', request.clubId)
      if (cErr) {
        request.log.error({ err: cErr }, 'DELETE /roster/player/:id contracts cleanup failed')
        return reply.status(500).send({ error: 'Failed to delete player (contract cleanup)' })
      }

      // 3. Audit BEFORE the final delete so the trail survives.
      await writeAuditLog(request, 'players', id, 'delete', {
        hardDelete: true,
        name: existing.name,
      })

      const { error: pErr } = await supabase
        .from('players')
        .delete()
        .eq('id', id)
        .eq('club_id', request.clubId)
      if (pErr) {
        request.log.error({ err: pErr }, 'DELETE /roster/player/:id final delete failed')
        return reply.status(500).send({ error: 'Failed to delete player' })
      }

      return reply.send({ success: true })
    } catch (err) {
      request.log.error({ err }, 'DELETE /roster/player/:id failed')
      return reply.status(500).send({ error: 'Failed to delete player' })
    }
  })

  // -------------------------------------------------------------------- GET /roster/player/:id/phases
  // Full contract ledger for a player (all phases, newest first) for the ledger UI.
  app.get('/roster/player/:id/phases', async (request, reply) => {
    const { id } = request.params as { id: string }
    const asOfValue = (request.query as Record<string, string> | undefined)?.asOf
    if (asOfValue && !/^\d{4}-\d{2}-\d{2}$/.test(asOfValue)) {
      return reply.status(400).send({ error: 'asOf must be an ISO date (YYYY-MM-DD)' })
    }
    const asOfDate = asOfValue ? new Date(`${asOfValue}T00:00:00Z`) : new Date()
    if (Number.isNaN(asOfDate.getTime())) {
      return reply.status(400).send({ error: 'asOf must be an ISO date (YYYY-MM-DD)' })
    }
    try {
      const { data: player, error: pErr } = await supabase
        .from('players')
        .select('id')
        .eq('id', id)
        .eq('club_id', request.clubId)
        .maybeSingle()
      if (pErr) throw pErr
      if (!player) return reply.status(404).send({ error: 'Player not found' })

      const { data: rows, error } = await supabase
        .from('contracts')
        .select('*')
        .eq('player_id', id)
        .eq('club_id', request.clubId)
        .order('start_date', { ascending: false })
      if (error) throw error

      const contractRows = (rows ?? []) as ContractRow[]
      const phases = contractRows.map((row) => buildPhase(row, contractRows, asOfDate))
      return reply.send({ phases })
    } catch (err) {
      request.log.error({ err }, 'GET /roster/player/:id/phases failed')
      return reply.status(500).send({ error: 'Failed to load contract phases' })
    }
  })

  // -------------------------------------------------------------------- POST /roster/player/:id/extend
  // Log a future contract extension. The new phase is scheduled; date-based
  // reads select it only once it becomes effective, so no background job is
  // required to preserve the existing phase or its registration asset.
  app.post('/roster/player/:id/extend', async (request, reply) => {
    if (!canMutateRoster(request.permissions)) {
      return reply.status(403).send({ error: 'Insufficient permissions' })
    }
    const { id } = request.params as { id: string }
    const parsed = ExtendContractSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({
        error: 'Check the extension dates and financial values, then try again.',
        code: 'INVALID_EXTENSION_INPUT',
        ...(process.env.NODE_ENV !== 'production' ? { diagnostic: parsed.error.flatten() } : {}),
      })
    }
    const { effectiveDate, newEndDate, newAnnualWagePence, newWeeklyWagePence, newAgentFeePence, amortisationTreatment } = parsed.data

    let insertedContractId: string | null = null
    try {
      const { data: player, error: pErr } = await supabase
        .from('players')
        .select('id, is_active')
        .eq('id', id)
        .eq('club_id', request.clubId)
        .maybeSingle()
      if (pErr) throw pErr
      if (!player) return reply.status(404).send({ error: 'Player not found' })

      const { data: contracts, error: curErr } = await supabase
        .from('contracts')
        .select('*')
        .eq('player_id', id)
        .eq('club_id', request.clubId)
        .eq('is_active', true)
      if (curErr) throw curErr
      const rows = (contracts ?? []) as ContractRow[]
      const { data: asset, error: assetErr } = await supabase
        .from('player_registration_assets')
        .select('player_id, acquisition_fee, acquisition_agent_fee, acquisition_date, carrying_value')
        .eq('player_id', id)
        .eq('club_id', request.clubId)
        .maybeSingle()
      if (assetErr) throw assetErr
      const current = resolvePlayerContract(rows, asset as RegistrationAssetRow | null, new Date())
      if (!current) {
        return reply.status(409).send({
          error: 'Contract state changed; refresh and try again.',
          code: 'CONTRACT_STATE_CHANGED',
        })
      }
      const currentEndDate = String(current.row.end_date).slice(0, 10)
      if (effectiveDate <= currentEndDate) {
        return reply.status(400).send({
          error: 'New contract end must be after the current end.',
          code: 'INVALID_EXTENSION_DATES',
        })
      }
      if (rows.some((row) => row.phase_type === 'EXTENSION' && String(row.start_date).slice(0, 10) === effectiveDate)) {
        return reply.status(409).send({
          error: 'A future extension already exists.',
          code: 'FUTURE_EXTENSION_EXISTS',
        })
      }

      const annualWage = newAnnualWagePence ?? newWeeklyWagePence! * 52
      const nowISO = new Date().toISOString()
      const extensionSignedDate = parsed.data.extensionSignedDate ?? nowISO.slice(0, 10)
      const newId  = randomUUID()
      const { error: insErr } = await supabase.from('contracts').insert({
        id: newId,
        player_id: id,
        club_id: request.clubId,
        transfer_fee: 0,
        annual_wage: annualWage,
        agent_fee: newAgentFeePence,
        start_date: effectiveDate,
        end_date: newEndDate,
        contract_length_years: yearsBetween(effectiveDate, newEndDate),
        book_value: current.bookValuePence,
        is_active: true,
        phase_type: 'EXTENSION',
        is_current: false,
        amortisation_treatment: amortisationTreatment,
        extension_signed_date: extensionSignedDate,
        created_at: nowISO,
        updated_at: nowISO,
      })
      if (insErr) throw insErr
      insertedContractId = newId

      const scheduled = resolvePlayerContract([
        ...rows,
        {
          id: newId, player_id: id, transfer_fee: 0, carried_book_value: null,
          annual_wage: annualWage, agent_fee: newAgentFeePence, start_date: effectiveDate,
          end_date: newEndDate, contract_length_years: yearsBetween(effectiveDate, newEndDate),
          is_active: true, phase_type: 'EXTENSION', amortisation_treatment: amortisationTreatment,
          extension_signed_date: extensionSignedDate,
        },
      ], asset as RegistrationAssetRow | null, new Date(`${effectiveDate}T00:00:00Z`))

      await writeAuditLog(request, 'contracts', newId, 'create', {
        extension: true,
        playerId: id,
        amortisationTreatment,
        extensionSignedDate,
        scheduledFromContractId: current.row.id,
      })

      return reply.status(201).send({
        contractId: newId,
        carriedBookValuePence: scheduled?.bookValuePence ?? current.bookValuePence,
        bookValuePence: scheduled?.bookValuePence ?? current.bookValuePence,
        status: 'SCHEDULED',
      })
    } catch (err) {
      if (insertedContractId) {
        const { error: rollbackError } = await supabase
          .from('contracts')
          .delete()
          .eq('id', insertedContractId)
          .eq('club_id', request.clubId)
        if (rollbackError) {
          request.log.error({ rollbackError, contractId: insertedContractId }, 'Extension rollback failed')
        }
      }
      request.log.error({ err }, 'POST /roster/player/:id/extend failed')
      const failure = extensionFailureFrom(err)
      return reply.status(failure.status).send(extensionFailurePayload(failure))
    }
  })

  // -------------------------------------------------------------------- DELETE /roster/contract/:id
  // Delete a single contract phase. Deleting an archived phase just removes it
  // from history. Deleting the current (live) phase "undoes" an extension: the
  // most recent remaining phase is promoted back to current/active. Contracts
  // have no inbound FKs (scenario_actions key off player_id), so the row delete
  // is safe.
  app.delete('/roster/contract/:id', async (request, reply) => {
    if (!canMutateRoster(request.permissions)) {
      return reply.status(403).send({ error: 'Insufficient permissions' })
    }
    const { id } = request.params as { id: string }
    try {
      const { data: phase, error: findErr } = await supabase
        .from('contracts')
        .select('id, player_id, is_current')
        .eq('id', id)
        .eq('club_id', request.clubId)
        .maybeSingle()
      if (findErr) throw findErr
      if (!phase) return reply.status(404).send({ error: 'Contract phase not found' })

      const wasCurrent = Boolean(phase.is_current)
      const playerId = String(phase.player_id)
      const nowISO = new Date().toISOString()

      // Audit before the delete so the trail survives.
      await writeAuditLog(request, 'contracts', id, 'delete', { phaseDelete: true, playerId, wasCurrent })

      const { error: delErr } = await supabase
        .from('contracts')
        .delete()
        .eq('id', id)
        .eq('club_id', request.clubId)
      if (delErr) throw delErr

      // Promote the most recent remaining phase if we removed the live one.
      let promotedContractId: string | null = null
      if (wasCurrent) {
        const { data: remaining } = await supabase
          .from('contracts')
          .select('id')
          .eq('player_id', playerId)
          .eq('club_id', request.clubId)
          .order('start_date', { ascending: false })
          .limit(1)
        const next = remaining?.[0]
        if (next) {
          await supabase
            .from('contracts')
            .update({ is_current: true, is_active: true, superseded_at: null, updated_at: nowISO })
            .eq('id', next.id)
            .eq('club_id', request.clubId)
          promotedContractId = String(next.id)
        }
      }

      return reply.send({ success: true, promotedContractId })
    } catch (err) {
      request.log.error({ err }, 'DELETE /roster/contract/:id failed')
      return reply.status(500).send({ error: 'Failed to delete contract phase' })
    }
  })

  // ==================================================================== MANAGER
  // The Head Coach / Manager mirrors the player+contract model. One active
  // manager per club; their wages + amortised compensation fee + amortised
  // agent fee feed the SCR via deriveSquadCostsForClub in club.ts.

  // -------------------------------------------------------------------- GET /roster/manager
  app.get('/roster/manager', async (request, reply) => {
    try {
      const { data: mgr, error } = await supabase
        .from('managers')
        .select('*')
        .eq('club_id', request.clubId)
        .eq('is_active', true)
        .maybeSingle()
      if (error) throw error
      if (!mgr) return reply.send({ manager: null })

      const { data: rows, error: cErr } = await supabase
        .from('manager_contracts')
        .select('*')
        .eq('manager_id', mgr.id)
        .eq('club_id', request.clubId)
        .order('start_date', { ascending: false })
      if (cErr) throw cErr

      const managerRows = (rows ?? []).map((r) => r as Record<string, unknown>)
      const asOfDate = new Date()
      const phases = managerRows.map((r) => buildManagerPhase(r, managerRows, asOfDate))
      return reply.send({ manager: buildManagerResponse(mgr as Record<string, unknown>, phases) })
    } catch (err) {
      request.log.error({ err }, 'GET /roster/manager failed')
      return reply.status(500).send({ error: 'Failed to load manager' })
    }
  })

  // -------------------------------------------------------------------- POST /roster/manager
  // Create the Head Coach + their INITIAL contract phase.
  app.post('/roster/manager', async (request, reply) => {
    if (!canMutateRoster(request.permissions)) {
      return reply.status(403).send({ error: 'Insufficient permissions' })
    }
    const parsed = ManagerInputSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() })
    }
    const r = parsed.data

    try {
      const annualWagePence = r.annualWagePence ?? r.weeklyWagePence! * 52
      const { data: existing, error: exErr } = await supabase
        .from('managers')
        .select('id')
        .eq('club_id', request.clubId)
        .eq('is_active', true)
        .maybeSingle()
      if (exErr) throw exErr
      if (existing) {
        return reply.status(409).send({ error: 'An active manager already exists. Edit the current Head Coach instead.' })
      }

      const nowISO = new Date().toISOString()
      const managerId  = randomUUID()
      const contractId = randomUUID()
      const startObj = new Date(r.startDate + 'T00:00:00Z')
      const endObj   = new Date(r.endDate   + 'T00:00:00Z')
      const bookVal  = currentBookValuePence(r.compensationFeePence, startObj, endObj, new Date())

      const { error: mErr } = await supabase.from('managers').insert({
        id: managerId,
        club_id: request.clubId,
        name: r.name,
        nationality: r.nationality ?? null,
        is_active: true,
        created_at: nowISO,
        updated_at: nowISO,
      })
      if (mErr) throw mErr

      const { error: cErr } = await supabase.from('manager_contracts').insert({
        id: contractId,
        manager_id: managerId,
        club_id: request.clubId,
        compensation_fee: r.compensationFeePence,
        annual_wage: annualWagePence,
        agent_fee: r.agentFeePence,
        start_date: r.startDate,
        end_date: r.endDate,
        contract_length_years: yearsBetween(r.startDate, r.endDate),
        book_value: bookVal,
        phase_type: 'INITIAL',
        is_current: true,
        created_at: nowISO,
        updated_at: nowISO,
      })
      if (cErr) {
        await supabase.from('managers').delete().eq('id', managerId)
        throw cErr
      }

      await writeAuditLog(request, 'managers', managerId, 'create', { name: r.name })

      return reply.status(201).send({ managerId, contractId })
    } catch (err) {
      request.log.error({ err }, 'POST /roster/manager failed')
      return reply.status(500).send({ error: 'Failed to create manager' })
    }
  })

  // -------------------------------------------------------------------- PATCH /roster/manager/:id
  // Update identity fields (name / active flag). Archiving sets is_active=false.
  app.patch('/roster/manager/:id', async (request, reply) => {
    if (!canMutateRoster(request.permissions)) {
      return reply.status(403).send({ error: 'Insufficient permissions' })
    }
    const { id } = request.params as { id: string }
    const parsed = ManagerPatchSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() })
    }

    try {
      const { data: existing, error: findErr } = await supabase
        .from('managers')
        .select('id, name, is_active')
        .eq('id', id)
        .eq('club_id', request.clubId)
        .maybeSingle()
      if (findErr) throw findErr
      if (!existing) return reply.status(404).send({ error: 'Manager not found' })

      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
      if (parsed.data.name        !== undefined) patch['name']        = parsed.data.name
      if (parsed.data.nationality !== undefined) patch['nationality'] = parsed.data.nationality
      if (parsed.data.isActive    !== undefined) patch['is_active']   = parsed.data.isActive

      const { error: updErr } = await supabase
        .from('managers')
        .update(patch)
        .eq('id', id)
        .eq('club_id', request.clubId)
      if (updErr) throw updErr

      await writeAuditLog(request, 'managers', id, 'update', parsed.data, existing)
      return reply.send({ success: true })
    } catch (err) {
      request.log.error({ err }, 'PATCH /roster/manager/:id failed')
      return reply.status(500).send({ error: 'Failed to update manager' })
    }
  })

  // -------------------------------------------------------------------- PATCH /roster/manager-contract/:id
  // Correct the current manager contract phase in place (NOT an extension).
  app.patch('/roster/manager-contract/:id', async (request, reply) => {
    if (!canMutateRoster(request.permissions)) {
      return reply.status(403).send({ error: 'Insufficient permissions' })
    }
    const { id } = request.params as { id: string }
    const parsed = PhasePatchSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() })
    }

    try {
      const { data: existing, error: findErr } = await supabase
        .from('manager_contracts')
        .select('id, compensation_fee, annual_wage, agent_fee, start_date, end_date')
        .eq('id', id)
        .eq('club_id', request.clubId)
        .maybeSingle()
      if (findErr) throw findErr
      if (!existing) return reply.status(404).send({ error: 'Manager contract not found' })

      const next = {
        compensationFeePence: parsed.data.feePence        ?? Number(existing.compensation_fee),
        annualWagePence:
          parsed.data.annualWagePence
          ?? (parsed.data.weeklyWagePence == null ? undefined : parsed.data.weeklyWagePence * 52)
          ?? Number(existing.annual_wage),
        agentFeePence:        parsed.data.agentFeePence    ?? Number(existing.agent_fee),
        startDate:            parsed.data.startDate        ?? String(existing.start_date).slice(0, 10),
        endDate:              parsed.data.endDate          ?? String(existing.end_date).slice(0, 10),
      }
      if (new Date(next.endDate) <= new Date(next.startDate)) {
        return reply.status(400).send({ error: 'End date must be after start date' })
      }
      const maxEnd = new Date(next.startDate)
      maxEnd.setFullYear(maxEnd.getFullYear() + 10)
      if (new Date(next.endDate) > maxEnd) {
        return reply.status(400).send({ error: 'Contract cannot exceed 10 years' })
      }

      const startObj = new Date(next.startDate + 'T00:00:00Z')
      const endObj   = new Date(next.endDate   + 'T00:00:00Z')
      const bookVal  = currentBookValuePence(next.compensationFeePence, startObj, endObj, new Date())

      const { error: updErr } = await supabase
        .from('manager_contracts')
        .update({
          compensation_fee: next.compensationFeePence,
          annual_wage: next.annualWagePence,
          agent_fee: next.agentFeePence,
          start_date: next.startDate,
          end_date: next.endDate,
          contract_length_years: yearsBetween(next.startDate, next.endDate),
          book_value: bookVal,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .eq('club_id', request.clubId)
      if (updErr) throw updErr

      await writeAuditLog(request, 'manager_contracts', id, 'update', parsed.data, existing)
      return reply.send({ success: true, bookValuePence: bookVal })
    } catch (err) {
      request.log.error({ err }, 'PATCH /roster/manager-contract/:id failed')
      return reply.status(500).send({ error: 'Failed to update manager contract' })
    }
  })

  // -------------------------------------------------------------------- POST /roster/manager/:id/contract
  // Seed the INITIAL contract phase for an existing manager that has none yet.
  // Templates often import a head coach with no contract (Transfermarkt lists no
  // expiry); this lets the CFO add the wages / fee / dates so the manager starts
  // counting toward the Squad Cost Ratio. Rejected if a current contract exists
  // (use the PATCH/extend endpoints to change an existing one).
  app.post('/roster/manager/:id/contract', async (request, reply) => {
    if (!canMutateRoster(request.permissions)) {
      return reply.status(403).send({ error: 'Insufficient permissions' })
    }
    const { id } = request.params as { id: string }
    const parsed = ManagerContractInputSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() })
    }
    const r = parsed.data

    try {
      const annualWagePence = r.annualWagePence ?? r.weeklyWagePence! * 52
      const { data: mgr, error: mErr } = await supabase
        .from('managers')
        .select('id')
        .eq('id', id)
        .eq('club_id', request.clubId)
        .eq('is_active', true)
        .maybeSingle()
      if (mErr) throw mErr
      if (!mgr) return reply.status(404).send({ error: 'Manager not found' })

      const { data: current, error: curErr } = await supabase
        .from('manager_contracts')
        .select('id')
        .eq('manager_id', id)
        .eq('is_current', true)
        .maybeSingle()
      if (curErr) throw curErr
      if (current) {
        return reply.status(409).send({ error: 'This manager already has a contract. Edit it instead.' })
      }

      const nowISO = new Date().toISOString()
      const contractId = randomUUID()
      const startObj = new Date(r.startDate + 'T00:00:00Z')
      const endObj   = new Date(r.endDate   + 'T00:00:00Z')
      const bookVal  = currentBookValuePence(r.compensationFeePence, startObj, endObj, new Date())

      const { error: cErr } = await supabase.from('manager_contracts').insert({
        id: contractId,
        manager_id: id,
        club_id: request.clubId,
        compensation_fee: r.compensationFeePence,
        annual_wage: annualWagePence,
        agent_fee: r.agentFeePence,
        start_date: r.startDate,
        end_date: r.endDate,
        contract_length_years: yearsBetween(r.startDate, r.endDate),
        book_value: bookVal,
        phase_type: 'INITIAL',
        is_current: true,
        created_at: nowISO,
        updated_at: nowISO,
      })
      if (cErr) throw cErr

      await writeAuditLog(request, 'manager_contracts', contractId, 'create', { managerId: id })
      return reply.status(201).send({ contractId, bookValuePence: bookVal })
    } catch (err) {
      request.log.error({ err }, 'POST /roster/manager/:id/contract failed')
      return reply.status(500).send({ error: 'Failed to create manager contract' })
    }
  })

  // -------------------------------------------------------------------- POST /roster/manager/:id/extend
  // Manager equivalent of the player extension transaction.
  app.post('/roster/manager/:id/extend', async (request, reply) => {
    if (!canMutateRoster(request.permissions)) {
      return reply.status(403).send({ error: 'Insufficient permissions' })
    }
    const { id } = request.params as { id: string }
    const parsed = ExtendContractSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() })
    }
    const { effectiveDate, newEndDate, newAnnualWagePence, newWeeklyWagePence, newAgentFeePence } = parsed.data

    try {
      const { data: mgr, error: mErr } = await supabase
        .from('managers')
        .select('id')
        .eq('id', id)
        .eq('club_id', request.clubId)
        .maybeSingle()
      if (mErr) throw mErr
      if (!mgr) return reply.status(404).send({ error: 'Manager not found' })

      const { data: contracts, error: curErr } = await supabase
        .from('manager_contracts')
        .select('*')
        .eq('manager_id', id)
        .eq('club_id', request.clubId)
      if (curErr) throw curErr
      const managerRows = (contracts ?? []) as Record<string, unknown>[]
      const activeId = resolveContractPhases(managerRows.map((phase) => ({
        id: String(phase.id),
        startDate: String(phase.start_date).slice(0, 10),
        endDate: String(phase.end_date).slice(0, 10),
        annualWagePence: Number(phase.annual_wage),
        agentFeePence: Number(phase.agent_fee),
      })), new Date()).find((phase) => phase.status === 'ACTIVE')?.id
      const current = managerRows.find((phase) => String(phase.id) === activeId)
      if (!current) return reply.status(409).send({ error: 'Manager has no current contract to extend' })
      if (effectiveDate <= String(current.end_date).slice(0, 10)) {
        return reply.status(400).send({ error: 'An extension must start after the active contract ends' })
      }
      if (managerRows.some((row) => row.phase_type === 'EXTENSION' && String(row.start_date).slice(0, 10) === effectiveDate)) {
        return reply.status(409).send({ error: 'An extension is already scheduled for this date' })
      }

      const oldStart = new Date(String(current.start_date).slice(0, 10) + 'T00:00:00Z')
      const oldEnd   = new Date(String(current.end_date).slice(0, 10) + 'T00:00:00Z')
      const effObj   = new Date(effectiveDate + 'T00:00:00Z')
      const carried  = calculateRemainingBookValue(
        { feePence: Number(current.compensation_fee), startDate: oldStart, endDate: oldEnd },
        effObj
      )

      const annualWage = newAnnualWagePence ?? newWeeklyWagePence! * 52
      const newEndObj  = new Date(newEndDate + 'T00:00:00Z')
      const newBookValue = currentBookValuePence(carried, effObj, newEndObj, new Date())
      const nowISO = new Date().toISOString()
      const newId  = randomUUID()

      const { error: insErr } = await supabase.from('manager_contracts').insert({
        id: newId,
        manager_id: id,
        club_id: request.clubId,
        compensation_fee: carried,
        annual_wage: annualWage,
        agent_fee: newAgentFeePence,
        start_date: effectiveDate,
        end_date: newEndDate,
        contract_length_years: yearsBetween(effectiveDate, newEndDate),
        book_value: newBookValue,
        phase_type: 'EXTENSION',
        is_current: false,
        created_at: nowISO,
        updated_at: nowISO,
      })
      if (insErr) throw insErr

      await writeAuditLog(request, 'manager_contracts', newId, 'create', {
        extension: true,
        managerId: id,
        carriedBookValuePence: carried,
        scheduledFromContractId: current.id,
      })

      return reply.status(201).send({ contractId: newId, carriedBookValuePence: carried, bookValuePence: newBookValue, status: 'SCHEDULED' })
    } catch (err) {
      request.log.error({ err }, 'POST /roster/manager/:id/extend failed')
      return reply.status(500).send({ error: 'Failed to extend manager contract' })
    }
  })

  // -------------------------------------------------------------------- DELETE /roster/manager-contract/:id
  // Manager equivalent of contract-phase deletion. Promotes the most recent
  // remaining phase to current when the live phase is removed.
  app.delete('/roster/manager-contract/:id', async (request, reply) => {
    if (!canMutateRoster(request.permissions)) {
      return reply.status(403).send({ error: 'Insufficient permissions' })
    }
    const { id } = request.params as { id: string }
    try {
      const { data: phase, error: findErr } = await supabase
        .from('manager_contracts')
        .select('id, manager_id, is_current')
        .eq('id', id)
        .eq('club_id', request.clubId)
        .maybeSingle()
      if (findErr) throw findErr
      if (!phase) return reply.status(404).send({ error: 'Manager contract phase not found' })

      const wasCurrent = Boolean(phase.is_current)
      const managerId = String(phase.manager_id)
      const nowISO = new Date().toISOString()

      await writeAuditLog(request, 'manager_contracts', id, 'delete', { phaseDelete: true, managerId, wasCurrent })

      const { error: delErr } = await supabase
        .from('manager_contracts')
        .delete()
        .eq('id', id)
        .eq('club_id', request.clubId)
      if (delErr) throw delErr

      let promotedContractId: string | null = null
      if (wasCurrent) {
        const { data: remaining } = await supabase
          .from('manager_contracts')
          .select('id')
          .eq('manager_id', managerId)
          .eq('club_id', request.clubId)
          .order('start_date', { ascending: false })
          .limit(1)
        const next = remaining?.[0]
        if (next) {
          await supabase
            .from('manager_contracts')
            .update({ is_current: true, superseded_at: null, updated_at: nowISO })
            .eq('id', next.id)
            .eq('club_id', request.clubId)
          promotedContractId = String(next.id)
        }
      }

      return reply.send({ success: true, promotedContractId })
    } catch (err) {
      request.log.error({ err }, 'DELETE /roster/manager-contract/:id failed')
      return reply.status(500).send({ error: 'Failed to delete manager contract phase' })
    }
  })
}
