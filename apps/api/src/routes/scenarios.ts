/**
 * Scenario routes — MVP 2.0
 *
 * A scenario is a named, ordered list of actions (buy / sell / loan_in / loan_out / release).
 * Replaces the flat MVP 1.0 `simulations` table (which was dropped in Phase 1).
 *
 * Endpoints:
 *   POST   /scenarios           — create scenario + actions in a best-effort transaction
 *   GET    /scenarios           — list paginated, action counts joined
 *   GET    /scenarios/:id       — full scenario with actions
 *   PATCH  /scenarios/:id       — rename or toggle is_included
 *   DELETE /scenarios/:id       — hard delete (cascades to actions via FK)
 *
 * Every endpoint enforces club isolation at the application layer via the
 * authMiddleware-attached `request.clubId`. RLS is defence-in-depth (Phase 1).
 */

import { randomUUID } from 'crypto'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { supabase } from '../lib/supabase.js'
import { authMiddleware } from '../middleware/auth.js'
import { requirePermission, hasPermission } from '../middleware/permissions.js'
import { writeAuditLog } from '../lib/audit.js'

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const ScenarioActionPayload = z.object({
  actionType: z.enum(['buy', 'sell', 'loan_in', 'loan_out', 'release']),
  // Optional FK to an existing player for sell / release / loan_out
  playerId: z.string().uuid().nullable().optional(),
  // Free-form payload — the engine's ScenarioActionInput shape, in pence.
  // We re-validate this in the engine layer; here we just check it's an object.
  payload: z.record(z.unknown()),
})

const CreateScenarioBody = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100, 'Name too long'),
  season: z.string().regex(/^\d{4}-\d{2}$/, 'Season must be YYYY-YY').default('2026-27'),
  isIncluded: z.boolean().default(false),
  actions: z.array(ScenarioActionPayload).max(50, 'Too many actions in one scenario'),
})

const UpdateScenarioBody = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  isIncluded: z.boolean().optional(),
}).refine((v) => v.name !== undefined || v.isIncluded !== undefined, {
  message: 'At least one field must be provided',
})

// ---------------------------------------------------------------------------
// Response shaping
// ---------------------------------------------------------------------------
function shapeScenario(row: Record<string, unknown>, actionCount?: number) {
  const user = row['user'] as { full_name: string; email: string } | null | undefined
  return {
    id: String(row['id']),
    clubId: String(row['club_id']),
    createdBy: String(row['created_by']),
    season: String(row['season']),
    name: String(row['name']),
    isIncluded: Boolean(row['is_included']),
    createdAt: String(row['created_at']),
    updatedAt: String(row['updated_at']),
    user: user ? { fullName: user.full_name, email: user.email } : undefined,
    ...(actionCount !== undefined ? { actionCount } : {}),
  }
}

function shapeAction(row: Record<string, unknown>) {
  return {
    id: String(row['id']),
    scenarioId: String(row['scenario_id']),
    actionType: String(row['action_type']),
    payload: row['payload'],
    playerId: (row['player_id'] as string | null) ?? null,
    orderIndex: Number(row['order_index']),
    createdAt: String(row['created_at']),
  }
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------
export async function scenarioRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authMiddleware)

  // -------------------------------------------------------------------- POST /scenarios
  app.post('/scenarios', { preHandler: requirePermission('canEditScenarios') }, async (request, reply) => {
    const parsed = CreateScenarioBody.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() })
    }

    const { name, season, isIncluded, actions } = parsed.data

    try {
      // Validate any player FKs belong to this club (defence in depth — RLS
      // would also block this, but a clear 400 is better than an opaque FK error)
      const playerIds = actions
        .map((a) => a.playerId)
        .filter((id): id is string => typeof id === 'string')

      if (playerIds.length > 0) {
        const { data: validPlayers, error: playerErr } = await supabase
          .from('players')
          .select('id')
          .eq('club_id', request.clubId)
          .in('id', playerIds)
        if (playerErr) throw playerErr
        const validIds = new Set((validPlayers ?? []).map((p) => p.id as string))
        const invalid = playerIds.filter((id) => !validIds.has(id))
        if (invalid.length > 0) {
          return reply.status(400).send({
            error: `Unknown players referenced by scenario actions: ${invalid.join(', ')}`,
          })
        }
      }

      const nowISO = new Date().toISOString()
      const scenarioId = randomUUID()

      const { error: scenarioErr } = await supabase.from('scenarios').insert({
        id: scenarioId,
        club_id: request.clubId,
        created_by: request.userId,
        season,
        name,
        is_included: isIncluded,
        created_at: nowISO,
        updated_at: nowISO,
      })
      if (scenarioErr) throw scenarioErr

      if (actions.length > 0) {
        const actionRows = actions.map((a, idx) => ({
          id: randomUUID(),
          scenario_id: scenarioId,
          action_type: a.actionType,
          payload: a.payload,
          player_id: a.playerId ?? null,
          order_index: idx,
          created_at: nowISO,
        }))

        const { error: actionsErr } = await supabase.from('scenario_actions').insert(actionRows)
        if (actionsErr) {
          // Roll back the parent scenario to avoid an orphan
          await supabase.from('scenarios').delete().eq('id', scenarioId).eq('club_id', request.clubId)
          throw actionsErr
        }
      }

      await writeAuditLog(request, 'scenarios', scenarioId, 'create', { name, actions: actions.length })

      return reply.status(201).send({ id: scenarioId, name, isIncluded, actionCount: actions.length })
    } catch (err) {
      request.log.error({ err }, 'POST /scenarios failed')
      return reply.status(500).send({ error: 'Failed to create scenario' })
    }
  })

  // -------------------------------------------------------------------- GET /scenarios
  app.get('/scenarios', async (request, reply) => {
    const query = request.query as Record<string, string>
    const rawPage = parseInt(query['page'] ?? '1', 10)
    const rawLimit = parseInt(query['limit'] ?? '50', 10)
    const page = Number.isFinite(rawPage) && rawPage > 0 ? rawPage : 1
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 100) : 50
    const skip = (page - 1) * limit

    try {
      const { data: scenarios, error } = await supabase
        .from('scenarios')
        .select('id, club_id, created_by, season, name, is_included, created_at, updated_at, user:users!created_by(full_name, email)')
        .eq('club_id', request.clubId)
        .order('created_at', { ascending: false })
        .range(skip, skip + limit - 1)
      if (error) throw error

      const ids = (scenarios ?? []).map((s) => s.id as string)
      const countByScenario = new Map<string, number>()

      if (ids.length > 0) {
        const { data: actions, error: actionsErr } = await supabase
          .from('scenario_actions')
          .select('scenario_id')
          .in('scenario_id', ids)
        if (actionsErr) throw actionsErr
        for (const a of actions ?? []) {
          const sid = a.scenario_id as string
          countByScenario.set(sid, (countByScenario.get(sid) ?? 0) + 1)
        }
      }

      const { count } = await supabase
        .from('scenarios')
        .select('*', { count: 'exact', head: true })
        .eq('club_id', request.clubId)

      return reply.send({
        scenarios: (scenarios ?? []).map((s) =>
          shapeScenario(s as Record<string, unknown>, countByScenario.get(s.id as string) ?? 0)
        ),
        total: count ?? 0,
        page,
        limit,
      })
    } catch (err) {
      request.log.error({ err }, 'GET /scenarios failed')
      return reply.status(500).send({ error: 'Failed to load scenarios' })
    }
  })

  // -------------------------------------------------------------------- GET /scenarios/:id
  app.get('/scenarios/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    try {
      const { data: scenario, error } = await supabase
        .from('scenarios')
        .select('id, club_id, created_by, season, name, is_included, created_at, updated_at, user:users!created_by(full_name, email)')
        .eq('id', id)
        .eq('club_id', request.clubId)
        .maybeSingle()
      if (error) throw error
      if (!scenario) return reply.status(404).send({ error: 'Scenario not found' })

      const { data: actions, error: actionsErr } = await supabase
        .from('scenario_actions')
        .select('id, scenario_id, action_type, payload, player_id, order_index, created_at')
        .eq('scenario_id', id)
        .order('order_index', { ascending: true })
      if (actionsErr) throw actionsErr

      return reply.send({
        ...shapeScenario(scenario as Record<string, unknown>),
        actions: (actions ?? []).map((a) => shapeAction(a as Record<string, unknown>)),
      })
    } catch (err) {
      request.log.error({ err }, 'GET /scenarios/:id failed')
      return reply.status(500).send({ error: 'Failed to load scenario' })
    }
  })

  // -------------------------------------------------------------------- PATCH /scenarios/:id
  // Any modification (rename or toggling is_included, which affects the club-wide
  // Active Baseline) requires the canEditScenarios grant.
  app.patch('/scenarios/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const parsed = UpdateScenarioBody.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() })
    }

    if (!hasPermission(request.permissions, 'canEditScenarios')) {
      return reply.status(403).send({ error: 'Insufficient permissions' })
    }

    try {
      const { data: existing, error: findErr } = await supabase
        .from('scenarios')
        .select('id, name, is_included')
        .eq('id', id)
        .eq('club_id', request.clubId)
        .maybeSingle()
      if (findErr) throw findErr
      if (!existing) return reply.status(404).send({ error: 'Scenario not found' })

      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() }
      if (parsed.data.name       !== undefined) patch['name']        = parsed.data.name
      if (parsed.data.isIncluded !== undefined) patch['is_included'] = parsed.data.isIncluded

      const { error: updateErr } = await supabase
        .from('scenarios')
        .update(patch)
        .eq('id', id)
        .eq('club_id', request.clubId)
      if (updateErr) throw updateErr

      await writeAuditLog(request, 'scenarios', id, 'update', parsed.data, existing)

      return reply.send({
        success: true,
        ...(parsed.data.name       !== undefined ? { name: parsed.data.name } : {}),
        ...(parsed.data.isIncluded !== undefined ? { isIncluded: parsed.data.isIncluded } : {}),
      })
    } catch (err) {
      request.log.error({ err }, 'PATCH /scenarios/:id failed')
      return reply.status(500).send({ error: 'Failed to update scenario' })
    }
  })

  // -------------------------------------------------------------------- DELETE /scenarios/:id
  app.delete('/scenarios/:id', { preHandler: requirePermission('canEditScenarios') }, async (request, reply) => {
    const { id } = request.params as { id: string }

    try {
      const { data: existing, error: findErr } = await supabase
        .from('scenarios')
        .select('id, name')
        .eq('id', id)
        .eq('club_id', request.clubId)
        .maybeSingle()
      if (findErr) throw findErr
      if (!existing) return reply.status(404).send({ error: 'Scenario not found' })

      // FK cascade handles scenario_actions automatically
      const { error: delErr } = await supabase
        .from('scenarios')
        .delete()
        .eq('id', id)
        .eq('club_id', request.clubId)
      if (delErr) throw delErr

      await writeAuditLog(request, 'scenarios', id, 'delete', undefined, existing)

      return reply.send({ success: true })
    } catch (err) {
      request.log.error({ err }, 'DELETE /scenarios/:id failed')
      return reply.status(500).send({ error: 'Failed to delete scenario' })
    }
  })
}
