/** Login / logout for the single admin. */

import type { FastifyInstance } from 'fastify'
import { checkCredentials, startSession, endSession, isAuthed } from '../lib/auth.js'
import { str } from '../lib/format.js'
import { html, page, raw } from '../lib/html.js'

export async function authRoutes(app: FastifyInstance) {
  app.get('/login', async (request, reply) => {
    if (isAuthed(request)) return reply.redirect('/users')
    const error = (request.query as { error?: string }).error
    reply.type('text/html').send(loginPage(!!error))
  })

  app.post('/login', async (request, reply) => {
    const body = (request.body ?? {}) as Record<string, unknown>
    if (checkCredentials(str(body['username']), str(body['password']))) {
      startSession(reply)
      return reply.redirect('/users')
    }
    return reply.redirect('/login?error=1')
  })

  app.post('/logout', async (_request, reply) => {
    endSession(reply)
    return reply.redirect('/login')
  })
}

function loginPage(error: boolean): string {
  const body = html`
    <div class="card" style="max-width:380px;margin:40px auto;">
      <h1>Headroom Admin</h1>
      <p class="muted">Sign in to manage users and run maintenance jobs.</p>
      ${error ? html`<div class="flash err">Invalid username or password.</div>` : ''}
      <form method="post" action="/login">
        <label>Username</label>
        <input name="username" autocomplete="username" autofocus />
        <label>Password</label>
        <input name="password" type="password" autocomplete="current-password" />
        <div style="margin-top:16px"><button type="submit">Sign in</button></div>
      </form>
    </div>
  `
  // Reuse the shell but without nav for the login screen.
  return (
    '<!doctype html>' +
    html`<html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
      <title>Sign in · Headroom Admin</title><style>${raw(LOGIN_STYLE)}</style></head>
      <body>${body}</body></html>`.html
  )
}

const LOGIN_STYLE = `
  body { margin:0; font:14px/1.5 ui-sans-serif,system-ui,sans-serif; color:#0f172a; background:#f8fafc; }
  .card { background:#fff; border:1px solid #e2e8f0; border-radius:12px; padding:24px; }
  h1 { font-size:20px; margin:0 0 4px; }
  .muted { color:#64748b; }
  label { display:block; font-size:12px; color:#64748b; margin:12px 0 4px; }
  input { width:100%; box-sizing:border-box; padding:9px 11px; border:1px solid #e2e8f0; border-radius:8px; font:inherit; }
  button { padding:9px 16px; border-radius:8px; border:0; background:#7c3aed; color:#fff; font-weight:600; cursor:pointer; }
  .flash.err { background:#fee2e2; color:#991b1b; padding:10px 12px; border-radius:8px; margin:12px 0; }
`
