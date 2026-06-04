import { randomUUID } from 'crypto'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { supabase } from '../lib/supabase.js'
import { authMiddleware } from '../middleware/auth.js'
import { requirePermission } from '../middleware/permissions.js'
import { writeAuditLog } from '../lib/audit.js'
import { LEAGUE_CONFIGS, getDefaultCurrencyForLeague } from '@headroom/shared'
import { calculateSquadCosts, type ContractInput, type ManagerCostInput } from '@headroom/engine'

const UpdateFinancialsBody = z
  .object({
    season: z.string().regex(/^\d{4}-\d{2}$/),
    footballRelatedRevenuePounds: z.number().int().positive(),
    currentAllowanceRatio: z.number().min(0).max(1),
    ownerEquityUsedCurrentSeasonPounds: z.number().int().min(0).optional(),
    ownerEquityUsedThreeYearPounds: z.number().int().min(0).optional(),
    // Squad-costs source toggle. When 'manual', manualSquadCostsPounds is the
    // override used everywhere SCR math reads currentSquadCosts. When 'derived',
    // the value is computed live from active contracts and any supplied
    // manualSquadCostsPounds is preserved on the record (so toggling back is
    // non-destructive) but ignored.
    squadCostsMode: z.enum(['derived', 'manual']).default('derived'),
    manualSquadCostsPounds: z.number().int().min(0).max(2_000_000_000).optional(),
  })
  .refine(
    (b) => b.squadCostsMode !== 'manual' || (b.manualSquadCostsPounds != null && b.manualSquadCostsPounds >= 0),
    { message: 'Manual squad costs are required when mode = manual', path: ['manualSquadCostsPounds'] },
  )

// Resolve the active manager's current contract into a ManagerCostInput, or
// null when the club has no active manager / current contract. Pure DB I/O.
async function deriveActiveManager(clubId: string): Promise<ManagerCostInput | null> {
  const { data: mgr, error: mgrErr } = await supabase
    .from('managers')
    .select('id')
    .eq('club_id', clubId)
    .eq('is_active', true)
    .maybeSingle()
  if (mgrErr) throw mgrErr
  if (!mgr) return null

  const { data: mc, error: mcErr } = await supabase
    .from('manager_contracts')
    .select('compensation_fee, annual_wage, agent_fee, contract_length_years')
    .eq('manager_id', mgr.id)
    .eq('is_current', true)
    .maybeSingle()
  if (mcErr) throw mcErr
  if (!mc) return null

  return {
    managerId: String(mgr.id),
    compensationFeePence: Number(mc.compensation_fee),
    annualWagePence:      Number(mc.annual_wage),
    agentFeePence:        Number(mc.agent_fee),
    contractLengthYears:  Number(mc.contract_length_years),
  }
}

// Sum active contracts for a club into a single squad-cost pence total. The
// active Head Coach / Manager is included per SCR rules. Pure engine call —
// DB I/O is here, not in @headroom/engine.
async function deriveSquadCostsForClub(clubId: string): Promise<{
  totalPence: number
  contractCount: number
}> {
  const { data: contracts, error } = await supabase
    .from('contracts')
    .select('player_id, transfer_fee, carried_book_value, annual_wage, agent_fee, contract_length_years')
    .eq('club_id', clubId)
    .eq('is_active', true)

  if (error) throw error

  const inputs: ContractInput[] = (contracts ?? []).map((c) => ({
    playerId: String(c.player_id),
    transferFeePence: Number(c.transfer_fee),
    carriedBookValuePence: c.carried_book_value == null ? null : Number(c.carried_book_value),
    annualWagePence:  Number(c.annual_wage),
    agentFeePence:    Number(c.agent_fee),
    contractLengthYears: Number(c.contract_length_years),
  }))

  const manager = await deriveActiveManager(clubId)

  const { totalSquadCostsPence } = calculateSquadCosts(inputs, manager)
  return { totalPence: totalSquadCostsPence, contractCount: inputs.length }
}

export async function clubRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authMiddleware)

  // GET /me — minimal "who am I" used by the frontend to drive permission
  // affordances. Returns the explicit permission grants + title + name pulled
  // from public.users for the authenticated user.
  app.get('/me', async (request, reply) => {
    try {
      const { data, error } = await supabase
        .from('users')
        .select('id, title, can_edit_roster, can_edit_scenarios, is_workspace_admin, full_name, email, is_totp_enabled, ai_balance_usd')
        .eq('id', request.userId)
        .maybeSingle()
      if (error) throw error
      if (!data) return reply.status(404).send({ error: 'User record not found' })
      return reply.send({
        id: data.id,
        title: (data.title as string | null) ?? null,
        canEditRoster: !!data.can_edit_roster,
        canEditScenarios: !!data.can_edit_scenarios,
        isWorkspaceAdmin: !!data.is_workspace_admin,
        fullName: data.full_name,
        email: data.email,
        isTotpEnabled: !!data.is_totp_enabled,
        // USD AI-credit balance (NUMERIC comes back as a string from PostgREST).
        aiBalanceUsd: data.ai_balance_usd != null ? Number(data.ai_balance_usd) : 0,
      })
    } catch (err) {
      request.log.error({ err }, 'GET /me failed')
      return reply.status(500).send({ error: 'Failed to load user' })
    }
  })

  // PATCH /me — update the caller's own profile (display name + email). Email
  // changes go through the Supabase Admin API so auth.users stays in sync with
  // public.users. Available to every authenticated user (own record only).
  app.patch('/me', async (request, reply) => {
    const Body = z
      .object({
        fullName: z.string().trim().min(1).max(120).optional(),
        email: z.string().trim().toLowerCase().email('Invalid email').optional(),
      })
      .refine((b) => b.fullName !== undefined || b.email !== undefined, {
        message: 'Nothing to update',
      })
    const parsed = Body.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() })
    const { fullName, email } = parsed.data

    try {
      if (email) {
        // Reject if another account already owns this email.
        const { data: clash } = await supabase
          .from('users')
          .select('id')
          .eq('email', email)
          .neq('id', request.userId)
          .maybeSingle()
        if (clash) return reply.status(409).send({ error: 'That email is already in use.' })

        const { error: authErr } = await supabase.auth.admin.updateUserById(String(request.userId), {
          email,
          email_confirm: true,
        })
        if (authErr) {
          request.log.error({ err: authErr }, 'PATCH /me: admin email update failed')
          return reply.status(500).send({ error: 'Failed to update email' })
        }
      }

      const patch: Record<string, unknown> = {}
      if (fullName !== undefined) patch['full_name'] = fullName
      if (email !== undefined) patch['email'] = email

      const { error } = await supabase.from('users').update(patch).eq('id', request.userId)
      if (error) throw error

      await writeAuditLog(request, 'users', String(request.userId), 'update', parsed.data)
      return reply.send({ success: true })
    } catch (err) {
      request.log.error({ err }, 'PATCH /me failed')
      return reply.status(500).send({ error: 'Failed to update profile' })
    }
  })

  app.get('/club', async (request, reply) => {
    try {
      const { data: club, error } = await supabase
        .from('clubs')
        .select('id, name, short_name, league_id, logo_url, base_currency')
        .eq('id', request.clubId)
        .maybeSingle()

      if (error) throw error
      if (!club) return reply.status(404).send({ error: 'Club not found' })

      return reply.send({
        id: club.id,
        name: club.name,
        shortName: club.short_name,
        leagueId: club.league_id,
        logoUrl: (club.logo_url as string | null) ?? null,
        baseCurrency: (club.base_currency as string | null) ?? 'GBP',
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

      // MVP 2.0: squad costs are normally derived from the active roster. The
      // 'manual' mode lets a CFO override the value entirely — useful when the
      // user wants to model arbitrary cost scenarios without rebuilding the
      // roster. Derived is always computed too, so the UI can show both.
      const derived = await deriveSquadCostsForClub(String(request.clubId))
      const mode: 'derived' | 'manual' = f.squad_costs_mode === 'manual' ? 'manual' : 'derived'
      const manualPence = f.manual_squad_costs != null ? Number(f.manual_squad_costs) : null
      const currentSquadCosts = mode === 'manual' && manualPence != null ? manualPence : derived.totalPence

      return reply.send({
        id: f.id,
        clubId: f.club_id,
        season: f.season,
        footballRelatedRevenue: Number(f.football_related_revenue),
        currentSquadCosts,
        contractCount: derived.contractCount,
        squadCostsMode: mode,
        derivedSquadCosts: derived.totalPence,
        manualSquadCosts: manualPence,
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
  app.put('/club/financials', { preHandler: requirePermission('isWorkspaceAdmin') }, async (request, reply) => {
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
      squadCostsMode,
      manualSquadCostsPounds,
    } = parsed.data

    try {
      // Preserve any previously-saved manual value when the user toggles back to
      // derived — that way switching modes is non-destructive and they can flip
      // between them without re-typing the override.
      const manualPence = manualSquadCostsPounds != null ? manualSquadCostsPounds * 100 : undefined

      const financialsData = {
        club_id: request.clubId,
        season,
        football_related_revenue: footballRelatedRevenuePounds * 100,
        squad_costs_mode: squadCostsMode,
        ...(manualPence != null ? { manual_squad_costs: manualPence } : {}),
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
  app.patch('/club/league', { preHandler: requirePermission('isWorkspaceAdmin') }, async (request, reply) => {
    const Body = z.object({
      leagueId: z.enum(['efl-championship', 'premier-league']),
    })
    const parsed = Body.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() })

    try {
      const { data: existing, error: findErr } = await supabase
        .from('clubs')
        .select('id, league_id, base_currency, currency_is_custom')
        .eq('id', request.clubId)
        .maybeSingle()
      if (findErr) throw findErr
      if (!existing) return reply.status(404).send({ error: 'Club not found' })

      if (existing.league_id === parsed.data.leagueId) {
        return reply.send({
          success: true,
          leagueId: existing.league_id,
          baseCurrency: (existing.base_currency as string | null) ?? 'GBP',
        })
      }

      // Re-derive the base currency from the new league UNLESS the CFO has
      // explicitly pinned a custom currency — then we leave it untouched.
      const nextCurrency = existing.currency_is_custom
        ? ((existing.base_currency as string | null) ?? 'GBP')
        : getDefaultCurrencyForLeague(parsed.data.leagueId)

      const { error: updateErr } = await supabase
        .from('clubs')
        .update({
          league_id: parsed.data.leagueId,
          base_currency: nextCurrency,
          updated_at: new Date().toISOString(),
        })
        .eq('id', request.clubId)
      if (updateErr) throw updateErr

      await writeAuditLog(
        request,
        'clubs',
        request.clubId,
        'update',
        { leagueId: parsed.data.leagueId, baseCurrency: nextCurrency },
        { leagueId: existing.league_id, baseCurrency: existing.base_currency },
      )

      return reply.send({ success: true, leagueId: parsed.data.leagueId, baseCurrency: nextCurrency })
    } catch (err) {
      request.log.error({ err }, 'PATCH /club/league failed')
      return reply.status(500).send({ error: 'Failed to switch league' })
    }
  })

  // CFO + Admin only — the base currency governs how every monetary figure is
  // displayed across the workspace. Setting it marks currency_is_custom so a
  // later league change won't silently re-derive it. NO financial records are
  // converted — the engine keeps running on the exact numbers entered.
  app.patch('/club/currency', { preHandler: requirePermission('isWorkspaceAdmin') }, async (request, reply) => {
    const Body = z.object({
      baseCurrency: z.enum(['GBP', 'EUR', 'USD']),
    })
    const parsed = Body.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() })

    try {
      const { data: existing, error: findErr } = await supabase
        .from('clubs')
        .select('id, base_currency')
        .eq('id', request.clubId)
        .maybeSingle()
      if (findErr) throw findErr
      if (!existing) return reply.status(404).send({ error: 'Club not found' })

      const { error: updateErr } = await supabase
        .from('clubs')
        .update({
          base_currency: parsed.data.baseCurrency,
          currency_is_custom: true,
          updated_at: new Date().toISOString(),
        })
        .eq('id', request.clubId)
      if (updateErr) throw updateErr

      await writeAuditLog(
        request,
        'clubs',
        request.clubId,
        'update',
        { baseCurrency: parsed.data.baseCurrency },
        { baseCurrency: existing.base_currency },
      )

      return reply.send({ success: true, baseCurrency: parsed.data.baseCurrency })
    } catch (err) {
      request.log.error({ err }, 'PATCH /club/currency failed')
      return reply.status(500).send({ error: 'Failed to update currency' })
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

  // DELETE /club — permanently delete the entire tenant workspace (CFO only).
  // High-friction: the caller must echo the club's exact name. Irreversible.
  // We delete every club-scoped table in child→parent order (no reliance on DB
  // cascade), then remove each member's Supabase auth account, then the club.
  app.delete('/club', { preHandler: requirePermission('isWorkspaceAdmin') }, async (request, reply) => {
    const Body = z.object({ confirmName: z.string().min(1) })
    const parsed = Body.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ error: 'Confirmation name is required' })

    const clubId = String(request.clubId)

    try {
      const { data: club, error: clubErr } = await supabase
        .from('clubs')
        .select('id, name')
        .eq('id', clubId)
        .maybeSingle()
      if (clubErr) throw clubErr
      if (!club) return reply.status(404).send({ error: 'Club not found' })

      // Case-insensitive — the UI shows the name for reference but must not block
      // deletion over capitalisation alone (e.g. "manchester city" vs the stored
      // "Manchester City"). The typed name is still required as a friction gate.
      if (parsed.data.confirmName.trim().toLowerCase() !== String(club.name).trim().toLowerCase()) {
        return reply.status(400).send({ error: "The name you typed doesn't match the organization name." })
      }

      // scenario_actions are keyed by scenario, not club — clear them via the
      // club's scenario ids before deleting the scenarios themselves.
      const { data: scenarioRows } = await supabase
        .from('scenarios')
        .select('id')
        .eq('club_id', clubId)
      const scenarioIds = (scenarioRows ?? []).map((s) => String(s.id))
      if (scenarioIds.length > 0) {
        const { error } = await supabase.from('scenario_actions').delete().in('scenario_id', scenarioIds)
        if (error) throw error
      }

      // Child→parent deletion across every club-scoped table.
      const clubScoped = [
        'audit_logs',
        'scenarios',
        'contracts',
        'players',
        'manager_contracts',
        'managers',
        'ssr_working_capital',
        'ssr_liquidity',
        'ssr_equity',
        'club_financials',
        'invites',
      ]
      for (const table of clubScoped) {
        const { error } = await supabase.from(table).delete().eq('club_id', clubId)
        if (error) {
          request.log.error({ err: error, table }, 'DELETE /club: table cleanup failed')
          return reply.status(500).send({ error: 'Failed to delete organization data' })
        }
      }

      // Remove member accounts: public.users rows + their Supabase auth identities.
      const { data: members } = await supabase
        .from('users')
        .select('id')
        .eq('club_id', clubId)
      const memberIds = (members ?? []).map((m) => String(m.id))

      const { error: usersErr } = await supabase.from('users').delete().eq('club_id', clubId)
      if (usersErr) throw usersErr

      for (const uid of memberIds) {
        const { error: authErr } = await supabase.auth.admin.deleteUser(uid)
        // Non-fatal: the public.users row is already gone; a leftover auth user
        // can no longer reach any workspace. Log and continue.
        if (authErr) request.log.warn({ err: authErr, uid }, 'DELETE /club: auth user delete failed')
      }

      const { error: clubDelErr } = await supabase.from('clubs').delete().eq('id', clubId)
      if (clubDelErr) throw clubDelErr

      return reply.send({ success: true })
    } catch (err) {
      request.log.error({ err }, 'DELETE /club failed')
      return reply.status(500).send({ error: 'Failed to delete organization' })
    }
  })
}
