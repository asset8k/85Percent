/**
 * Authentication routes — TOTP two-factor + self-service password recovery.
 *
 * Architecture note: Headroom uses Supabase Auth, so the password store lives in
 * Supabase `auth.users` and the JWT is minted by Supabase — not here. To honour
 * the spec's "withhold the JWT until 2FA passes" requirement on top of that, we
 * proxy login through the backend:
 *
 *   POST /auth/login        → verify password (anon client). If the user has TOTP
 *                             enabled, return { requires_2fa: true } and NO tokens.
 *                             Otherwise return the Supabase session immediately.
 *   POST /auth/verify-2fa   → re-verify password + the 6-digit TOTP code, then
 *                             return the session.
 *
 * TOTP setup (authenticated):
 *   POST /auth/totp/setup   → generate a secret + otpauth URI + QR data URL.
 *   POST /auth/totp/verify  → confirm the first 6-digit code, flip is_totp_enabled.
 *   POST /auth/totp/disable → confirm a current code, clear the secret.
 *
 * Password recovery (public):
 *   POST /auth/forgot-password → mint a single-use token (1h), console-log the link
 *                                (no mailer in dev). Always 200 — no enumeration.
 *   POST /auth/reset-password  → validate token + expiry, set the new password via
 *                                the Supabase Admin API, clear the token fields.
 */

import { randomBytes } from 'crypto'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { authenticator } from 'otplib'
import QRCode from 'qrcode'
import { supabase } from '../lib/supabase.js'
import { supabaseAnon } from '../lib/supabase-anon.js'
import { authMiddleware } from '../middleware/auth.js'
import { writeAuditLog } from '../lib/audit.js'

// Allow ±1 time-step (±30s) of clock drift between the authenticator app and us.
authenticator.options = { window: 1 }

const TOTP_ISSUER = 'Headroom'
const RESET_TTL_MS = 60 * 60 * 1000 // 1 hour

// Password policy — mirrors the signup rules enforced on the client.
const PasswordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .regex(/[A-Z]/, 'Must contain at least one uppercase letter')
  .regex(/[a-z]/, 'Must contain at least one lowercase letter')
  .regex(/[0-9]/, 'Must contain at least one number')
  .regex(/[^A-Za-z0-9]/, 'Must contain at least one special character')

const LoginBody = z.object({
  email: z.string().trim().toLowerCase().email('Invalid email'),
  password: z.string().min(1, 'Password is required'),
})

const Verify2faBody = LoginBody.extend({
  code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code'),
})

const CodeBody = z.object({
  code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code'),
})

const ForgotBody = z.object({
  email: z.string().trim().toLowerCase().email('Invalid email'),
})

const ResetBody = z.object({
  token: z.string().min(16, 'Invalid token'),
  password: PasswordSchema,
})

// Tighter per-route limit for the credential-handling endpoints — blunts
// password/TOTP brute forcing without throttling the rest of the API.
const AUTH_RATE = { rateLimit: { max: 10, timeWindow: '1 minute' } }

interface SessionTokens {
  access_token: string
  refresh_token: string
  expires_at: number | null
  expires_in: number
}

function generateResetToken(): string {
  return randomBytes(32).toString('base64url')
}

export async function authRoutes(app: FastifyInstance) {
  // ───────────────────────────────────────────────────── PUBLIC: LOGIN + 2FA

  // POST /auth/login — verify the password; gate on TOTP.
  app.post('/auth/login', { config: AUTH_RATE }, async (request, reply) => {
    const parsed = LoginBody.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid email or password' })
    const { email, password } = parsed.data

    const { data, error } = await supabaseAnon.auth.signInWithPassword({ email, password })
    if (error || !data.session || !data.user) {
      return reply.status(401).send({ error: 'Invalid email or password' })
    }

    // Does this account have TOTP turned on? (service role — bypasses RLS)
    const { data: u } = await supabase
      .from('users')
      .select('is_totp_enabled')
      .eq('id', data.user.id)
      .maybeSingle()

    if (u?.is_totp_enabled) {
      // Withhold the session. The client must complete /auth/verify-2fa.
      return reply.send({ requires_2fa: true })
    }

    const s = data.session
    return reply.send({
      requires_2fa: false,
      session: {
        access_token: s.access_token,
        refresh_token: s.refresh_token,
        expires_at: s.expires_at ?? null,
        expires_in: s.expires_in,
      } satisfies SessionTokens,
    })
  })

  // POST /auth/verify-2fa — re-verify password + TOTP code, then issue the session.
  app.post('/auth/verify-2fa', { config: AUTH_RATE }, async (request, reply) => {
    const parsed = Verify2faBody.safeParse(request.body)
    if (!parsed.success) return reply.status(400).send({ error: 'Invalid request' })
    const { email, password, code } = parsed.data

    const { data, error } = await supabaseAnon.auth.signInWithPassword({ email, password })
    if (error || !data.session || !data.user) {
      return reply.status(401).send({ error: 'Invalid email or password' })
    }

    const { data: u } = await supabase
      .from('users')
      .select('totp_secret, is_totp_enabled')
      .eq('id', data.user.id)
      .maybeSingle()

    // If 2FA isn't actually enabled, fall through and just return the session.
    if (u?.is_totp_enabled) {
      if (!u.totp_secret || !authenticator.verify({ token: code, secret: u.totp_secret })) {
        return reply.status(401).send({ error: 'Invalid authentication code' })
      }
    }

    const s = data.session
    return reply.send({
      session: {
        access_token: s.access_token,
        refresh_token: s.refresh_token,
        expires_at: s.expires_at ?? null,
        expires_in: s.expires_in,
      } satisfies SessionTokens,
    })
  })

  // ─────────────────────────────────────────────── PUBLIC: PASSWORD RECOVERY

  // POST /auth/forgot-password — always 200 (no account enumeration).
  app.post('/auth/forgot-password', { config: AUTH_RATE }, async (request, reply) => {
    const parsed = ForgotBody.safeParse(request.body)
    if (!parsed.success) return reply.send({ success: true })
    const { email } = parsed.data

    const { data: user } = await supabase
      .from('users')
      .select('id')
      .eq('email', email)
      .maybeSingle()

    if (user) {
      const token = generateResetToken()
      const expires = new Date(Date.now() + RESET_TTL_MS).toISOString()
      const { error } = await supabase
        .from('users')
        .update({ password_reset_token: token, password_reset_expires: expires })
        .eq('id', user.id)

      if (error) {
        request.log.error({ err: error }, 'forgot-password: token persist failed')
      } else {
        const base = process.env['FRONTEND_URL'] ?? 'http://localhost:5173'
        const link = `${base}/reset-password?token=${token}`
        // No mailer in dev — surface the link in the server logs (and stdout).
        request.log.info({ email }, 'Password reset requested')
        // eslint-disable-next-line no-console
        console.log(`\n🔑 Password reset link for ${email}:\n   ${link}\n   (expires in 1 hour)\n`)
      }
    }

    return reply.send({ success: true })
  })

  // POST /auth/reset-password — validate token, set the new password via Admin API.
  app.post('/auth/reset-password', { config: AUTH_RATE }, async (request, reply) => {
    const parsed = ResetBody.safeParse(request.body)
    if (!parsed.success) {
      const first = parsed.error.errors[0]?.message ?? 'Invalid request'
      return reply.status(400).send({ error: first })
    }
    const { token, password } = parsed.data

    // Expiry is compared in Postgres (not JS): the column is `timestamp without
    // time zone`, so reading it back and parsing with `new Date()` would shift
    // it by the host's UTC offset. Filtering here keeps both sides as UTC
    // wall-clock ISO strings, matching the invites-expiry pattern.
    const { data: user, error: findErr } = await supabase
      .from('users')
      .select('id, club_id')
      .eq('password_reset_token', token)
      .gt('password_reset_expires', new Date().toISOString())
      .maybeSingle()

    if (findErr) {
      request.log.error({ err: findErr }, 'reset-password: lookup failed')
      return reply.status(500).send({ error: 'Failed to reset password' })
    }
    if (!user) {
      return reply.status(400).send({ error: 'This reset link is invalid or has expired.' })
    }

    // Supabase owns the password store — change it through the Admin API.
    const { error: updErr } = await supabase.auth.admin.updateUserById(String(user.id), { password })
    if (updErr) {
      request.log.error({ err: updErr }, 'reset-password: admin updateUser failed')
      return reply.status(500).send({ error: 'Failed to reset password' })
    }

    // Single-use: clear the token so the link can't be replayed.
    await supabase
      .from('users')
      .update({ password_reset_token: null, password_reset_expires: null })
      .eq('id', user.id)

    await supabase.from('audit_logs').insert({
      id: randomBytes(16).toString('hex'),
      user_id: user.id,
      club_id: user.club_id,
      table_name: 'users',
      record_id: String(user.id),
      action: 'update',
      new_value: { event: 'password_reset' },
    })

    return reply.send({ success: true })
  })

  // ───────────────────────────────────────────────── AUTHENTICATED: TOTP MGMT

  app.register(async (scoped) => {
    scoped.addHook('preHandler', authMiddleware)

    // POST /auth/totp/setup — generate a secret + provisioning QR. Stores the
    // secret but leaves is_totp_enabled=false until the first code is verified.
    scoped.post('/auth/totp/setup', async (request, reply) => {
      const { data: u, error } = await supabase
        .from('users')
        .select('email, is_totp_enabled')
        .eq('id', request.userId)
        .maybeSingle()
      if (error || !u) return reply.status(500).send({ error: 'Failed to start setup' })
      if (u.is_totp_enabled) {
        return reply.status(409).send({ error: 'Two-factor authentication is already enabled.' })
      }

      const secret = authenticator.generateSecret()
      const otpauthUri = authenticator.keyuri(String(u.email), TOTP_ISSUER, secret)

      const { error: persistErr } = await supabase
        .from('users')
        .update({ totp_secret: secret })
        .eq('id', request.userId)
      if (persistErr) return reply.status(500).send({ error: 'Failed to start setup' })

      const qrDataUrl = await QRCode.toDataURL(otpauthUri, { margin: 1, width: 200 })
      return reply.send({ secret, otpauthUri, qrDataUrl })
    })

    // POST /auth/totp/verify — confirm the first code, enable 2FA.
    scoped.post('/auth/totp/verify', async (request, reply) => {
      const parsed = CodeBody.safeParse(request.body)
      if (!parsed.success) return reply.status(400).send({ error: 'Enter the 6-digit code' })

      const { data: u, error } = await supabase
        .from('users')
        .select('totp_secret, is_totp_enabled')
        .eq('id', request.userId)
        .maybeSingle()
      if (error || !u) return reply.status(500).send({ error: 'Verification failed' })
      if (!u.totp_secret) return reply.status(400).send({ error: 'Run setup before verifying.' })

      if (!authenticator.verify({ token: parsed.data.code, secret: u.totp_secret })) {
        return reply.status(400).send({ error: 'Invalid code. Check your authenticator app and try again.' })
      }

      const { error: enableErr } = await supabase
        .from('users')
        .update({ is_totp_enabled: true })
        .eq('id', request.userId)
      if (enableErr) return reply.status(500).send({ error: 'Verification failed' })

      await writeAuditLog(request, 'users', String(request.userId), 'update', { event: 'totp_enabled' })
      return reply.send({ success: true, enabled: true })
    })

    // POST /auth/totp/disable — requires a current code to prove possession.
    scoped.post('/auth/totp/disable', async (request, reply) => {
      const parsed = CodeBody.safeParse(request.body)
      if (!parsed.success) return reply.status(400).send({ error: 'Enter the 6-digit code' })

      const { data: u, error } = await supabase
        .from('users')
        .select('totp_secret, is_totp_enabled')
        .eq('id', request.userId)
        .maybeSingle()
      if (error || !u) return reply.status(500).send({ error: 'Failed to disable' })
      if (!u.is_totp_enabled || !u.totp_secret) {
        return reply.status(400).send({ error: 'Two-factor authentication is not enabled.' })
      }
      if (!authenticator.verify({ token: parsed.data.code, secret: u.totp_secret })) {
        return reply.status(400).send({ error: 'Invalid code. Enter a current code to turn off 2FA.' })
      }

      const { error: disableErr } = await supabase
        .from('users')
        .update({ totp_secret: null, is_totp_enabled: false })
        .eq('id', request.userId)
      if (disableErr) return reply.status(500).send({ error: 'Failed to disable' })

      await writeAuditLog(request, 'users', String(request.userId), 'update', { event: 'totp_disabled' })
      return reply.send({ success: true, enabled: false })
    })

    // POST /auth/change-password — verify the current password, then set a new one.
    scoped.post('/auth/change-password', async (request, reply) => {
      const Body = z.object({
        currentPassword: z.string().min(1, 'Current password is required'),
        newPassword: PasswordSchema,
      })
      const parsed = Body.safeParse(request.body)
      if (!parsed.success) {
        const first = parsed.error.errors[0]?.message ?? 'Invalid request'
        return reply.status(400).send({ error: first })
      }

      const { data: u, error } = await supabase
        .from('users')
        .select('email')
        .eq('id', request.userId)
        .maybeSingle()
      if (error || !u?.email) return reply.status(500).send({ error: 'Failed to change password' })

      // Re-authenticate with the current password before allowing the change.
      const { error: pwErr } = await supabaseAnon.auth.signInWithPassword({
        email: String(u.email),
        password: parsed.data.currentPassword,
      })
      if (pwErr) return reply.status(401).send({ error: 'Current password is incorrect.' })

      const { error: updErr } = await supabase.auth.admin.updateUserById(
        String(request.userId),
        { password: parsed.data.newPassword },
      )
      if (updErr) {
        request.log.error({ err: updErr }, 'change-password: admin updateUser failed')
        return reply.status(500).send({ error: 'Failed to change password' })
      }

      await writeAuditLog(request, 'users', String(request.userId), 'update', { event: 'password_changed' })
      return reply.send({ success: true })
    })
  })
}
