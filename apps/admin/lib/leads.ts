/**
 * leads — the client-safe contract for inbound demo / access requests.
 *
 * Only constants, types and pure helpers live here so both Client Components
 * (the table + sheet) and the server can import them. The Supabase queries that
 * actually touch the service-role client live in `leads.server.ts`.
 */

export const LEAD_STATUSES = ['New', 'Contacted', 'Demo Scheduled', 'Archived'] as const
export type LeadStatus = (typeof LEAD_STATUSES)[number]

export function isLeadStatus(v: unknown): v is LeadStatus {
  return typeof v === 'string' && (LEAD_STATUSES as readonly string[]).includes(v)
}

export interface Lead {
  id: string
  createdAt: string
  name: string | null
  email: string
  club: string | null
  role: string | null
  message: string | null
  source: string | null
  status: LeadStatus
}
