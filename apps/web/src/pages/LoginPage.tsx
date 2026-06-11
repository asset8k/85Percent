import { useState, useRef, useEffect, useMemo } from 'react'
import { useTranslation, Trans } from 'react-i18next'
import type { TFunction } from 'i18next'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { supabase } from '@/lib/supabase'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Wordmark } from '@/components/ui/Wordmark'
import { Spinner } from '@/components/ui/spinner'
import type { InviteLookupResponse } from '@/lib/api'

// ── Schemas ────────────────────────────────────────────────────────────────
// Built from a translate function so validation messages localize with the UI.

function makeSignInSchema(t: TFunction) {
  return z.object({
    email: z.string().email(t('validation.email')),
    password: z.string().min(6, t('validation.passwordMin6')),
  })
}
type SignInData = z.infer<ReturnType<typeof makeSignInSchema>>

function makeSignUpSchema(t: TFunction) {
  return z.object({
    email: z.string().email(t('validation.email')),
    password: z.string()
      .min(8, t('validation.passwordMin8'))
      .regex(/[A-Z]/, t('validation.passwordUpper'))
      .regex(/[a-z]/, t('validation.passwordLower'))
      .regex(/[0-9]/, t('validation.passwordNumber'))
      .regex(/[^A-Za-z0-9]/, t('validation.passwordSpecial')),
    confirmPassword: z.string(),
  }).refine((d) => d.password === d.confirmPassword, {
    message: t('validation.passwordMatch'),
    path: ['confirmPassword'],
  })
}
type SignUpData = z.infer<ReturnType<typeof makeSignUpSchema>>

// ── Shared input style ──────────────────────────────────────────────────────

const INPUT = 'w-full px-3 py-2.5 text-sm text-slate-900 rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent'

// Human phrase summarising the access an invite grants. A job title wins when
// present; otherwise we describe the explicit permission grants.
function inviteAccessSummary(invite: {
  title: string | null
  canEditRoster: boolean
  canEditScenarios: boolean
  isWorkspaceAdmin: boolean
}, t: TFunction): string {
  if (invite.title && invite.title.trim()) return invite.title.trim()
  if (invite.isWorkspaceAdmin) return t('auth.invite.access.admin')
  const parts: string[] = []
  if (invite.canEditRoster) parts.push(t('auth.invite.access.editRoster'))
  if (invite.canEditScenarios) parts.push(t('auth.invite.access.editScenarios'))
  if (parts.length === 0) return t('auth.invite.access.readOnly')
  return t('auth.invite.access.memberCan', { parts: parts.join(t('auth.invite.access.and')) })
}

// ── Root ────────────────────────────────────────────────────────────────────

export function LoginPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [search] = useSearchParams()
  const inviteToken = search.get('invite')

  // Default mode is signup when an invite token is present (the invitee
  // doesn't have an account yet); otherwise signin (the default landing page).
  const [mode, setMode] = useState<'signin' | 'signup' | 'forgot'>(inviteToken ? 'signup' : 'signin')
  const [serverError, setServerError] = useState('')
  const [pendingOTP, setPendingOTP] = useState<string | null>(null)
  // When login returns requires_2fa we hold the credentials in memory just long
  // enough to re-submit them with the TOTP code; never persisted.
  const [pending2fa, setPending2fa] = useState<{ email: string; password: string } | null>(null)
  const [invite, setInvite] = useState<InviteLookupResponse | null>(null)
  const [inviteError, setInviteError] = useState('')

  // Look up the invite once on mount if a token is present
  useEffect(() => {
    if (!inviteToken) return
    api.invites.lookup(inviteToken)
      .then(setInvite)
      .catch((e: Error) => setInviteError(e.message))
  }, [inviteToken])

  const switchMode = (m: 'signin' | 'signup' | 'forgot') => {
    setMode(m)
    setServerError('')
    setPendingOTP(null)
    setPending2fa(null)
  }

  return (
    <div className="min-h-screen w-full bg-slate-50 flex items-center justify-center p-6">
      <div className="w-full max-w-[420px]">

        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <Wordmark size={42} markScale={1.25} gap={8} />
          <p className="mt-3 text-sm text-slate-500 text-center">{t('auth.tagline')}</p>
        </div>

        {/* Invitation context banner — shown when ?invite=<token> resolves */}
        {invite && (
          <div className="mb-5 rounded-xl border border-violet-100 bg-violet-50/60 px-5 py-4">
            <div className="meta-label text-violet-700">{t('auth.invite.title', { club: invite.clubName })}</div>
            <p className="text-[13px] text-slate-700 mt-1.5">
              <Trans
                i18nKey="auth.invite.body"
                values={{ summary: inviteAccessSummary(invite, t), email: invite.email }}
                components={{ s: <span className="font-medium" />, e: <span className="num" /> }}
              />
            </p>
          </div>
        )}
        {inviteError && (
          <div className="mb-5 rounded-xl border border-red-200 bg-red-50 px-5 py-4">
            <div className="meta-label text-red-700">{t('auth.invite.problem')}</div>
            <p className="text-[13px] text-red-700 mt-1.5">{inviteError}</p>
          </div>
        )}

        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-7">
          {serverError && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2">
              <p className="text-xs text-red-600">{serverError}</p>
            </div>
          )}

          {pending2fa ? (
            <TwoFactorForm
              email={pending2fa.email}
              password={pending2fa.password}
              onSuccess={() => navigate('/dashboard')}
              onError={setServerError}
              onBack={() => switchMode('signin')}
            />
          ) : pendingOTP ? (
            <OTPForm
              email={pendingOTP}
              onSuccess={() => navigate('/dashboard')}
              onError={setServerError}
              onBack={() => switchMode('signup')}
            />
          ) : mode === 'forgot' ? (
            <ForgotPasswordForm
              onError={setServerError}
              onBack={() => switchMode('signin')}
            />
          ) : mode === 'signin' ? (
            <SignInForm
              onSuccess={() => navigate('/dashboard')}
              onNeed2fa={(email, password) => { setServerError(''); setPending2fa({ email, password }) }}
              onError={setServerError}
              onForgot={() => switchMode('forgot')}
            />
          ) : (
            <SignUpForm
              prefillEmail={invite?.email}
              emailLocked={!!invite}
              onSuccess={(email, hasSession) => {
                if (hasSession) navigate('/dashboard')
                else setPendingOTP(email)
              }}
              onError={setServerError}
              onSwitchToSignIn={() => switchMode('signin')}
            />
          )}
        </div>

        <p className="mt-6 text-[12px] text-slate-400 text-center leading-relaxed px-4">
          {t('auth.disclaimer')}
        </p>
      </div>
    </div>
  )
}

// ── Sign In ────────────────────────────────────────────────────────────────

function SignInForm({
  onSuccess,
  onNeed2fa,
  onError,
  onForgot,
}: {
  onSuccess: () => void
  onNeed2fa: (email: string, password: string) => void
  onError: (msg: string) => void
  onForgot: () => void
}) {
  const { t } = useTranslation()
  const schema = useMemo(() => makeSignInSchema(t), [t])
  const form = useForm<SignInData>({ resolver: zodResolver(schema) })

  // Login is proxied through the backend so the JWT can be withheld until the
  // TOTP step passes. When 2FA is off, the backend returns the Supabase session
  // and we hydrate the client with setSession (onAuthStateChange does the rest).
  const onSubmit = async (data: SignInData) => {
    onError('')
    try {
      const res = await api.auth.login(data.email, data.password)
      if (res.requires_2fa) {
        onNeed2fa(data.email, data.password)
        return
      }
      if (!res.session) { onError(t('auth.signin.loginFailed')); return }
      const { error } = await supabase.auth.setSession({
        access_token: res.session.access_token,
        refresh_token: res.session.refresh_token,
      })
      if (error) { onError(error.message); return }
      onSuccess()
    } catch (e) {
      onError(e instanceof Error ? e.message : t('auth.signin.invalidCreds'))
    }
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
      <Field label={t('auth.workEmail')} error={form.formState.errors.email?.message}>
        <input type="email" placeholder="you@club.com" {...form.register('email')} className={INPUT} />
      </Field>
      <Field label={t('auth.password')} error={form.formState.errors.password?.message}>
        <input type="password" placeholder="••••••••" {...form.register('password')} className={INPUT} />
      </Field>
      <div className="-mt-1 text-right">
        <button type="button" onClick={onForgot} className="text-[12px] text-violet-600 hover:text-violet-700 font-medium">
          {t('auth.signin.forgot')}
        </button>
      </div>
      <Button type="submit" className="w-full mt-1" disabled={form.formState.isSubmitting}>
        {form.formState.isSubmitting && <Spinner size={14} />}
        {form.formState.isSubmitting ? t('auth.signin.signingIn') : t('auth.signin.signIn')}
      </Button>
      {/* Public self-serve signup is disabled — 85Percent is invite-only. The
          "Create account" link is intentionally removed here; the signup form
          and logic remain in this file and are reached only via an invite
          (?invite=<token>) or an admin-provisioned Supabase invite. */}
    </form>
  )
}

// ── Two-Factor (TOTP) prompt — shown after password verification when the
// account has an authenticator enrolled. Re-submits the held credentials with
// the 6-digit code; the backend issues the session only when the code matches.
const TOTP_LENGTH = 6

function TwoFactorForm({
  email,
  password,
  onSuccess,
  onError,
  onBack,
}: {
  email: string
  password: string
  onSuccess: () => void
  onError: (msg: string) => void
  onBack: () => void
}) {
  const { t } = useTranslation()
  // Same boxed-cell UX as the registration OTP screen (auto-advance, paste,
  // backspace, auto-submit on the last digit) — just 6 cells with 3+3 grouping.
  const [digits, setDigits] = useState<string[]>(Array(TOTP_LENGTH).fill(''))
  const [loading, setLoading] = useState(false)
  const inputs = useRef<Array<HTMLInputElement | null>>([])

  useEffect(() => { inputs.current[0]?.focus() }, [])

  const verify = async (code: string) => {
    setLoading(true)
    onError('')
    try {
      const { session } = await api.auth.verify2fa(email, password, code)
      const { error } = await supabase.auth.setSession({
        access_token: session.access_token,
        refresh_token: session.refresh_token,
      })
      if (error) { onError(error.message); setLoading(false); return }
      onSuccess()
    } catch (err) {
      onError(err instanceof Error ? err.message : t('auth.twoFactor.invalidCode'))
      setDigits(Array(TOTP_LENGTH).fill(''))
      setLoading(false)
      inputs.current[0]?.focus()
    }
  }

  const handleChange = (i: number, val: string) => {
    const digit = val.replace(/\D/g, '').slice(-1)
    const next = [...digits]
    next[i] = digit
    setDigits(next)
    if (digit && i < TOTP_LENGTH - 1) inputs.current[i + 1]?.focus()
    if (digit && i === TOTP_LENGTH - 1) {
      const code = [...next].join('')
      if (code.length === TOTP_LENGTH) void verify(code)
    }
  }

  const handleKeyDown = (i: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !digits[i] && i > 0) inputs.current[i - 1]?.focus()
  }

  const handlePaste = (e: React.ClipboardEvent) => {
    const text = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, TOTP_LENGTH)
    if (!text) return
    e.preventDefault()
    const next = Array(TOTP_LENGTH).fill('')
    text.split('').forEach((c, idx) => { next[idx] = c })
    setDigits(next)
    const focusIdx = Math.min(text.length, TOTP_LENGTH - 1)
    inputs.current[focusIdx]?.focus()
    if (text.length === TOTP_LENGTH) void verify(text)
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const code = digits.join('')
    if (code.length === TOTP_LENGTH) void verify(code)
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      <div>
        <p className="text-sm font-medium text-slate-900 mb-1">{t('auth.twoFactor.title')}</p>
        <p className="text-[13px] text-slate-500">
          {t('auth.twoFactor.hint', { length: TOTP_LENGTH })}
        </p>
      </div>

      <div className="flex gap-1 justify-center" onPaste={handlePaste}>
        {digits.map((d, i) => (
          <input
            key={i}
            ref={(el) => { inputs.current[i] = el }}
            type="text"
            inputMode="numeric"
            maxLength={1}
            value={d}
            onChange={(e) => handleChange(i, e.target.value)}
            onKeyDown={(e) => handleKeyDown(i, e)}
            className={
              'w-10 h-12 text-center text-lg font-semibold text-slate-900 rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition-colors num' +
              (i === TOTP_LENGTH / 2 ? ' ml-3' : '')
            }
          />
        ))}
      </div>

      <Button type="submit" className="w-full" disabled={loading || digits.join('').length < TOTP_LENGTH}>
        {loading && <Spinner size={14} />}
        {loading ? t('auth.verifying') : t('auth.verify')}
      </Button>
      <button type="button" onClick={onBack} className="text-[13px] text-slate-500 hover:text-slate-700 transition-colors text-center">
        ← {t('auth.backToSignIn')}
      </button>
    </form>
  )
}

// ── Forgot password — request a reset link. The link is emailed (console-logged
// in dev). Always shows the same confirmation regardless of whether the email
// exists, to avoid leaking which addresses have accounts.
function ForgotPasswordForm({
  onError,
  onBack,
}: {
  onError: (msg: string) => void
  onBack: () => void
}) {
  const { t } = useTranslation()
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [sent, setSent] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    onError('')
    try {
      await api.auth.forgotPassword(email.trim())
      setSent(true)
    } catch (err) {
      onError(err instanceof Error ? err.message : t('auth.forgot.genericError'))
    } finally {
      setLoading(false)
    }
  }

  if (sent) {
    return (
      <div className="flex flex-col gap-5">
        <div>
          <p className="text-sm font-medium text-slate-900 mb-1">{t('auth.checkEmail')}</p>
          <p className="text-[13px] text-slate-500">
            <Trans
              i18nKey="auth.forgot.sentBody"
              values={{ email }}
              components={{ s: <span className="font-medium text-slate-700" /> }}
            />
          </p>
        </div>
        <button type="button" onClick={onBack} className="text-[13px] text-slate-500 hover:text-slate-700 transition-colors">
          ← {t('auth.backToSignIn')}
        </button>
      </div>
    )
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div>
        <p className="text-sm font-medium text-slate-900 mb-1">{t('auth.forgot.title')}</p>
        <p className="text-[13px] text-slate-500">{t('auth.forgot.subtitle')}</p>
      </div>
      <Field label={t('auth.workEmail')}>
        <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@club.com" className={INPUT} />
      </Field>
      <Button type="submit" className="w-full mt-1" disabled={loading || !email.trim()}>
        {loading && <Spinner size={14} />}
        {loading ? t('auth.forgot.sending') : t('auth.forgot.send')}
      </Button>
      <button type="button" onClick={onBack} className="text-[13px] text-slate-500 hover:text-slate-700 transition-colors text-center">
        ← {t('auth.backToSignIn')}
      </button>
    </form>
  )
}

// ── Sign Up ────────────────────────────────────────────────────────────────

function SignUpForm({
  onSuccess,
  onError,
  onSwitchToSignIn,
  prefillEmail,
  emailLocked,
}: {
  onSuccess: (email: string, hasSession: boolean) => void
  onError: (msg: string) => void
  onSwitchToSignIn: () => void
  /** When set (invite flow), prefills the email field. */
  prefillEmail?: string
  /** When true, the email input becomes read-only — invite emails are bound to the token. */
  emailLocked?: boolean
}) {
  const { t } = useTranslation()
  const schema = useMemo(() => makeSignUpSchema(t), [t])
  const form = useForm<SignUpData>({
    resolver: zodResolver(schema),
    ...(prefillEmail ? { defaultValues: { email: prefillEmail } } : {}),
  })

  // The invite lookup that drives `prefillEmail` is async, so the parent
  // mounts SignUpForm with prefillEmail=undefined first and the invite email
  // arrives a tick later. RHF's defaultValues only run on mount, so without
  // this sync the email field stays empty and (once emailLocked flips to
  // true) becomes a read-only blank — the user can't fill it. Using setValue
  // preserves any password the user may have typed in the meantime.
  useEffect(() => {
    if (prefillEmail) {
      form.setValue('email', prefillEmail, { shouldValidate: true })
    }
  }, [prefillEmail, form])

  const onSubmit = async (data: SignUpData) => {
    onError('')
    const { data: result, error } = await supabase.auth.signUp({
      email: data.email,
      password: data.password,
    })
    if (error) { onError(error.message); return }
    onSuccess(data.email, !!result.session)
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
      <Field label={t('auth.workEmail')} error={form.formState.errors.email?.message}>
        <input
          type="email"
          placeholder="you@club.com"
          {...form.register('email')}
          readOnly={emailLocked}
          className={INPUT + (emailLocked ? ' bg-slate-50 text-slate-500 cursor-not-allowed' : '')}
        />
      </Field>
      <Field
        label={t('auth.password')}
        helper={t('auth.signup.passwordHelper')}
        error={form.formState.errors.password?.message}
      >
        <input type="password" placeholder="••••••••" {...form.register('password')} className={INPUT} />
      </Field>
      <Field label={t('auth.signup.confirmPassword')} error={form.formState.errors.confirmPassword?.message}>
        <input type="password" placeholder="••••••••" {...form.register('confirmPassword')} className={INPUT} />
      </Field>
      <Button type="submit" className="w-full mt-2" disabled={form.formState.isSubmitting}>
        {form.formState.isSubmitting && <Spinner size={14} />}
        {form.formState.isSubmitting ? t('auth.signup.creating') : t('auth.signup.create')}
      </Button>
      <p className="text-center text-[13px] text-slate-500 mt-1">
        {t('auth.signup.haveAccount')}{' '}
        <button type="button" onClick={onSwitchToSignIn} className="text-violet-600 hover:text-violet-700 font-medium">
          {t('auth.signup.signIn')}
        </button>
      </p>
    </form>
  )
}

// ── OTP Verification ───────────────────────────────────────────────────────

const OTP_LENGTH = 8

function OTPForm({
  email,
  onSuccess,
  onError,
  onBack,
}: {
  email: string
  onSuccess: () => void
  onError: (msg: string) => void
  onBack: () => void
}) {
  const { t } = useTranslation()
  const [digits, setDigits] = useState<string[]>(Array(OTP_LENGTH).fill(''))
  const [loading, setLoading] = useState(false)
  const [resendCooldown, setResendCooldown] = useState(0)
  const inputs = useRef<Array<HTMLInputElement | null>>([])

  useEffect(() => {
    inputs.current[0]?.focus()
  }, [])

  useEffect(() => {
    if (resendCooldown <= 0) return
    const t = setTimeout(() => setResendCooldown((c) => c - 1), 1000)
    return () => clearTimeout(t)
  }, [resendCooldown])

  const handleChange = (i: number, val: string) => {
    const digit = val.replace(/\D/g, '').slice(-1)
    const next = [...digits]
    next[i] = digit
    setDigits(next)
    if (digit && i < OTP_LENGTH - 1) inputs.current[i + 1]?.focus()
    // auto-submit when last digit is filled
    if (digit && i === OTP_LENGTH - 1) {
      const code = [...next].join('')
      if (code.length === OTP_LENGTH) void verify(code)
    }
  }

  const handleKeyDown = (i: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !digits[i] && i > 0) {
      inputs.current[i - 1]?.focus()
    }
  }

  const handlePaste = (e: React.ClipboardEvent) => {
    const text = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, OTP_LENGTH)
    if (!text) return
    e.preventDefault()
    const next = Array(OTP_LENGTH).fill('')
    text.split('').forEach((c, idx) => { next[idx] = c })
    setDigits(next)
    const focusIdx = Math.min(text.length, OTP_LENGTH - 1)
    inputs.current[focusIdx]?.focus()
    if (text.length === OTP_LENGTH) void verify(text)
  }

  const verify = async (code: string) => {
    setLoading(true)
    onError('')
    const { error } = await supabase.auth.verifyOtp({ email, token: code, type: 'signup' })
    setLoading(false)
    if (error) {
      onError(t('auth.otp.invalidCode'))
      setDigits(Array(OTP_LENGTH).fill(''))
      inputs.current[0]?.focus()
      return
    }
    onSuccess()
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const code = digits.join('')
    if (code.length === OTP_LENGTH) void verify(code)
  }

  const resend = async () => {
    onError('')
    const { error } = await supabase.auth.resend({ type: 'signup', email })
    if (error) { onError(error.message); return }
    setResendCooldown(60)
    setDigits(Array(OTP_LENGTH).fill(''))
    inputs.current[0]?.focus()
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-5">
      <div>
        <p className="text-sm font-medium text-slate-900 mb-1">{t('auth.checkEmail')}</p>
        <p className="text-[13px] text-slate-500">
          <Trans
            i18nKey="auth.otp.body"
            values={{ length: OTP_LENGTH, email }}
            components={{ s: <span className="font-medium text-slate-700" /> }}
          />
        </p>
      </div>

      {/* Cells sized to fit 8 digits inside the 420px card with 4+4 grouping
          for readability. Math: 8 × w-10 (40px) + 6 × gap-1 (4px small gaps)
          + ml-3 (12px) on the 5th cell = 356px, comfortably under the 364px
          inner width. */}
      <div className="flex gap-1 justify-center" onPaste={handlePaste}>
        {digits.map((d, i) => (
          <input
            key={i}
            ref={(el) => { inputs.current[i] = el }}
            type="text"
            inputMode="numeric"
            maxLength={1}
            value={d}
            onChange={(e) => handleChange(i, e.target.value)}
            onKeyDown={(e) => handleKeyDown(i, e)}
            className={
              'w-10 h-12 text-center text-lg font-semibold text-slate-900 rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent transition-colors num' +
              (i === OTP_LENGTH / 2 ? ' ml-3' : '')
            }
          />
        ))}
      </div>

      <Button type="submit" className="w-full" disabled={loading || digits.join('').length < OTP_LENGTH}>
        {loading && <Spinner size={14} />}
        {loading ? t('auth.verifying') : t('auth.verify')}
      </Button>

      <div className="flex items-center justify-between text-[13px] text-slate-500">
        <button type="button" onClick={onBack} className="hover:text-slate-700 transition-colors">
          ← {t('auth.back')}
        </button>
        {resendCooldown > 0 ? (
          <span className="text-slate-400">{t('auth.otp.resendIn', { n: resendCooldown })}</span>
        ) : (
          <button type="button" onClick={resend} className="text-violet-600 hover:text-violet-700 font-medium transition-colors">
            {t('auth.otp.resend')}
          </button>
        )}
      </div>
    </form>
  )
}

// ── Field wrapper ──────────────────────────────────────────────────────────

function Field({
  label,
  helper,
  error,
  children,
}: {
  label: string
  helper?: string
  error?: string
  children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="meta-label block mb-2">{label}</span>
      {children}
      {error ? (
        <span className="block mt-1.5 text-xs text-red-600">{error}</span>
      ) : helper ? (
        <span className="block mt-1.5 text-xs text-slate-400">{helper}</span>
      ) : null}
    </label>
  )
}
