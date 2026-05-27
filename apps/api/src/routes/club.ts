import { randomUUID } from 'crypto'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { supabase } from '../lib/supabase.js'
import { authMiddleware } from '../middleware/auth.js'
import { LEAGUE_CONFIGS } from '@headroom/shared'

const UpdateFinancialsBody = z.object({
  season: z.string().regex(/^\d{4}-\d{2}$/),
  footballRelatedRevenuePounds: z.number().int().positive(),
  currentSquadCostsPounds: z.number().int().min(0),
  currentAllowanceRatio: z.number().min(0).max(1),
  ownerEquityUsedCurrentSeasonPounds: z.number().int().min(0).optional(),
  ownerEquityUsedThreeYearPounds: z.number().int().min(0).optional(),
})

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

      return reply.send({
        id: f.id,
        clubId: f.club_id,
        season: f.season,
        footballRelatedRevenue: Number(f.football_related_revenue),
        // MVP 2.0: column dropped — squad costs derive from contracts (Phase 3 Dashboard).
        // Returning 0 is a transitional stub for MVP 1.0 UI; will be removed when
        // the Dashboard replaces SimulatorPage's manual baseline.
        currentSquadCosts: 0,
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
      currentSquadCostsPounds,
      currentAllowanceRatio,
      ownerEquityUsedCurrentSeasonPounds,
      ownerEquityUsedThreeYearPounds,
    } = parsed.data

    // currentSquadCostsPounds is accepted from the form for backward compat but
    // not persisted — MVP 2.0 derives squad costs from contracts (Phase 3 Dashboard).
    void currentSquadCostsPounds

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
