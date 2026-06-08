/**
 * Club owner resolution — the single source of truth for "whose AI balance does
 * this workspace draw on".
 *
 * AI credits are a SHARED pool per workspace, not per user. A club pays for one
 * balance; every member (the founding admin and any invited "guest") checks and
 * debits that same pool. We anchor the pool to the workspace OWNER — the club's
 * founding workspace-admin — and route all balance reads/writes to that user's
 * row.
 *
 * There is no explicit `clubs.owner_id` column, so the owner is resolved as the
 * earliest-created `is_workspace_admin` user in the club (the founder who
 * provisioned the workspace — see authMiddleware), falling back to the earliest
 * member if a club somehow has no admin. If an explicit owner column is added
 * later, this is the only place that needs to change.
 *
 * NOTE: chat history is deliberately NOT shared — sessions/messages stay tied to
 * the acting user's id. Only the balance pool is shared.
 */
import { supabase } from './supabase.js'

/**
 * Resolve the user id that owns a club's AI credit pool.
 * Returns null only if the club has no members at all (shouldn't happen for an
 * authenticated request); callers should fall back to the acting user's id.
 */
export async function getClubOwnerId(clubId: string): Promise<string | null> {
  // Prefer the founding workspace admin (earliest-created admin).
  const { data: admin, error: adminErr } = await supabase
    .from('users')
    .select('id')
    .eq('club_id', clubId)
    .eq('is_workspace_admin', true)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (adminErr) throw adminErr
  if (admin?.id) return admin.id as string

  // Fallback: earliest member of the club.
  const { data: member, error: memberErr } = await supabase
    .from('users')
    .select('id')
    .eq('club_id', clubId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle()
  if (memberErr) throw memberErr
  return (member?.id as string | undefined) ?? null
}
