import { randomUUID } from 'crypto'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { supabase } from '../lib/supabase.js'
import { authMiddleware } from '../middleware/auth.js'
import { requireRole } from '../middleware/roles.js'
import { writeAuditLog } from '../lib/audit.js'
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

  // GET /me — minimal "who am I" used by the frontend to drive RBAC affordances.
  // Returns the role + name pulled from public.users for the authenticated user.
  app.get('/me', async (request, reply) => {
    try {
      const { data, error } = await supabase
        .from('users')
        .select('id, role, full_name, email')
        .eq('id', request.userId)
        .maybeSingle()
      if (error) throw error
      if (!data) return reply.status(404).send({ error: 'User record not found' })
      return reply.send({
        id: data.id,
        role: data.role,
        fullName: data.full_name,
        email: data.email,
      })
    } catch (err) {
      request.log.error({ err }, 'GET /me failed')
      return reply.status(500).send({ error: 'Failed to load user' })
    }
  })

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

  // CFO + Admin only — per Phase 5 role matrix, club financial settings are
  // CFO-controlled. Finance Analyst handles data entry for roster + SSR but
  // not the season-level financial config.
  app.put('/club/financials', { preHandler: requireRole('cfo') }, async (request, reply) => {
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

      await writeAuditLog(request, 'club_financials', recordId, 'update', parsed.data)

      return reply.send({ success: true, id: recordId })
    } catch (err) {
      request.log.error({ err }, 'PUT /club/financials failed')
      return reply.status(500).send({ error: 'Failed to save financials' })
    }
  })

  // CFO + Admin only — switching the league changes the regulatory framework
  // and triggers SSR availability. Reserved for the CFO.
  app.patch('/club/league', { preHandler: requireRole('cfo') }, async (request, reply) => {
    const Body = z.object({
      leagueId: z.enum(['efl-championship', 'premier-league']),
    })
    const parsed = Body.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() })

    try {
      const { data: existing, error: findErr } = await supabase
        .from('clubs')
        .select('id, league_id')
        .eq('id', request.clubId)
        .maybeSingle()
      if (findErr) throw findErr
      if (!existing) return reply.status(404).send({ error: 'Club not found' })

      if (existing.league_id === parsed.data.leagueId) {
        return reply.send({ success: true, leagueId: existing.league_id })
      }

      const { error: updateErr } = await supabase
        .from('clubs')
        .update({ league_id: parsed.data.leagueId, updated_at: new Date().toISOString() })
        .eq('id', request.clubId)
      if (updateErr) throw updateErr

      await writeAuditLog(
        request,
        'clubs',
        request.clubId,
        'update',
        { leagueId: parsed.data.leagueId },
        { leagueId: existing.league_id },
      )

      return reply.send({ success: true, leagueId: parsed.data.leagueId })
    } catch (err) {
      request.log.error({ err }, 'PATCH /club/league failed')
      return reply.status(500).send({ error: 'Failed to switch league' })
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
