import { randomUUID } from 'crypto'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { supabase } from '../lib/supabase.js'
import { authMiddleware } from '../middleware/auth.js'
import { LEAGUE_CONFIGS } from '@headroom/shared'
import { calculateSquadCosts, type ContractInput } from '@headroom/engine'

const UpdateFinancialsBody = z.object({
  season: z.string().regex(/^\d{4}-\d{2}$/),
  footballRelatedRevenuePounds: z.number().int().positive(),
  currentAllowanceRatio: z.number().min(0).max(1),
  ownerEquityUsedCurrentSeasonPounds: z.number().int().min(0).optional(),
  ownerEquityUsedThreeYearPounds: z.number().int().min(0).optional(),
})

// Sum active contracts for a club into a single squad-cost pence total.
// Pure engine call — DB I/O is here, not in @headroom/engine.
async function deriveSquadCostsForClub(clubId: string): Promise<{
  totalPence: number
  contractCount: number
}> {
  const { data: contracts, error } = await supabase
    .from('contracts')
    .select('player_id, transfer_fee, annual_wage, agent_fee, contract_length_years')
    .eq('club_id', clubId)
    .eq('is_active', true)

  if (error) throw error

  const inputs: ContractInput[] = (contracts ?? []).map((c) => ({
    playerId: String(c.player_id),
    transferFeePence: Number(c.transfer_fee),
    annualWagePence:  Number(c.annual_wage),
    agentFeePence:    Number(c.agent_fee),
    contractLengthYears: Number(c.contract_length_years),
  }))

  const { totalSquadCostsPence } = calculateSquadCosts(inputs)
  return { totalPence: totalSquadCostsPence, contractCount: inputs.length }
}

export async function clubRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authMiddleware)

  app.get('/club', async (request, reply) => {
    try {
      const { data: club, error } = await supabase
        .from('clubs')
        .select('id, name, short_name, league_id')
        .eq('id', request.clubId)
        .maybeSingle()

      if (error) throw error
      if (!club) return reply.status(404).send({ error: 'Club not found' })

      return reply.send({
        id: club.id,
        name: club.name,
        shortName: club.short_name,
        leagueId: club.league_id,
      })
    } catch (err) {
      request.log.error({ err }, 'GET /club failed')
      return reply.status(500).send({ error: 'Failed to load club' })
    }
  })

  app.get('/club/financials', async (request, reply) => {
    const season = (request.query as Record<string, string>)['season'] ?? '2026-27'
    try {
      const { data: f, error } = await supabase
        .from('club_financials')
        .select('*')
        .eq('club_id', request.clubId)
        .eq('season', season)
        .maybeSingle()

      if (error) throw error
      if (!f) return reply.status(404).send({ error: 'No financials found for this season' })

      // MVP 2.0: squad costs are derived from the active roster, NOT stored in
      // club_financials anymore. Compute live from contracts.
      const derived = await deriveSquadCostsForClub(String(request.clubId))

      return reply.send({
        id: f.id,
        clubId: f.club_id,
        season: f.season,
        footballRelatedRevenue: Number(f.football_related_revenue),
        currentSquadCosts: derived.totalPence,
        contractCount: derived.contractCount,
        currentAllowanceRatio: Number(f.current_allowance_ratio),
        ownerEquityUsed1yr: f.owner_equity_used_1yr != null ? Number(f.owner_equity_used_1yr) : null,
        ownerEquityUsed3yr: f.owner_equity_used_3yr != null ? Number(f.owner_equity_used_3yr) : null,
      })
    } catch (err) {
      request.log.error({ err }, 'GET /club/financials failed')
      return reply.status(500).send({ error: 'Failed to load financials' })
    }
  })

  app.put('/club/financials', async (request, reply) => {
    if (!['cfo', 'admin', 'finance_analyst'].includes(request.userRole)) {
      return reply.status(403).send({ error: 'Insufficient permissions' })
    }

    const parsed = UpdateFinancialsBody.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() })
    }

    const {
      season,
      footballRelatedRevenuePounds,
      currentAllowanceRatio,
      ownerEquityUsedCurrentSeasonPounds,
      ownerEquityUsedThreeYearPounds,
    } = parsed.data

    try {
      const financialsData = {
        club_id: request.clubId,
        season,
        football_related_revenue: footballRelatedRevenuePounds * 100,
        current_allowance_ratio: currentAllowanceRatio,
        owner_equity_used_1yr: ownerEquityUsedCurrentSeasonPounds != null
          ? ownerEquityUsedCurrentSeasonPounds * 100
          : null,
        owner_equity_used_3yr: ownerEquityUsedThreeYearPounds != null
          ? ownerEquityUsedThreeYearPounds * 100
          : null,
        updated_at: new Date().toISOString(),
      }

      // The id column has no DB-level default (Prisma managed it), so we
      // SELECT first and UPDATE or INSERT explicitly to avoid a NOT NULL error.
      const { data: existing } = await supabase
        .from('club_financials')
        .select('id')
        .eq('club_id', request.clubId)
        .eq('season', season)
        .maybeSingle()

      let recordId: string

      if (existing) {
        const { error } = await supabase
          .from('club_financials')
          .update(financialsData)
          .eq('id', existing.id)
        if (error) throw error
        recordId = existing.id
      } else {
        const newId = randomUUID()
        const { error } = await supabase
          .from('club_financials')
          .insert({ id: newId, ...financialsData })
        if (error) throw error
        recordId = newId
      }

      const { error: auditErr } = await supabase.from('audit_logs').insert({
        id: randomUUID(),
        user_id: request.userId,
        club_id: request.clubId,
        table_name: 'club_financials',
        record_id: recordId,
        action: 'update',
        new_value: parsed.data,
      })
      if (auditErr) request.log.warn({ err: auditErr }, 'audit_logs insert failed (non-fatal)')

      return reply.send({ success: true, id: recordId })
    } catch (err) {
      request.log.error({ err }, 'PUT /club/financials failed')
      return reply.status(500).send({ error: 'Failed to save financials' })
    }
  })

  app.get('/club/league-config', async (request, reply) => {
    try {
      const { data: club, error } = await supabase
        .from('clubs')
        .select('league_id')
        .eq('id', request.clubId)
        .maybeSingle()

      if (error) throw error
      if (!club) return reply.status(404).send({ error: 'Club not found' })

      const config = LEAGUE_CONFIGS[club.league_id]
      if (!config) return reply.status(404).send({ error: 'Unknown league configuration' })

      return reply.send(config)
    } catch (err) {
      request.log.error({ err }, 'GET /club/league-config failed')
      return reply.status(500).send({ error: 'Failed to load league config' })
    }
  })
}
