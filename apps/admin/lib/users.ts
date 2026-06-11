import 'server-only'
import { getSupabase } from './supabase'

/** users — read helpers for the account-management screens. */

export interface UserRow {
  id: string
  email: string
  full_name: string
  club_id: string
  title: string | null
  is_workspace_admin: boolean
  ai_balance_usd: string | number
  total_ai_tokens_used: number
  created_at: string
}

export const USER_COLS =
  'id, email, full_name, club_id, title, is_workspace_admin, ai_balance_usd, total_ai_tokens_used, created_at'

export async function listUsers(): Promise<{ users: UserRow[]; clubName: Map<string, string> }> {
  const sb = getSupabase()
  const [{ data: users }, { data: clubs }] = await Promise.all([
    sb.from('users').select(USER_COLS).order('created_at', { ascending: false }),
    sb.from('clubs').select('id, name'),
  ])
  const clubName = new Map((clubs ?? []).map((c) => [c.id as string, c.name as string]))
  return { users: (users ?? []) as UserRow[], clubName }
}

export async function getUser(
  id: string,
): Promise<{ user: UserRow; clubName: string | null } | null> {
  const sb = getSupabase()
  const { data } = await sb.from('users').select(USER_COLS).eq('id', id).maybeSingle()
  if (!data) return null
  const user = data as UserRow
  const { data: club } = await sb.from('clubs').select('name').eq('id', user.club_id).maybeSingle()
  return { user, clubName: (club?.name as string) ?? null }
}
