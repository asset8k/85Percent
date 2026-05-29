/**
 * Onboarding routes — MVP 2.0 (friction-free identity selection + hydration)
 *
 * Reads ONLY from the local template dictionary (template_clubs /
 * template_roster_items), never the live scraper — so onboarding is insulated
 * from third-party downtime / Cloudflare bans. The monthly background worker
 * (src/scripts/sync-templates.ts) keeps that dictionary fresh.
 *
 *   GET  /onboarding/clubs?league=…  — searchable club list for the wizard
 *   POST /onboarding/complete        — clone a template into the tenant's
 *                                       active players / managers / contracts
 *
 * Hydration rule: Transfermarkt does not give us reliable wages, so every
 * generated contract has annual_wage = 0. The Roster page surfaces those zeros
 * as validation errors so the CFO is prompted to enter real payroll.
 */

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { supabase } from '../lib/supabase.js'
import { authMiddleware } from '../middleware/auth.js'
import { requireRole } from '../middleware/roles.js'
import { writeAuditLog } from '../lib/audit.js'
import {
  buildHydratedRoster,
  leagueIdToTemplate,
  templateToLeagueId,
  type TemplateRosterItemRow,
} from './onboarding-hydrate.js'

const CompleteBody = z.object({
  templateClubId: z.string().uuid('templateClubId must be a UUID'),
  // When true, wipe the club's existing roster first (used to CHANGE clubs).
  // When false/absent, onboarding only runs on an empty roster (409 otherwise).
  replace: z.boolean().optional().default(false),
})

// Wipe a club's entire active+archived roster so a new template can replace it.
// Supabase REST has no transactions, so we delete in FK-safe order:
// scenario_actions that reference the club's players → contracts →
// manager_contracts → managers → players. Club-level financials/settings are
// intentionally preserved (they're the user's own numbers, not template data).
async function wipeClubRoster(clubId: string): Promise<void> {
  const { data: players, error: pErr } = await supabase.from('players').select('id').eq('club_id', clubId)
  if (pErr) throw pErr
  const playerIds = (players ?? []).map((p) => String(p.id))

  if (playerIds.length > 0) {
    // scenario_actions.player_id → players.id (RESTRICT); drop the now-orphaned
    // actions. The scenarios themselves are left intact.
    const { error } = await supabase.from('scenario_actions').delete().in('player_id', playerIds)
    if (error) throw error
  }

  for (const table of ['contracts', 'manager_contracts', 'managers'] as const) {
    const { error } = await supabase.from(table).delete().eq('club_id', clubId)
    if (error) throw error
  }
  const { error } = await supabase.from('players').delete().eq('club_id', clubId)
  if (error) throw error
}

export async function onboardingRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authMiddleware)

  // ------------------------------------------------------------ GET /onboarding/clubs
  // Searchable club list for the wizard, pulled from the local template cache.
  // `league` accepts the app's league_id ('premier-league' | 'efl-championship').
  app.get('/onboarding/clubs', async (request, reply) => {
    const leagueParam = (request.query as Record<string, string>)['league']
    try {
      let query = supabase
        .from('template_clubs')
        .select('id, name, league, logo_url')
        .order('name', { ascending: true })

      if (leagueParam) {
        const tmLeague = leagueIdToTemplate(leagueParam)
        if (!tmLeague) {
          return reply.status(400).send({ error: 'Unknown league. Use premier-league or efl-championship.' })
        }
        query = query.eq('league', tmLeague)
      }

      const { data, error } = await query
      if (error) throw error

      const clubs = (data ?? []).map((c) => ({
        id: String(c.id),
        name: String(c.name),
        leagueId: templateToLeagueId(String(c.league)),
        logoUrl: (c.logo_url as string | null) ?? null,
      }))
      return reply.send({ clubs })
    } catch (err) {
      request.log.error({ err }, 'GET /onboarding/clubs failed')
      return reply.status(500).send({ error: 'Failed to load template clubs' })
    }
  })

  // ------------------------------------------------------------ POST /onboarding/complete
  // Clone a template roster into the caller's active tenant tables. CFO-only —
  // it sets the club's identity (name + league) and seeds the squad.
  app.post('/onboarding/complete', { preHandler: requireRole('cfo') }, async (request, reply) => {
    const parsed = CompleteBody.safeParse(request.body)
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.flatten() })
    }
    const { templateClubId, replace } = parsed.data
    const clubId = request.clubId

    try {
      // 1. Guard: only hydrate an empty club unless `replace` is set, in which
      //    case we wipe the existing roster first (the "change club" flow).
      const { count: playerCount, error: countErr } = await supabase
        .from('players')
        .select('id', { count: 'exact', head: true })
        .eq('club_id', clubId)
      if (countErr) throw countErr
      if ((playerCount ?? 0) > 0 && !replace) {
        return reply.status(409).send({
          error: 'This club already has a squad. Pass replace=true to change clubs (wipes the current roster).',
        })
      }

      // 2. Look up the template + its roster items.
      const { data: template, error: tErr } = await supabase
        .from('template_clubs')
        .select('id, name, league, logo_url')
        .eq('id', templateClubId)
        .maybeSingle()
      if (tErr) throw tErr
      if (!template) return reply.status(404).send({ error: 'Template club not found' })

      // Wipe the existing roster now that we know the target template exists.
      if (replace) await wipeClubRoster(clubId)

      const { data: items, error: iErr } = await supabase
        .from('template_roster_items')
        .select('name, date_of_birth, nationality, position, squad_number, is_manager, estimated_transfer_fee, contract_start, contract_end')
        .eq('template_club_id', templateClubId)
      if (iErr) throw iErr

      const rows = (items ?? []) as TemplateRosterItemRow[]

      // 3. Pure transform → exact insert payloads (wages forced to 0).
      const now = new Date()
      const nowISO = now.toISOString()
      const hydrated = buildHydratedRoster({
        clubId,
        templateName: String(template.name),
        templateLeague: String(template.league),
        items: rows,
        now,
      })

      // 4. Insert players, then contracts (safe ordering — no REST transactions).
      if (hydrated.players.length > 0) {
        const { error: pErr } = await supabase.from('players').insert(hydrated.players)
        if (pErr) throw pErr

        const { error: cErr } = await supabase.from('contracts').insert(hydrated.contracts)
        if (cErr) {
          await supabase.from('players').delete().in('id', hydrated.players.map((p) => p['id'] as string))
          throw cErr
        }
      }

      // 5. Manager (best-effort — most templates won't have one). Only when the
      //    club has no active manager already.
      let managerCreated = false
      if (hydrated.manager && hydrated.managerContract) {
        const { data: existingMgr } = await supabase
          .from('managers')
          .select('id')
          .eq('club_id', clubId)
          .eq('is_active', true)
          .maybeSingle()

        if (!existingMgr) {
          const { error: mErr } = await supabase.from('managers').insert(hydrated.manager)
          if (mErr) throw mErr

          const { error: mcErr } = await supabase.from('manager_contracts').insert(hydrated.managerContract)
          if (mcErr) {
            await supabase.from('managers').delete().eq('id', hydrated.manager['id'] as string)
            throw mcErr
          }
          managerCreated = true
        }
      }

      // 6. Adopt the club's identity (name + league + crest) from the template.
      const { name: clubName, shortName, leagueId } = hydrated.identity
      const logoUrl = (template.logo_url as string | null) ?? null
      const { error: clubErr } = await supabase
        .from('clubs')
        .update({
          name: clubName,
          short_name: shortName,
          league_id: leagueId,
          logo_url: logoUrl,
          updated_at: nowISO,
        })
        .eq('id', clubId)
      if (clubErr) throw clubErr

      await writeAuditLog(request, 'clubs', clubId, 'update', {
        onboarding: true,
        replaced: replace,
        templateClubId,
        clubName,
        leagueId,
        playersCreated: hydrated.players.length,
        managerCreated,
      })

      return reply.status(201).send({
        playersCreated: hydrated.players.length,
        managerCreated,
        club: { name: clubName, leagueId, logoUrl },
      })
    } catch (err) {
      request.log.error({ err }, 'POST /onboarding/complete failed')
      return reply.status(500).send({ error: 'Failed to complete onboarding' })
    }
  })
}
