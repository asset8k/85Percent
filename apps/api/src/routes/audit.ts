/**
 * Audit log viewer — CFO-only read endpoint for the Settings → Activity Log tab.
 * Pagination + optional date / user / table filters.
 *
 * Note: the log itself is written from every mutating route via writeAuditLog.
 * No write endpoints here — `audit_logs` is append-only by design.
 */

import type { FastifyInstance } from 'fastify'
import { supabase } from '../lib/supabase.js'
import { authMiddleware } from '../middleware/auth.js'
import { requireRole } from '../middleware/roles.js'

type AuditRow = {
  id: string
  user_id: string
  club_id: string
  table_name: string
  record_id: string
  action: string
  previous_value: unknown
  new_value: unknown
  created_at: string
  user?: { full_name: string; email: string } | null
}

export async function auditRoutes(app: FastifyInstance) {
  app.addHook('preHandler', authMiddleware)

  // GET /audit?from=YYYY-MM-DD&to=YYYY-MM-DD&user=<userId>&table=<name>&page=1&limit=50
  app.get('/audit', { preHandler: requireRole('cfo') }, async (request, reply) => {
    const q = request.query as Record<string, string>

    // Pagination — defensive parse mirroring scenarios.ts
    const rawPage  = parseInt(q['page']  ?? '1',  10)
    const rawLimit = parseInt(q['limit'] ?? '50', 10)
    const page  = Number.isFinite(rawPage)  && rawPage  > 0 ? rawPage  : 1
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 200) : 50
    const skip = (page - 1) * limit

    // ISO date string validation — only accept YYYY-MM-DD to avoid SQL surprises
    const validDate = (s?: string) => s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : undefined
    const from = validDate(q['from'])
    const to   = validDate(q['to'])
    const userFilter  = q['user']
    const tableFilter = q['table']

    try {
      let query = supabase
        .from('audit_logs')
        .select('id, user_id, club_id, table_name, record_id, action, previous_value, new_value, created_at, user:users!user_id(full_name, email)')
        .eq('club_id', request.clubId)
        .order('created_at', { ascending: false })
        .range(skip, skip + limit - 1)

      if (from) query = query.gte('created_at', from + 'T00:00:00Z')
      if (to)   query = query.lte('created_at', to   + 'T23:59:59Z')
      if (userFilter)  query = query.eq('user_id', userFilter)
      if (tableFilter) query = query.eq('table_name', tableFilter)

      const { data, error } = await query
      if (error) throw error

      // Total count for pagination (with the same filters applied)
      let countQuery = supabase
        .from('audit_logs')
        .select('*', { count: 'exact', head: true })
        .eq('club_id', request.clubId)
      if (from) countQuery = countQuery.gte('created_at', from + 'T00:00:00Z')
      if (to)   countQuery = countQuery.lte('created_at', to   + 'T23:59:59Z')
      if (userFilter)  countQuery = countQuery.eq('user_id', userFilter)
      if (tableFilter) countQuery = countQuery.eq('table_name', tableFilter)
      const { count } = await countQuery

      return reply.send({
        entries: (data ?? []).map((row) => {
          const r = row as unknown as AuditRow
          return {
            id: r.id,
            userId: r.user_id,
            tableName: r.table_name,
            recordId: r.record_id,
            action: r.action,
            previousValue: r.previous_value,
            newValue: r.new_value,
            createdAt: r.created_at,
            user: r.user ? { fullName: r.user.full_name, email: r.user.email } : null,
          }
        }),
        total: count ?? 0,
        page,
        limit,
      })
    } catch (err) {
      request.log.error({ err }, 'GET /audit failed')
      return reply.status(500).send({ error: 'Failed to load audit log' })
    }
  })
}
