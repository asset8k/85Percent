import { randomUUID } from 'crypto'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { supabase } from '../lib/supabase.js'
import { authMiddleware } from '../middleware/auth.js'
import { calculateSCR } from '@headroom/engine'
import { LEAGUE_CONFIGS } from '@headroom/shared'
import type { ClubFinancials } from '@headroom/shared'

const CreateSimulationBody = z.object({
  transactionType: z.enum(['buy', 'sell', 'loan_in', 'loan_out']).default('buy'),
  season: z.string().regex(/^\d{4}-\d{2}$/).default('2026-27'),
  label: z.string().max(100).optional(),
  // Overrides for stacked-baseline simulations: when other sims are included in the
  // active baseline, the simulator passes both adjusted squad costs and adjusted revenue
  // (excluding owner equity — engine applies that separately).
  baselineSquadCostsPence: z.number().int().min(0).optional(),
  baselineRevenuePence: z.number().int().min(0).optional(),

  // BUY & LOAN_IN
  transferFee: z.number().int().min(0).default(0),
  contractLengthYears: z.number().min(0.5).max(10).default(1),
  annualWage: z.number().int().min(0).default(0),
  agentFee: z.number().int().min(0).default(0),

  // SELL
  saleProceeds: z.number().int().min(0).optional(),
  playerBookValue: z.number().int().min(0).optional(),
  annualWageRelief: z.number().int().min(0).optional(),
  annualAmortisationRelief: z.number().int().min(0).optional(),

  // LOAN_OUT
  loanFeeReceived: z.number().int().min(0).optional(),
  loanLengthYears: z.number().min(0.5).max(10).optional(),
  annualWageCovered: z.number().int().min(0).optional(),
})

const UpdateLabelBody = z.object({
  label: z.string().max(100),
})

const UpdateInclusionBody = z.object({
  isIncluded: z.boolean(),
})

function mapSim(row: Record<string, unknown>) {
  const user = row['user'] as { full_name: string; email: string } | null
  return {
    id: row['id'],
    clubId: row['club_id'],
    createdBy: row['created_by'],
    season: row['season'],
    label: row['label'],
    transferInput: row['transfer_input'],
    isIncluded: row['is_included'] as boolean,
    createdAt: row['created_at'],
    user: user ? { fullName: user.full_name, email: user.email } : undefined,
  }
}

export async function simulationRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authMiddleware)

  app.post('/simulations', async (request, reply) => {
    const parsed = CreateSimulationBody.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() })
    }

    const {
      transactionType, season, label, baselineSquadCostsPence, baselineRevenuePence,
      transferFee, contractLengthYears, annualWage, agentFee,
      saleProceeds, playerBookValue, annualWageRelief, annualAmortisationRelief,
      loanFeeReceived, loanLengthYears, annualWageCovered,
    } = parsed.data

    try {
      const { data: club, error: clubErr } = await supabase
        .from('clubs')
        .select('league_id')
        .eq('id', request.clubId)
        .maybeSingle()

      if (clubErr) throw clubErr
      if (!club) return reply.status(404).send({ error: 'Club not found' })

      const leagueConfig = LEAGUE_CONFIGS[club.league_id]
      if (!leagueConfig) return reply.status(400).send({ error: 'Unknown league configuration' })

      const { data: dbF, error: finErr } = await supabase
        .from('club_financials')
        .select('*')
        .eq('club_id', request.clubId)
        .eq('season', season)
        .maybeSingle()

      if (finErr) throw finErr
      if (!dbF) {
        return reply.status(404).send({ error: `No financials found for season ${season}. Please complete club setup first.` })
      }

      const clubFinancials: ClubFinancials = {
        clubId: request.clubId,
        season,
        leagueConfig,
        // baselineRevenuePence overrides the DB value when stacking sims with revenue-side
        // impacts (sells, loan-outs) so the engine's "current" reflects the active baseline.
        footballRelatedRevenue: baselineRevenuePence ?? Number(dbF.football_related_revenue),
        currentSquadCosts: baselineSquadCostsPence ?? Number(dbF.current_squad_costs),
        currentAllowanceRatio: Number(dbF.current_allowance_ratio),
        ownerEquityUsedThreeYear: dbF.owner_equity_used_3yr != null ? Number(dbF.owner_equity_used_3yr) : undefined,
        ownerEquityUsedCurrentSeason: dbF.owner_equity_used_1yr != null ? Number(dbF.owner_equity_used_1yr) : undefined,
      }

      const transferInput = {
        transactionType,
        transferFee, contractLengthYears, annualWage, agentFee,
        saleProceeds, playerBookValue, annualWageRelief, annualAmortisationRelief,
        loanFeeReceived, loanLengthYears, annualWageCovered,
      }
      // Engine runs once to return the live result to the simulator UI.
      // The result is NOT persisted — the detail view recomputes on demand from transferInput.
      const scrResult = calculateSCR(clubFinancials, transferInput, season)

      let finalLabel = label ?? null
      if (!finalLabel) {
        const { count } = await supabase
          .from('simulations')
          .select('*', { count: 'exact', head: true })
          .eq('club_id', request.clubId)
        finalLabel = `Transfer ${(count ?? 0) + 1}`
      }

      const newSimId = randomUUID()
      const { data: sim, error: createErr } = await supabase
        .from('simulations')
        .insert({
          id: newSimId,
          club_id: request.clubId,
          created_by: request.userId,
          season,
          label: finalLabel,
          transfer_input: transferInput,
          is_included: false,
        })
        .select('id')
        .single()

      if (createErr) throw createErr

      return reply.status(201).send({ id: sim.id, scrResult, label: finalLabel, isIncluded: false })
    } catch (err) {
      request.log.error({ err }, 'POST /simulations failed')
      return reply.status(500).send({ error: 'Failed to run simulation' })
    }
  })

  app.get('/simulations', async (request, reply) => {
    const query = request.query as Record<string, string>
    // Defensive parse — reject bogus input rather than silently returning an empty page
    // (Math.min(NaN, 100) === NaN, range(NaN, NaN) yields no rows).
    const rawPage = parseInt(query['page'] ?? '1', 10)
    const rawLimit = parseInt(query['limit'] ?? '20', 10)
    const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 100) : 20
    const skip = (page - 1) * limit

    try {
      const { data: simulations, error } = await supabase
        .from('simulations')
        .select('id, club_id, created_by, season, label, transfer_input, is_included, created_at, user:users!created_by(full_name, email)')
        .eq('club_id', request.clubId)
        .order('created_at', { ascending: false })
        .range(skip, skip + limit - 1)

      if (error) throw error

      const { count } = await supabase
        .from('simulations')
        .select('*', { count: 'exact', head: true })
        .eq('club_id', request.clubId)

      return reply.send({
        simulations: (simulations ?? []).map((s) => mapSim(s as Record<string, unknown>)),
        total: count ?? 0,
        page,
        limit,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : JSON.stringify(err)
      request.log.error({ err }, 'GET /simulations failed')
      return reply.status(500).send({ error: msg })
    }
  })

  app.get('/simulations/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    try {
      const { data: sim, error } = await supabase
        .from('simulations')
        .select('id, club_id, created_by, season, label, transfer_input, is_included, created_at, user:users!created_by(full_name, email)')
        .eq('id', id)
        .eq('club_id', request.clubId)
        .maybeSingle()

      if (error) throw error
      if (!sim) return reply.status(404).send({ error: 'Simulation not found' })

      return reply.send(mapSim(sim as Record<string, unknown>))
    } catch (err) {
      request.log.error({ err }, 'GET /simulations/:id failed')
      return reply.status(500).send({ error: 'Failed to load simulation' })
    }
  })

  app.patch('/simulations/:id/label', async (request, reply) => {
    const { id } = request.params as { id: string }
    const parsed = UpdateLabelBody.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() })
    }

    try {
      const { data: existing, error: findErr } = await supabase
        .from('simulations')
        .select('id')
        .eq('id', id)
        .eq('club_id', request.clubId)
        .maybeSingle()

      if (findErr) throw findErr
      if (!existing) return reply.status(404).send({ error: 'Simulation not found' })

      const { error: updateErr } = await supabase
        .from('simulations')
        .update({ label: parsed.data.label })
        .eq('id', id)
        .eq('club_id', request.clubId)

      if (updateErr) throw updateErr

      return reply.send({ success: true })
    } catch (err) {
      request.log.error({ err }, 'PATCH /simulations/:id/label failed')
      return reply.status(500).send({ error: 'Failed to update label' })
    }
  })

  app.patch('/simulations/:id/inclusion', async (request, reply) => {
    const { id } = request.params as { id: string }
    const parsed = UpdateInclusionBody.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() })
    }

    try {
      const { data: existing, error: findErr } = await supabase
        .from('simulations')
        .select('id')
        .eq('id', id)
        .eq('club_id', request.clubId)
        .maybeSingle()

      if (findErr) throw findErr
      if (!existing) return reply.status(404).send({ error: 'Simulation not found' })

      const { error: updateErr } = await supabase
        .from('simulations')
        .update({ is_included: parsed.data.isIncluded })
        .eq('id', id)
        .eq('club_id', request.clubId)

      if (updateErr) throw updateErr

      return reply.send({ success: true, isIncluded: parsed.data.isIncluded })
    } catch (err) {
      request.log.error({ err }, 'PATCH /simulations/:id/inclusion failed')
      return reply.status(500).send({ error: 'Failed to update inclusion' })
    }
  })

  app.delete('/simulations/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    try {
      const { data: existing, error: findErr } = await supabase
        .from('simulations')
        .select('id')
        .eq('id', id)
        .eq('club_id', request.clubId)
        .maybeSingle()

      if (findErr) throw findErr
      if (!existing) return reply.status(404).send({ error: 'Simulation not found' })

      const { error: deleteErr } = await supabase
        .from('simulations')
        .delete()
        .eq('id', id)
        .eq('club_id', request.clubId)

      if (deleteErr) throw deleteErr

      return reply.send({ success: true })
    } catch (err) {
      request.log.error({ err }, 'DELETE /simulations/:id failed')
      return reply.status(500).send({ error: 'Failed to delete simulation' })
    }
  })
}
