/**
 * Users — list every account, edit profile (name/email), reset password, adjust
 * the AI chat balance (top-up or set), and delete an account. All DB access uses
 * the service-role client; email/password changes go through the Supabase
 * auth-admin API so auth.users stays in sync with public.users.
 */

import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { supabase } from '../lib/supabase.js'
import { requireAuth } from '../lib/auth.js'
import { html, page, raw, esc } from '../lib/html.js'
import { formatUsd, formatDate, str } from '../lib/format.js'

interface UserRow {
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

const USER_COLS =
  'id, email, full_name, club_id, title, is_workspace_admin, ai_balance_usd, total_ai_tokens_used, created_at'

function redirectFlash(id: string, kind: 'ok' | 'err', msg: string): string {
  return `/users/${id}?flash=${kind}&msg=${encodeURIComponent(msg)}`
}

export async function userRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireAuth)

  // ───────────────────────────────────────────────── list
  app.get('/users', async (_request, reply) => {
    const { data: users } = await supabase
      .from('users')
      .select(USER_COLS)
      .order('created_at', { ascending: false })
    const { data: clubs } = await supabase.from('clubs').select('id, name')
    const clubName = new Map((clubs ?? []).map((c) => [c.id as string, c.name as string]))

    const rows = (users ?? []) as UserRow[]
    const body = html`
      <h1>Users</h1>
      <p class="muted">${rows.length} account${rows.length === 1 ? '' : 's'}.</p>
      <table>
        <thead>
          <tr><th>Email</th><th>Name</th><th>Club</th><th>Access</th><th>AI balance</th><th>Tokens</th><th>Created</th><th></th></tr>
        </thead>
        <tbody>
          ${rows.map((u) => {
            const bal = Number(u.ai_balance_usd)
            return html`
              <tr>
                <td>${u.email}</td>
                <td>${u.full_name}</td>
                <td class="muted">${clubName.get(u.club_id) ?? '—'}</td>
                <td>${u.is_workspace_admin ? html`<span class="pill ok">Admin</span>` : html`<span class="muted">Member</span>`}</td>
                <td class="num">${bal <= 0.01 ? html`<span class="pill fail">${formatUsd(bal)}</span>` : bal <= 0.5 ? html`<span class="pill low">${formatUsd(bal)}</span>` : formatUsd(bal)}</td>
                <td class="num muted">${u.total_ai_tokens_used.toLocaleString('en-US')}</td>
                <td class="muted">${formatDate(u.created_at)}</td>
                <td><a href="/users/${u.id}">Manage →</a></td>
              </tr>
            `
          })}
        </tbody>
      </table>
    `
    reply.type('text/html').send(page({ title: 'Users', active: 'users', body }))
  })

  // ───────────────────────────────────────────────── detail / edit
  app.get('/users/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const { data } = await supabase.from('users').select(USER_COLS).eq('id', id).maybeSingle()
    if (!data) return reply.code(404).type('text/html').send(page({ title: 'Not found', body: html`<h1>User not found</h1><p><a href="/users">← Back</a></p>` }))
    const u = data as UserRow
    const { data: club } = await supabase.from('clubs').select('name').eq('id', u.club_id).maybeSingle()

    const q = request.query as { flash?: string; msg?: string }
    const fk = q.flash
    const flash =
      fk === 'ok' || fk === 'err' ? { kind: fk as 'ok' | 'err', message: q.msg ?? '' } : undefined
    const bal = Number(u.ai_balance_usd)

    const body = html`
      <p><a href="/users">← All users</a></p>
      <h1>${u.full_name || u.email}</h1>
      <p class="muted">${u.email} · ${club?.name ? esc(club.name) : 'no club'} · joined ${formatDate(u.created_at)}</p>

      <div class="card">
        <h2 style="margin-top:0">AI chat balance</h2>
        <p class="num" style="font-size:24px;font-weight:700;margin:.2em 0;">
          ${bal <= 0.01 ? html`<span class="pill fail" style="font-size:16px">${formatUsd(bal)}</span>` : formatUsd(bal)}
        </p>
        <p class="muted">${u.total_ai_tokens_used.toLocaleString('en-US')} tokens used to date.</p>
        <div class="row" style="align-items:flex-end">
          <form method="post" action="/users/${u.id}/balance" style="flex:1">
            <input type="hidden" name="mode" value="topup" />
            <label>Top up (add USD)</label>
            <input name="amount" type="number" step="0.01" min="0" placeholder="5.00" />
            <div style="margin-top:8px"><button type="submit">Add credit</button></div>
          </form>
          <form method="post" action="/users/${u.id}/balance" style="flex:1">
            <input type="hidden" name="mode" value="set" />
            <label>Set exact balance (USD)</label>
            <input name="amount" type="number" step="0.01" min="0" placeholder="${esc(bal.toFixed(2))}" />
            <div style="margin-top:8px"><button class="secondary" type="submit">Set balance</button></div>
          </form>
        </div>
      </div>

      <div class="card">
        <h2 style="margin-top:0">Profile</h2>
        <form method="post" action="/users/${u.id}">
          <div class="row">
            <div><label>Full name</label><input name="fullName" value="${esc(u.full_name)}" /></div>
            <div><label>Email</label><input name="email" type="email" value="${esc(u.email)}" /></div>
          </div>
          <div style="margin-top:12px"><button type="submit">Save profile</button></div>
        </form>
      </div>

      <div class="card">
        <h2 style="margin-top:0">Reset password</h2>
        <form method="post" action="/users/${u.id}/password">
          <div class="row">
            <div><label>New password (min 8 chars)</label><input name="password" type="text" placeholder="new password" /></div>
          </div>
          <div style="margin-top:12px"><button class="secondary" type="submit">Set password</button></div>
        </form>
      </div>

      <div class="card" style="border-color:#fecaca">
        <h2 style="margin-top:0;color:var(--danger)">Delete account</h2>
        <p class="muted">Removes the auth login and this user's scenarios, activity, notifications and chat history. Does not delete the club (other members may remain).</p>
        <form method="post" action="/users/${u.id}/delete" onsubmit="return confirm('Permanently delete ${esc(u.email)}? This cannot be undone.')">
          <button class="danger" type="submit">Delete this account</button>
        </form>
      </div>
    `
    reply.type('text/html').send(page({ title: u.email, active: 'users', body, flash }))
  })

  // ───────────────────────────────────────────────── update profile
  app.post('/users/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = (request.body ?? {}) as Record<string, unknown>
    const parsed = z
      .object({ fullName: z.string().trim().min(1).max(120), email: z.string().trim().email() })
      .safeParse({ fullName: str(body['fullName']), email: str(body['email']).toLowerCase() })
    if (!parsed.success) return reply.redirect(redirectFlash(id, 'err', 'Name and a valid email are required.'))
    const { fullName, email } = parsed.data

    // Reject if another account already owns the email.
    const { data: clash } = await supabase.from('users').select('id').eq('email', email).neq('id', id).maybeSingle()
    if (clash) return reply.redirect(redirectFlash(id, 'err', 'That email is already in use.'))

    const { data: current } = await supabase.from('users').select('email').eq('id', id).maybeSingle()
    if (current && current.email !== email) {
      const { error: authErr } = await supabase.auth.admin.updateUserById(id, { email, email_confirm: true })
      if (authErr) return reply.redirect(redirectFlash(id, 'err', `Auth email update failed: ${authErr.message}`))
    }
    const { error } = await supabase.from('users').update({ full_name: fullName, email }).eq('id', id)
    if (error) return reply.redirect(redirectFlash(id, 'err', error.message))
    return reply.redirect(redirectFlash(id, 'ok', 'Profile updated.'))
  })

  // ───────────────────────────────────────────────── reset password
  app.post('/users/:id/password', async (request, reply) => {
    const { id } = request.params as { id: string }
    const password = str((request.body as Record<string, unknown>)['password'])
    if (password.length < 8) return reply.redirect(redirectFlash(id, 'err', 'Password must be at least 8 characters.'))
    const { error } = await supabase.auth.admin.updateUserById(id, { password })
    if (error) return reply.redirect(redirectFlash(id, 'err', `Password update failed: ${error.message}`))
    return reply.redirect(redirectFlash(id, 'ok', 'Password updated.'))
  })

  // ───────────────────────────────────────────────── balance (top-up / set)
  app.post('/users/:id/balance', async (request, reply) => {
    const { id } = request.params as { id: string }
    const body = (request.body ?? {}) as Record<string, unknown>
    const mode = str(body['mode'])
    const amount = Number(str(body['amount']))
    if (!Number.isFinite(amount) || amount < 0) return reply.redirect(redirectFlash(id, 'err', 'Enter a valid amount.'))

    if (mode === 'topup') {
      const { data, error } = await supabase.rpc('admin_topup_balance', { p_user_id: id, p_amount: amount })
      if (error) return reply.redirect(redirectFlash(id, 'err', `Top-up failed: ${error.message}`))
      return reply.redirect(redirectFlash(id, 'ok', `Added ${formatUsd(amount)}. New balance: ${formatUsd(data as number)}.`))
    }
    // set exact
    const rounded = Math.round(amount * 10000) / 10000
    const { error } = await supabase.from('users').update({ ai_balance_usd: rounded }).eq('id', id)
    if (error) return reply.redirect(redirectFlash(id, 'err', `Set failed: ${error.message}`))
    return reply.redirect(redirectFlash(id, 'ok', `Balance set to ${formatUsd(rounded)}.`))
  })

  // ───────────────────────────────────────────────── delete account
  app.post('/users/:id/delete', async (request, reply) => {
    const { id } = request.params as { id: string }
    // Remove rows that reference this user before the users row itself.
    // chat_messages cascade from chat_sessions; scenario_actions from scenarios.
    await supabase.from('chat_sessions').delete().eq('user_id', id)
    await supabase.from('scenarios').delete().eq('created_by', id)
    await supabase.from('audit_logs').delete().eq('user_id', id)
    await supabase.from('notifications').delete().eq('user_id', id)
    const { error } = await supabase.from('users').delete().eq('id', id)
    if (error) return reply.redirect(redirectFlash(id, 'err', `Delete failed: ${error.message}`))
    // Finally remove the Supabase auth account (best-effort).
    await supabase.auth.admin.deleteUser(id).catch(() => undefined)
    return reply.redirect('/users')
  })
}
