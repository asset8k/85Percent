'use server'

import { redirect } from 'next/navigation'
import { z } from 'zod'
import { requireSession } from '@/lib/session'
import { getSupabase } from '@/lib/supabase'
import { formatUsd } from '@/lib/format'

const str = (v: FormDataEntryValue | null) => (typeof v === 'string' ? v.trim() : '')
const flash = (id: string, kind: 'ok' | 'err', msg: string) =>
  `/users/${id}?flash=${kind}&msg=${encodeURIComponent(msg)}`

/** Update full name + email (kept in sync with the Supabase auth account). */
export async function updateProfile(formData: FormData): Promise<void> {
  requireSession()
  const id = str(formData.get('id'))
  const parsed = z
    .object({ fullName: z.string().trim().min(1).max(120), email: z.string().trim().email() })
    .safeParse({ fullName: str(formData.get('fullName')), email: str(formData.get('email')).toLowerCase() })
  if (!parsed.success) redirect(flash(id, 'err', 'Name and a valid email are required.'))
  const { fullName, email } = parsed.data
  const sb = getSupabase()

  const { data: clash } = await sb.from('users').select('id').eq('email', email).neq('id', id).maybeSingle()
  if (clash) redirect(flash(id, 'err', 'That email is already in use.'))

  const { data: current } = await sb.from('users').select('email').eq('id', id).maybeSingle()
  if (current && current.email !== email) {
    const { error: authErr } = await sb.auth.admin.updateUserById(id, { email, email_confirm: true })
    if (authErr) redirect(flash(id, 'err', `Auth email update failed: ${authErr.message}`))
  }
  const { error } = await sb.from('users').update({ full_name: fullName, email }).eq('id', id)
  if (error) redirect(flash(id, 'err', error.message))
  redirect(flash(id, 'ok', 'Profile updated.'))
}

/** Reset the account password through the Supabase auth-admin API. */
export async function resetPassword(formData: FormData): Promise<void> {
  requireSession()
  const id = str(formData.get('id'))
  const password = str(formData.get('password'))
  if (password.length < 8) redirect(flash(id, 'err', 'Password must be at least 8 characters.'))
  const { error } = await getSupabase().auth.admin.updateUserById(id, { password })
  if (error) redirect(flash(id, 'err', `Password update failed: ${error.message}`))
  redirect(flash(id, 'ok', 'Password updated.'))
}

/** Top up (add) or set the exact AI chat balance. */
export async function adjustBalance(formData: FormData): Promise<void> {
  requireSession()
  const id = str(formData.get('id'))
  const mode = str(formData.get('mode'))
  const amount = Number(str(formData.get('amount')))
  if (!Number.isFinite(amount) || amount < 0) redirect(flash(id, 'err', 'Enter a valid amount.'))
  const sb = getSupabase()

  if (mode === 'topup') {
    const { data, error } = await sb.rpc('admin_topup_balance', { p_user_id: id, p_amount: amount })
    if (error) redirect(flash(id, 'err', `Top-up failed: ${error.message}`))
    redirect(flash(id, 'ok', `Added ${formatUsd(amount)}. New balance: ${formatUsd(data as number)}.`))
  }
  const rounded = Math.round(amount * 10000) / 10000
  const { error } = await sb.from('users').update({ ai_balance_usd: rounded }).eq('id', id)
  if (error) redirect(flash(id, 'err', `Set failed: ${error.message}`))
  redirect(flash(id, 'ok', `Balance set to ${formatUsd(rounded)}.`))
}

/** Delete the auth login, then the profile row and the rows that reference it.
 *  Auth goes first (and its failure aborts here, leaving the profile intact)
 *  so a failed delete never silently leaves an orphaned auth account behind
 *  with no profile row pointing back at it — the reverse of that used to
 *  happen here, since the previous order deleted the profile first and then
 *  swallowed any auth-deletion error. */
export async function deleteUser(formData: FormData): Promise<void> {
  requireSession()
  const id = str(formData.get('id'))
  const sb = getSupabase()
  const { error: authError } = await sb.auth.admin.deleteUser(id)
  if (authError) redirect(flash(id, 'err', `Auth delete failed: ${authError.message}`))
  // Remove referencing rows first (chat_messages cascade from chat_sessions;
  // scenario_actions from scenarios).
  await sb.from('chat_sessions').delete().eq('user_id', id)
  await sb.from('scenarios').delete().eq('created_by', id)
  await sb.from('audit_logs').delete().eq('user_id', id)
  await sb.from('notifications').delete().eq('user_id', id)
  const { error } = await sb.from('users').delete().eq('id', id)
  if (error) redirect(flash(id, 'err', `Profile delete failed (auth account already removed): ${error.message}`))
  redirect('/users')
}
