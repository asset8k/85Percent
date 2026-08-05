/**
 * In-app notification routes (MVP 2.1).
 *
 * Read/consume endpoints for the TopBar bell, plus a derivation endpoint that
 * turns current club state into standing alerts (compliance threshold,
 * contract expiries). Derivation is idempotent — see createNotificationOnce —
 * so the frontend can call /refresh on load without piling up duplicates.
 *
 * Visibility model: a row is visible to a member when it is club-wide
 * (user_id IS NULL) or addressed to that member (user_id = caller). Writes are
 * scoped the same way so one member can't read/clear another's private alerts.
 */

import type { ApiApp } from '../serverless/types'
import { z } from 'zod'
import { supabase } from '../lib/supabase'
import { authMiddleware } from '../middleware/auth'
import { createNotificationOnce } from '../lib/notifications'
import { deriveRosterSquadCosts } from '../services/roster-costs'
import { resolvePlayerContract, type ContractRow, type RegistrationAssetRow } from '../services/player-registration'

interface NotificationRow {
  id: string
  club_id: string
  user_id: string | null
  title: string
  message: string
  type: 'INFO' | 'WARNING' | 'CRITICAL'
  is_read: boolean
  created_at: string
}

function toWire(r: NotificationRow) {
  return {
    id: r.id,
    title: r.title,
    message: r.message,
    type: r.type,
    isRead: r.is_read,
    isClubWide: r.user_id == null,
    createdAt: r.created_at,
  }
}

// Months between now and an ISO date (negative if already past).
function monthsUntil(endISO: string): number {
  const now = new Date()
  const end = new Date(String(endISO).slice(0, 10) + 'T00:00:00Z')
  return (end.getUTCFullYear() - now.getUTCFullYear()) * 12 + (end.getUTCMonth() - now.getUTCMonth())
}

const RefreshBody = z.object({
  // Active season key (e.g. "2027-28") whose financials drive the compliance
  // check. Optional — when absent or unconfigured, compliance is skipped.
  season: z.string().regex(/^\d{4}-\d{2}$/).optional(),
})

export async function notificationRoutes(app: ApiApp) {
  app.addHook('preHandler', authMiddleware)

  // ---------------------------------------------------------------- GET /notifications
  app.get('/notifications', async (request, reply) => {
    try {
      const { data, error } = await supabase
        .from('notifications')
        .select('id, club_id, user_id, title, message, type, is_read, created_at')
        .eq('club_id', request.clubId)
        .or(`user_id.is.null,user_id.eq.${request.userId}`)
        .order('created_at', { ascending: false })
        .limit(50)

      if (error) throw error

      const rows = (data ?? []) as NotificationRow[]
      const unreadCount = rows.filter((r) => !r.is_read).length
      return reply.send({ notifications: rows.map(toWire), unreadCount })
    } catch (err) {
      request.log.error({ err }, 'GET /notifications failed')
      return reply.status(500).send({ error: 'Failed to load notifications' })
    }
  })

  // ------------------------------------------------- PATCH /notifications/read-all
  // (declared before /:id/read so the literal path isn't captured by the param)
  app.patch('/notifications/read-all', async (request, reply) => {
    try {
      const { error } = await supabase
        .from('notifications')
        .update({ is_read: true })
        .eq('club_id', request.clubId)
        .or(`user_id.is.null,user_id.eq.${request.userId}`)
        .eq('is_read', false)

      if (error) throw error
      return reply.send({ success: true })
    } catch (err) {
      request.log.error({ err }, 'PATCH /notifications/read-all failed')
      return reply.status(500).send({ error: 'Failed to mark all as read' })
    }
  })

  // -------------------------------------------------- PATCH /notifications/:id/read
  app.patch('/notifications/:id/read', async (request, reply) => {
    const { id } = request.params as { id: string }
    try {
      // Scope the update to the caller's club + visibility so a member can't
      // flip another tenant's (or another user's private) notification.
      const { data, error } = await supabase
        .from('notifications')
        .update({ is_read: true })
        .eq('id', id)
        .eq('club_id', request.clubId)
        .or(`user_id.is.null,user_id.eq.${request.userId}`)
        .select('id')
        .maybeSingle()

      if (error) throw error
      if (!data) return reply.status(404).send({ error: 'Notification not found' })
      return reply.send({ success: true })
    } catch (err) {
      request.log.error({ err }, 'PATCH /notifications/:id/read failed')
      return reply.status(500).send({ error: 'Failed to mark as read' })
    }
  })

  // --------------------------------------------------- POST /notifications/refresh
  // Event-driven derivation: scans current roster + financials and raises any
  // standing alerts that aren't already live. Idempotent within a 24h window.
  app.post('/notifications/refresh', async (request, reply) => {
    const parsed = RefreshBody.safeParse(request.body ?? {})
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() })

    let created = 0
    try {
      // ── Contract expiries ────────────────────────────────────────────────
      // Active players whose date-derived current contract ends within the next
      // six months. `is_current` is retained as legacy storage metadata and
      // cannot decide a scheduled extension's lifecycle.
      const { data: contracts, error: cErr } = await supabase
        .from('contracts')
        .select('id, player_id, transfer_fee, carried_book_value, annual_wage, agent_fee, start_date, end_date, contract_length_years, is_active, phase_type, amortisation_treatment, extension_signed_date, players!inner(name, is_active)')
        .eq('club_id', request.clubId)
        .eq('is_active', true)
      if (cErr) throw cErr

      const rowsByPlayer = new Map<string, ContractRow[]>()
      for (const contract of contracts ?? []) {
        const row = contract as unknown as ContractRow
        const rows = rowsByPlayer.get(row.player_id) ?? []
        rows.push(row)
        rowsByPlayer.set(row.player_id, rows)
      }
      const playerIds = [...rowsByPlayer.keys()]
      const { data: assets, error: assetErr } = playerIds.length === 0
        ? { data: [], error: null }
        : await supabase
          .from('player_registration_assets')
          .select('player_id, acquisition_fee, acquisition_agent_fee, acquisition_date, carrying_value')
          .eq('club_id', request.clubId)
          .in('player_id', playerIds)
      if (assetErr) throw assetErr
      const assetsByPlayer = new Map((assets ?? []).map((asset) => [String(asset.player_id), asset as RegistrationAssetRow]))

      const expiring = [...rowsByPlayer.entries()]
        .map(([playerId, rows]) => ({
          current: resolvePlayerContract(rows, assetsByPlayer.get(playerId), new Date()),
          player: (contracts ?? []).find((contract) => String(contract.player_id) === playerId)?.players as unknown as { is_active?: boolean } | null,
        }))
        .filter(({ current, player }) => {
          const p = player
          if (p && p.is_active === false) return false
          if (!current) return false
          const m = monthsUntil(current.row.end_date)
          return m >= 0 && m <= 6
        })

      if (expiring.length > 0) {
        const soonest = Math.min(...expiring.map(({ current }) => monthsUntil(current!.row.end_date)))
        const critical = soonest <= 2
        const ok = await createNotificationOnce(
          {
            clubId: request.clubId,
            title: `${expiring.length} contract${expiring.length === 1 ? '' : 's'} expiring soon`,
            message:
              `${expiring.length} player${expiring.length === 1 ? '' : 's'} ` +
              `${expiring.length === 1 ? 'has a contract' : 'have contracts'} expiring within 6 months. ` +
              `Review renewals on the Calendar.`,
            type: critical ? 'CRITICAL' : 'WARNING',
          },
          request.log,
        )
        if (ok) created++
      }

      // ── Compliance threshold ─────────────────────────────────────────────
      if (parsed.data.season) {
        const { data: fin } = await supabase
          .from('club_financials')
          .select('football_related_revenue, owner_equity_used_1yr, current_allowance_ratio, squad_costs_mode, manual_squad_costs')
          .eq('club_id', request.clubId)
          .eq('season', parsed.data.season)
          .maybeSingle()

        if (fin) {
          const squadCostsPence = await deriveSquadCostsPence(request.clubId, fin)
          const revenue =
            Number(fin.football_related_revenue) + Number(fin.owner_equity_used_1yr ?? 0)
          const allowance = Number(fin.current_allowance_ratio)
          const ratio = revenue > 0 ? squadCostsPence / revenue : 0
          const pct = (ratio * 100).toFixed(1)

          if (ratio > 0.85 + allowance) {
            const ok = await createNotificationOnce(
              {
                clubId: request.clubId,
                title: 'Squad cost ratio in Points Risk',
                message: `Your squad cost ratio is ${pct}% of revenue — above the Red Threshold. Points deductions apply in the season a breach is confirmed.`,
                type: 'CRITICAL',
              },
              request.log,
            )
            if (ok) created++
          } else if (ratio > 0.85) {
            const ok = await createNotificationOnce(
              {
                clubId: request.clubId,
                title: 'Squad cost ratio in the Levy Zone',
                message: `Your squad cost ratio is ${pct}% of revenue — above 85%. Spend in this band attracts an EFL levy.`,
                type: 'WARNING',
              },
              request.log,
            )
            if (ok) created++
          }
        }
      }

      return reply.send({ created })
    } catch (err) {
      request.log.error({ err }, 'POST /notifications/refresh failed')
      return reply.status(500).send({ error: 'Failed to refresh notifications' })
    }
  })
}

// Squad costs for the compliance check — mirrors GET /club/financials: manual
// override when set, otherwise the engine sum of active contracts + manager.
async function deriveSquadCostsPence(
  clubId: string,
  fin: { squad_costs_mode?: string | null; manual_squad_costs?: unknown },
): Promise<number> {
  if (fin.squad_costs_mode === 'manual' && fin.manual_squad_costs != null) {
    return Number(fin.manual_squad_costs)
  }

  return (await deriveRosterSquadCosts(clubId, new Date())).totalPence
}
