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
 *   currentBookValuePence in @headroom/engine. Storage is the snapshot;
 *   reads always recompute against the current date.
 * - Soft-delete only — archived players keep their rows for audit history.
 * - Money is integer pence throughout. Pound conversion happens at the form
 *   boundary and nowhere else.
 */

import { randomUUID } from 'crypto'
import type { FastifyInstance } from 'fastify'
import Papa from 'papaparse'
import { z } from 'zod'
import { supabase } from '../lib/supabase.js'
import { authMiddleware } from '../middleware/auth.js'
import { hasRole } from '../middleware/roles.js'
import { writeAuditLog } from '../lib/audit.js'
import {
  RosterRowSchema,
  ManualPlayerSchema,
  ContractPatchSchema,
  type RosterStagingRow,
  type PlayerWithContract,
} from '@headroom/shared'
import { currentBookValuePence } from '@headroom/engine'

// Roles permitted to mutate the roster (Phase 5 §5.2 role matrix).
function canMutateRoster(role: string): boolean {
  return hasRole(role, 'cfo', 'finance_analyst')
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
const OPTIONAL_COLUMNS = ['nationality', 'date_of_birth'] as const

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

// Compute decimal contract years between two ISO date strings.
// Used purely for human readability in the breakdown table; engine math uses
// the actual Date objects, not this value, so float drift is harmless here.
function yearsBetween(startISO: string, endISO: string): number {
  const start = new Date(startISO + 'T00:00:00Z')
  const end   = new Date(endISO   + 'T00:00:00Z')
  const ms = end.getTime() - start.getTime()
  return Math.round((ms / (365.25 * 24 * 60 * 60 * 1000)) * 100) / 100
}

// Build a fully-validated staging row from a CSV row dict.
function buildStagingRow(rowIndex: number, rawRow: CsvRow): RosterStagingRow {
  const issues: string[] = []

  // Reshape into RosterRowSchema's input shape (numbers parsed up front so
  // Zod sees a number and can produce a meaningful error).
  const candidate = {
    name:                normaliseCell(rawRow['name']),
    position:            normaliseCell(rawRow['position']),
    nationality:         normaliseCell(rawRow['nationality']),
    date_of_birth:       normaliseCell(rawRow['date_of_birth']),
    transfer_fee_pounds: parsePoundsCell(rawRow['transfer_fee_pounds']),
    weekly_wage_pounds:  parsePoundsCell(rawRow['weekly_wage_pounds']),
    agent_fee_pounds:    parsePoundsCell(rawRow['agent_fee_pounds']),
    contract_start:      normaliseCell(rawRow['contract_start']),
    contract_end:        normaliseCell(rawRow['contract_end']),
  }

  // Catch number parse failures with a friendlier message than Zod would give
  for (const [field, label] of [
    ['transfer_fee_pounds', 'Transfer fee'],
    ['weekly_wage_pounds',  'Weekly wage'],
    ['agent_fee_pounds',    'Agent fee'],
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
      const startDate = r.contract_start
      const endDate   = r.contract_end
      const contractLengthYears = yearsBetween(startDate, endDate)
      const bookValuePence = currentBookValuePence(
        transferFeePence,
        new Date(startDate + 'T00:00:00Z'),
        new Date(endDate   + 'T00:00:00Z'),
        new Date()
      )

      return {
        rowIndex, ok: true, issues: [],
        parsed: {
          name: r.name,
          position: r.position,
          ...(r.nationality !== undefined ? { nationality: r.nationality } : {}),
          ...(r.date_of_birth !== undefined ? { dateOfBirth: r.date_of_birth } : {}),
          transferFeePence,
          annualWagePence,
          agentFeePence,
          startDate,
          endDate,
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
  contract: Record<string, unknown> | null
): PlayerWithContract {
  const now = new Date()
  let contractOut: PlayerWithContract['contract'] = null
  let monthsToExpiry: number | null = null

  if (contract) {
    const startDate = String(contract['start_date']).slice(0, 10)
    const endDate   = String(contract['end_date']).slice(0, 10)
    const startObj  = new Date(startDate + 'T00:00:00Z')
    const endObj    = new Date(endDate   + 'T00:00:00Z')
    const transferFeePence = Number(contract['transfer_fee'])

    // Live book value — ignore the stored snapshot (Phase 5 will refresh on schedule)
    const liveBookValue = currentBookValuePence(transferFeePence, startObj, endObj, now)

    contractOut = {
      id: String(contract['id']),
      transferFeePence,
      annualWagePence: Number(contract['annual_wage']),
      agentFeePence:   Number(contract['agent_fee']),
      startDate,
      endDate,
      contractLengthYears: Number(contract['contract_length_years']),
      bookValuePence: liveBookValue,
      isActive: Boolean(contract['is_active']),
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

  return {
    id: String(player['id']),
    clubId: String(player['club_id']),
    name: String(player['name']),
    position: (player['position'] as PlayerWithContract['position']) ?? null,
    nationality: (player['nationality'] as string | null) ?? null,
    dateOfBirth,
    isActive: Boolean(player['is_active']),
    archivedAt: (player['archived_at'] as string | null) ?? null,
    createdAt: String(player['created_at']),
    contract: contractOut,
    monthsToExpiry,
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
  rows: z.array(
    z.object({
      name: z.string().min(1),
      position: z.enum(['GK', 'DEF', 'MID', 'FWD']),
      nationality: z.string().max(60).optional(),
      dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date of birth must be YYYY-MM-DD').optional(),
      transferFeePence: z.number().int().min(0),
      annualWagePence:  z.number().int().positive(),
      agentFeePence:    z.number().int().min(0),
      startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      endDate:   z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    })
  ).min(1, 'No rows to commit').max(100, 'Too many rows (max 100)'),
})

const PlayerPatchBody = z.object({
  name:        z.string().trim().min(1).max(80).optional(),
  position:    z.enum(['GK', 'DEF', 'MID', 'FWD']).optional(),
  nationality: z.string().trim().max(60).nullable().optional(),
  // Pass null to clear; pass YYYY-MM-DD to set.
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD').nullable().optional(),
}).refine((r) => Object.values(r).some((v) => v !== undefined), { message: 'No fields provided' })

// ---------------------------------------------------------------------------
// Route module
// ---------------------------------------------------------------------------
export async function rosterRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authMiddleware)

  // ---------------------------------------------------------------------- GET /roster
  app.get('/roster', async (request, reply) => {
    try {
      const { data: players, error: playersErr } = await supabase
        .from('players')
        .select('id, club_id, name, position, nationality, date_of_birth, is_active, archived_at, created_at')
        .eq('club_id', request.clubId)
        .eq('is_active', true)
        .order('name', { ascending: true })

      if (playersErr) throw playersErr

      const playerIds = (players ?? []).map((p) => p.id as string)
      let contractsByPlayer = new Map<string, Record<string, unknown>>()

      if (playerIds.length > 0) {
        const { data: contracts, error: contractsErr } = await supabase
          .from('contracts')
          .select('id, player_id, transfer_fee, annual_wage, agent_fee, start_date, end_date, contract_length_years, book_value, is_active')
          .eq('club_id', request.clubId)
          .eq('is_active', true)
          .in('player_id', playerIds)

        if (contractsErr) throw contractsErr

        for (const c of contracts ?? []) {
          contractsByPlayer.set(c.player_id as string, c as Record<string, unknown>)
        }
      }

      const out = (players ?? []).map((p) =>
        buildPlayerResponse(p as Record<string, unknown>, contractsByPlayer.get(p.id as string) ?? null)
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
        .select('id, club_id, name, position, nationality, date_of_birth, is_active, archived_at, created_at')
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
          .select('id, player_id, transfer_fee, annual_wage, agent_fee, start_date, end_date, contract_length_years, book_value, is_active')
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
        buildPlayerResponse(p as Record<string, unknown>, contractsByPlayer.get(p.id as string) ?? null)
      )

      return reply.send({ players: out })
    } catch (err) {
      request.log.error({ err }, 'GET /roster/archived failed')
      return reply.status(500).send({ error: 'Failed to load archived players' })
    }
  })

  // ---------------------------------------------------------------------- POST /roster/parse
  app.post('/roster/parse', async (request, reply) => {
    if (!canMutateRoster(request.userRole)) {
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
    if (!canMutateRoster(request.userRole)) {
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
        nationality: r.nationality ?? '',
        date_of_birth: r.dateOfBirth ?? '',
        transfer_fee_pounds: Math.floor(r.transferFeePence / 100),
        weekly_wage_pounds:  Math.floor(r.annualWagePence / 52 / 100),
        agent_fee_pounds:    Math.floor(r.agentFeePence / 100),
        contract_start: r.startDate,
        contract_end:   r.endDate,
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
      const nowISO = new Date().toISOString()
      const playersToInsert: Array<Record<string, unknown>> = []
      const contractsToInsert: Array<Record<string, unknown>> = []

      for (const r of accepted) {
        const playerId   = randomUUID()
        const contractId = randomUUID()
        const startObj = new Date(r.startDate + 'T00:00:00Z')
        const endObj   = new Date(r.endDate   + 'T00:00:00Z')
        const bookVal  = currentBookValuePence(r.transferFeePence, startObj, endObj, new Date())

        playersToInsert.push({
          id: playerId,
          club_id: request.clubId,
          name: r.name,
          position: r.position,
          nationality: r.nationality ?? null,
          date_of_birth: r.dateOfBirth ?? null,
          is_active: true,
          created_at: nowISO,
          updated_at: nowISO,
        })

        contractsToInsert.push({
          id: contractId,
          player_id: playerId,
          club_id: request.clubId,
          transfer_fee: r.transferFeePence,
          annual_wage:  r.annualWagePence,
          agent_fee:    r.agentFeePence,
          start_date: r.startDate,
          end_date:   r.endDate,
          contract_length_years: yearsBetween(r.startDate, r.endDate),
          book_value: bookVal,
          is_active: true,
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
    if (!canMutateRoster(request.userRole)) {
      return reply.status(403).send({ error: 'Insufficient permissions' })
    }

    const parsed = ManualPlayerSchema.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() })
    }

    try {
      const r = parsed.data
      const nowISO = new Date().toISOString()
      const playerId   = randomUUID()
      const contractId = randomUUID()
      const startObj = new Date(r.startDate + 'T00:00:00Z')
      const endObj   = new Date(r.endDate   + 'T00:00:00Z')
      const bookVal  = currentBookValuePence(r.transferFeePence, startObj, endObj, new Date())

      const { error: pErr } = await supabase.from('players').insert({
        id: playerId,
        club_id: request.clubId,
        name: r.name,
        position: r.position,
        nationality: r.nationality ?? null,
        date_of_birth: r.dateOfBirth ?? null,
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
        annual_wage:  r.annualWagePence,
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

      await writeAuditLog(request, 'players', playerId, 'create', { name: r.name, position: r.position })

      return reply.status(201).send({ playerId, contractId })
    } catch (err) {
      request.log.error({ err }, 'POST /roster/player failed')
      return reply.status(500).send({ error: 'Failed to create player' })
    }
  })

  // ---------------------------------------------------------------------- PATCH /roster/player/:id
  app.patch('/roster/player/:id', async (request, reply) => {
    if (!canMutateRoster(request.userRole)) {
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
      if (parsed.data.nationality !== undefined) patch['nationality'] = parsed.data.nationality
      if (parsed.data.dateOfBirth !== undefined) patch['date_of_birth'] = parsed.data.dateOfBirth

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
    if (!canMutateRoster(request.userRole)) {
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
        .select('id, transfer_fee, annual_wage, agent_fee, start_date, end_date')
        .eq('id', id)
        .eq('club_id', request.clubId)
        .maybeSingle()

      if (findErr) throw findErr
      if (!existing) return reply.status(404).send({ error: 'Contract not found' })

      const next = {
        transferFeePence: parsed.data.transferFeePence ?? Number(existing.transfer_fee),
        annualWagePence:  parsed.data.annualWagePence  ?? Number(existing.annual_wage),
        agentFeePence:    parsed.data.agentFeePence    ?? Number(existing.agent_fee),
        startDate:        parsed.data.startDate        ?? String(existing.start_date).slice(0, 10),
        endDate:          parsed.data.endDate          ?? String(existing.end_date).slice(0, 10),
      }
      // Cross-field validation: end > start, ≤ 7 years
      if (new Date(next.endDate) <= new Date(next.startDate)) {
        return reply.status(400).send({ error: 'End date must be after start date' })
      }
      const sevenYearsOut = new Date(next.startDate)
      sevenYearsOut.setFullYear(sevenYearsOut.getFullYear() + 7)
      if (new Date(next.endDate) > sevenYearsOut) {
        return reply.status(400).send({ error: 'Contract cannot exceed 7 years' })
      }

      const startObj = new Date(next.startDate + 'T00:00:00Z')
      const endObj   = new Date(next.endDate   + 'T00:00:00Z')
      const bookVal  = currentBookValuePence(next.transferFeePence, startObj, endObj, new Date())

      const patch: Record<string, unknown> = {
        transfer_fee: next.transferFeePence,
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

      await writeAuditLog(request, 'contracts', id, 'update', parsed.data, existing)

      return reply.send({ success: true, bookValuePence: bookVal })
    } catch (err) {
      request.log.error({ err }, 'PATCH /roster/contract/:id failed')
      return reply.status(500).send({ error: 'Failed to update contract' })
    }
  })

  // ---------------------------------------------------------------------- POST /roster/player/:id/archive
  // Soft-delete: never hard delete. Keeps the row for audit trail.
  app.post('/roster/player/:id/archive', async (request, reply) => {
    if (!canMutateRoster(request.userRole)) {
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
}
