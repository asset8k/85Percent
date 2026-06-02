/**
 * SSR routes — Premier League only.
 *
 * Three independent solvency tests stored in three tables. The data lives at
 * club+season grain (or club+season+month for working capital). Every route
 * runs the engine to return the live pass/fail result alongside the stored
 * inputs, so the UI never has to recompute.
 *
 * Guards:
 *   - authMiddleware attaches request.clubId (defence-in-depth on top of RLS)
 *   - PL-only middleware short-circuits with 404 for Championship clubs so we
 *     don't leak the existence of SSR routes to non-PL tenants
 *   - Permission guard: workspace admins can mutate; all members can read
 */

import { randomUUID } from 'crypto'
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { z } from 'zod'
import { supabase } from '../lib/supabase.js'
import { authMiddleware } from '../middleware/auth.js'
import { hasPermission } from '../middleware/permissions.js'
import type { Permissions } from '../middleware/permissions.js'
import { writeAuditLog } from '../lib/audit.js'
import {
  evaluateWorkingCapital,
  evaluateLiquidity,
  evaluateEquity,
  type WorkingCapitalMonthInput,
} from '@headroom/engine'

// SSR (working capital / liquidity / equity) is club-level financial compliance
// data — entry is gated behind the workspace-admin grant, consistent with the
// other financial settings (revenue, allowance ratio, base currency).
function canMutateSsr(permissions: Permissions): boolean {
  return hasPermission(permissions, 'isWorkspaceAdmin')
}

// PL-only guard. Returns true if the club is on the premier-league config.
// Looks up clubs.league_id; if anything unexpected, returns false (closed).
async function isPremierLeagueClub(clubId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('clubs')
    .select('league_id')
    .eq('id', clubId)
    .maybeSingle()
  if (error || !data) return false
  return data.league_id === 'premier-league'
}

/** Short-circuit a non-PL request with 404 (no info leak). */
async function ensurePremierLeague(request: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  const ok = await isPremierLeagueClub(request.clubId)
  if (!ok) {
    reply.status(404).send({ error: 'Not found' })
    return false
  }
  return true
}

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------
const SEASON_REGEX = /^\d{4}-\d{2}$/
const YEAR_MONTH_REGEX = /^\d{4}-(0[1-9]|1[0-2])$/

const WorkingCapitalUpsertBody = z.object({
  season: z.string().regex(SEASON_REGEX),
  yearMonth: z.string().regex(YEAR_MONTH_REGEX, 'yearMonth must be YYYY-MM'),
  adjustedCashflowPence: z.number().int(),
  qualifyingFundsPence:  z.number().int().min(0),
})

const LiquidityUpsertBody = z.object({
  season: z.string().regex(SEASON_REGEX),
  liquidAssetsPence:      z.number().int().min(0),
  liquidLiabilitiesPence: z.number().int().min(0),
  squadMarketValuePence:  z.number().int().min(0),
})

const EquityUpsertBody = z.object({
  season: z.string().regex(SEASON_REGEX),
  totalLiabilitiesPence: z.number().int().min(0),
  adjustedAssetsPence:   z.number().int().min(0),
})

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
export async function ssrRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authMiddleware)

  // ---- Working Capital ----------------------------------------------------

  // GET /ssr/working-capital?season=2026-27
  app.get('/ssr/working-capital', async (request, reply) => {
    if (!(await ensurePremierLeague(request, reply))) return

    const season = (request.query as Record<string, string>)['season'] ?? '2026-27'
    if (!SEASON_REGEX.test(season)) {
      return reply.status(400).send({ error: 'Invalid season format' })
    }

    try {
      const { data, error } = await supabase
        .from('ssr_working_capital')
        .select('id, year_month, adjusted_cashflow, qualifying_funds, created_at, updated_at')
        .eq('club_id', request.clubId)
        .eq('season', season)
        .order('year_month', { ascending: true })

      if (error) throw error

      const months: WorkingCapitalMonthInput[] = (data ?? []).map((row) => ({
        yearMonth: String(row.year_month),
        adjustedCashflowPence: Number(row.adjusted_cashflow),
        qualifyingFundsPence:  Number(row.qualifying_funds),
      }))
      const evaluation = evaluateWorkingCapital(months)

      return reply.send({
        season,
        rows: (data ?? []).map((row) => ({
          id: row.id,
          yearMonth: row.year_month,
          adjustedCashflowPence: Number(row.adjusted_cashflow),
          qualifyingFundsPence:  Number(row.qualifying_funds),
          updatedAt: row.updated_at,
        })),
        evaluation,
      })
    } catch (err) {
      request.log.error({ err }, 'GET /ssr/working-capital failed')
      return reply.status(500).send({ error: 'Failed to load working capital' })
    }
  })

  // PUT /ssr/working-capital — upsert one month
  app.put('/ssr/working-capital', async (request, reply) => {
    if (!(await ensurePremierLeague(request, reply))) return
    if (!canMutateSsr(request.permissions)) return reply.status(403).send({ error: 'Insufficient permissions' })

    const parsed = WorkingCapitalUpsertBody.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() })

    const { season, yearMonth, adjustedCashflowPence, qualifyingFundsPence } = parsed.data
    try {
      const { data: existing } = await supabase
        .from('ssr_working_capital')
        .select('id')
        .eq('club_id', request.clubId)
        .eq('season', season)
        .eq('year_month', yearMonth)
        .maybeSingle()

      const nowISO = new Date().toISOString()
      let recordId: string

      if (existing) {
        const { error: upErr } = await supabase
          .from('ssr_working_capital')
          .update({
            adjusted_cashflow: adjustedCashflowPence,
            qualifying_funds:  qualifyingFundsPence,
            updated_at: nowISO,
          })
          .eq('id', existing.id)
        if (upErr) throw upErr
        recordId = existing.id
      } else {
        recordId = randomUUID()
        const { error: insErr } = await supabase.from('ssr_working_capital').insert({
          id: recordId,
          club_id: request.clubId,
          season,
          year_month: yearMonth,
          adjusted_cashflow: adjustedCashflowPence,
          qualifying_funds:  qualifyingFundsPence,
          created_at: nowISO,
          updated_at: nowISO,
        })
        if (insErr) throw insErr
      }

      await writeAuditLog(request, 'ssr_working_capital', recordId, existing ? 'update' : 'create', parsed.data)

      return reply.send({ success: true, id: recordId })
    } catch (err) {
      request.log.error({ err }, 'PUT /ssr/working-capital failed')
      return reply.status(500).send({ error: 'Failed to save working capital row' })
    }
  })

  // ---- Liquidity ----------------------------------------------------------

  // GET /ssr/liquidity?season=2026-27
  app.get('/ssr/liquidity', async (request, reply) => {
    if (!(await ensurePremierLeague(request, reply))) return

    const season = (request.query as Record<string, string>)['season'] ?? '2026-27'
    if (!SEASON_REGEX.test(season)) return reply.status(400).send({ error: 'Invalid season format' })

    try {
      const { data, error } = await supabase
        .from('ssr_liquidity')
        .select('id, liquid_assets, liquid_liabilities, squad_market_value, updated_at')
        .eq('club_id', request.clubId)
        .eq('season', season)
        .maybeSingle()
      if (error) throw error

      if (!data) {
        return reply.send({ season, row: null, evaluation: null })
      }

      const evaluation = evaluateLiquidity({
        liquidAssetsPence:      Number(data.liquid_assets),
        liquidLiabilitiesPence: Number(data.liquid_liabilities),
        squadMarketValuePence:  Number(data.squad_market_value),
      })

      return reply.send({
        season,
        row: {
          id: data.id,
          liquidAssetsPence:      Number(data.liquid_assets),
          liquidLiabilitiesPence: Number(data.liquid_liabilities),
          squadMarketValuePence:  Number(data.squad_market_value),
          updatedAt: data.updated_at,
        },
        evaluation,
      })
    } catch (err) {
      request.log.error({ err }, 'GET /ssr/liquidity failed')
      return reply.status(500).send({ error: 'Failed to load liquidity' })
    }
  })

  app.put('/ssr/liquidity', async (request, reply) => {
    if (!(await ensurePremierLeague(request, reply))) return
    if (!canMutateSsr(request.permissions)) return reply.status(403).send({ error: 'Insufficient permissions' })

    const parsed = LiquidityUpsertBody.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() })

    const { season, liquidAssetsPence, liquidLiabilitiesPence, squadMarketValuePence } = parsed.data
    try {
      const { data: existing } = await supabase
        .from('ssr_liquidity')
        .select('id')
        .eq('club_id', request.clubId)
        .eq('season', season)
        .maybeSingle()

      const nowISO = new Date().toISOString()
      let recordId: string

      if (existing) {
        const { error: upErr } = await supabase
          .from('ssr_liquidity')
          .update({
            liquid_assets: liquidAssetsPence,
            liquid_liabilities: liquidLiabilitiesPence,
            squad_market_value: squadMarketValuePence,
            updated_at: nowISO,
          })
          .eq('id', existing.id)
        if (upErr) throw upErr
        recordId = existing.id
      } else {
        recordId = randomUUID()
        const { error: insErr } = await supabase.from('ssr_liquidity').insert({
          id: recordId,
          club_id: request.clubId,
          season,
          liquid_assets: liquidAssetsPence,
          liquid_liabilities: liquidLiabilitiesPence,
          squad_market_value: squadMarketValuePence,
          created_at: nowISO,
          updated_at: nowISO,
        })
        if (insErr) throw insErr
      }

      await writeAuditLog(request, 'ssr_liquidity', recordId, existing ? 'update' : 'create', parsed.data)
      return reply.send({ success: true, id: recordId })
    } catch (err) {
      request.log.error({ err }, 'PUT /ssr/liquidity failed')
      return reply.status(500).send({ error: 'Failed to save liquidity' })
    }
  })

  // ---- Equity -------------------------------------------------------------

  app.get('/ssr/equity', async (request, reply) => {
    if (!(await ensurePremierLeague(request, reply))) return

    const season = (request.query as Record<string, string>)['season'] ?? '2026-27'
    if (!SEASON_REGEX.test(season)) return reply.status(400).send({ error: 'Invalid season format' })

    try {
      const { data, error } = await supabase
        .from('ssr_equity')
        .select('id, total_liabilities, adjusted_assets, updated_at')
        .eq('club_id', request.clubId)
        .eq('season', season)
        .maybeSingle()
      if (error) throw error

      if (!data) {
        return reply.send({ season, row: null, evaluation: null })
      }

      const evaluation = evaluateEquity({
        totalLiabilitiesPence: Number(data.total_liabilities),
        adjustedAssetsPence:   Number(data.adjusted_assets),
        season,
      })

      return reply.send({
        season,
        row: {
          id: data.id,
          totalLiabilitiesPence: Number(data.total_liabilities),
          adjustedAssetsPence:   Number(data.adjusted_assets),
          updatedAt: data.updated_at,
        },
        evaluation,
      })
    } catch (err) {
      request.log.error({ err }, 'GET /ssr/equity failed')
      return reply.status(500).send({ error: 'Failed to load equity' })
    }
  })

  app.put('/ssr/equity', async (request, reply) => {
    if (!(await ensurePremierLeague(request, reply))) return
    if (!canMutateSsr(request.permissions)) return reply.status(403).send({ error: 'Insufficient permissions' })

    const parsed = EquityUpsertBody.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() })

    const { season, totalLiabilitiesPence, adjustedAssetsPence } = parsed.data
    try {
      const { data: existing } = await supabase
        .from('ssr_equity')
        .select('id')
        .eq('club_id', request.clubId)
        .eq('season', season)
        .maybeSingle()

      const nowISO = new Date().toISOString()
      let recordId: string

      if (existing) {
        const { error: upErr } = await supabase
          .from('ssr_equity')
          .update({
            total_liabilities: totalLiabilitiesPence,
            adjusted_assets:   adjustedAssetsPence,
            updated_at: nowISO,
          })
          .eq('id', existing.id)
        if (upErr) throw upErr
        recordId = existing.id
      } else {
        recordId = randomUUID()
        const { error: insErr } = await supabase.from('ssr_equity').insert({
          id: recordId,
          club_id: request.clubId,
          season,
          total_liabilities: totalLiabilitiesPence,
          adjusted_assets:   adjustedAssetsPence,
          created_at: nowISO,
          updated_at: nowISO,
        })
        if (insErr) throw insErr
      }

      await writeAuditLog(request, 'ssr_equity', recordId, existing ? 'update' : 'create', parsed.data)
      return reply.send({ success: true, id: recordId })
    } catch (err) {
      request.log.error({ err }, 'PUT /ssr/equity failed')
      return reply.status(500).send({ error: 'Failed to save equity' })
    }
  })
}
