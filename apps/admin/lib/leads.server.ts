import 'server-only'
import { getSupabase } from './supabase'
import { type Lead, type LeadStatus, isLeadStatus } from './leads'

/**
 * leads.server — the service-role Supabase reads/writes for `demo_requests`.
 *
 * NB the real table uses `full_name` and `work_email` (and carries a `source`
 * column recording which CTA fired); this module is the single place that maps
 * those DB names onto the friendlier `Lead` shape the dashboard renders.
 */

interface LeadRow {
  id: string
  created_at: string
  full_name: string | null
  work_email: string
  club: string | null
  role: string | null
  message: string | null
  source: string | null
  status: string | null
}

const COLS = 'id, created_at, full_name, work_email, club, role, message, source, status'

function toLead(r: LeadRow): Lead {
  return {
    id: r.id,
    createdAt: r.created_at,
    name: r.full_name,
    email: r.work_email,
    club: r.club,
    role: r.role,
    message: r.message,
    source: r.source,
    // Normalise a null/legacy status to "New" so every lead always has a state.
    status: isLeadStatus(r.status) ? r.status : 'New',
  }
}

export interface LeadsResult {
  leads: Lead[]
  counts: Record<LeadStatus, number> & { total: number }
  /** Set when the table can't be read (e.g. not provisioned yet). */
  error?: string
}

const emptyCounts = (): LeadsResult['counts'] => ({
  total: 0,
  New: 0,
  Contacted: 0,
  'Demo Scheduled': 0,
  Archived: 0,
})

export async function listLeads(): Promise<LeadsResult> {
  const { data, error } = await getSupabase()
    .from('demo_requests')
    .select(COLS)
    .order('created_at', { ascending: false })

  if (error) {
    return { leads: [], counts: emptyCounts(), error: error.message }
  }

  const leads = ((data ?? []) as LeadRow[]).map(toLead)
  const counts = emptyCounts()
  counts.total = leads.length
  for (const l of leads) counts[l.status] += 1
  return { leads, counts }
}

export async function getLead(id: string): Promise<Lead | null> {
  const { data } = await getSupabase().from('demo_requests').select(COLS).eq('id', id).maybeSingle()
  return data ? toLead(data as LeadRow) : null
}

export async function setLeadStatus(
  id: string,
  status: LeadStatus,
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await getSupabase().from('demo_requests').update({ status }).eq('id', id)
  return error ? { ok: false, error: error.message } : { ok: true }
}
