import { useState, useRef, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { supabase } from '@/lib/supabase'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import type { InviteLookupResponse } from '@/lib/api'

// ── Schemas ────────────────────────────────────────────────────────────────

const SignInSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
})
type SignInData = z.infer<typeof SignInSchema>

const SignUpSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
  password: z.string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Must contain at least one uppercase letter')
    .regex(/[a-z]/, 'Must contain at least one lowercase letter')
    .regex(/[0-9]/, 'Must contain at least one number')
    .regex(/[^A-Za-z0-9]/, 'Must contain at least one special character'),
  confirmPassword: z.string(),
}).refine((d) => d.password === d.confirmPassword, {
  message: "Passwords don't match",
  path: ['confirmPassword'],
})
type SignUpData = z.infer<typeof SignUpSchema>

// ── Shared input style ──────────────────────────────────────────────────────

const INPUT = 'w-full px-3 py-2.5 text-sm text-slate-900 rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent'

const ROLE_LABEL: Record<string, string> = {
  cfo:               'CFO',
  sporting_director: 'Sporting Director',
  finance_analyst:   'Finance Analyst',
  admin:             'Admin',
}

// ── Root ────────────────────────────────────────────────────────────────────

export function LoginPage() {
  const navigate = useNavigate()
  const [search] = useSearchParams()
  const inviteToken = search.get('invite')

  // Default mode is signup when an invite token is present (the invitee
  // doesn't have an account yet); otherwise signin (the default landing page).
  const [mode, setMode] = useState<'signin' | 'signup'>(inviteToken ? 'signup' : 'signin')
  const [serverError, setServerError] = useState('')
  const [pendingOTP, setPendingOTP] = useState<string | null>(null)
  const [invite, setInvite] = useState<InviteLookupResponse | null>(null)
  const [inviteError, setInviteError] = useState('')

  // Look up the invite once on mount if a token is present
  useEffect(() => {
    if (!inviteToken) return
    api.invites.lookup(inviteToken)
      .then(setInvite)
      .catch((e: Error) => setInviteError(e.message))
  }, [inviteToken])

  const switchMode = (m: 'signin' | 'signup') => {
    setMode(m)
    setServerError('')
    setPendingOTP(null)
  }

  return (
    <div className="min-h-screen w-full bg-slate-50 flex items-center justify-center p-6">
      <div className="w-full max-w-[420px]">

        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <span className="inline-flex items-baseline gap-0 select-none" style={{ color: '#6d28d9', fontFamily: 'Inter', fontWeight: 700, letterSpacing: '-0.02em', fontSize: 28 }}>
            <span aria-hidden="true" className="inline-flex items-end" style={{ height: 31, marginRight: -1 }}>
              <svg width={25} height={31} viewBox="0 0 18 22" fill="none">
                <rect x="0" y="0" width="3.5" height="22" fill="#6d28d9" />
                <rect x="12.5" y="0" width="3.5" height="22" fill="#6d28d9" />
                <rect x="3.5" y="9.75" width="9" height="2.5" fill="#6d28d9" />
                <rect x="5.5" y="0" width="5" height="3.5" fill="#6d28d9" opacity="0.65" />
                <rect x="5.5" y="18.5" width="5" height="3.5" fill="#6d28d9" opacity="0.65" />
                <circle cx="8" cy="11" r="2.6" stroke="#6d28d9" strokeWidth="1" fill="none" opacity="0.6" />
              </svg>
            </span>
            <span>eadroom</span>
          </span>
          <p className="mt-3 text-sm text-slate-500 text-center">Financial compliance for professional football.</p>
        </div>

        {/* Invitation context banner — shown when ?invite=<token> resolves */}
        {invite && (
          <div className="mb-5 rounded-xl border border-violet-100 bg-violet-50/60 px-5 py-4">
            <div className="meta-label text-violet-700">Invitation to {invite.clubName}</div>
            <p className="text-[13px] text-slate-700 mt-1.5">
              You've been invited to join as <span className="font-medium">{ROLE_LABEL[invite.role] ?? invite.role}</span>. Create your account using the email <span className="num">{invite.email}</span>.
            </p>
          </div>
        )}
        {inviteError && (
          <div className="mb-5 rounded-xl border border-red-200 bg-red-50 px-5 py-4">
            <div className="meta-label text-red-700">Invitation problem</div>
            <p className="text-[13px] text-red-700 mt-1.5">{inviteError}</p>
          </div>
        )}

        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-7">
          {serverError && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2">
              <p className="text-xs text-red-600">{serverError}</p>
            </div>
          )}

          {pendingOTP ? (
            <OTPForm
              email={pendingOTP}
              onSuccess={() => navigate('/dashboard')}
              onError={setServerError}
              onBack={() => switchMode('signup')}
            />
          ) : mode === 'signin' ? (
            <SignInForm
              onSuccess={() => navigate('/dashboard')}
              onError={setServerError}
              onSwitchToSignUp={() => switchMode('signup')}
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
          Headroom is a decision-support tool. It does not constitute legal or financial advice.
        </p>
      </div>
    </div>
  )
}

// ── Sign In ────────────────────────────────────────────────────────────────

function SignInForm({
  onSuccess,
  onError,
  onSwitchToSignUp,
}: {
  onSuccess: () => void
  onError: (msg: string) => void
  onSwitchToSignUp: () => void
}) {
  const form = useForm<SignInData>({ resolver: zodResolver(SignInSchema) })

  const onSubmit = async (data: SignInData) => {
    onError('')
    const { error } = await supabase.auth.signInWithPassword(data)
    if (error) { onError(error.message); return }
    onSuccess()
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
      <Field label="Work Email" error={form.formState.errors.email?.message}>
        <input type="email" placeholder="you@club.com" {...form.register('email')} className={INPUT} />
      </Field>
      <Field label="Password" error={form.formState.errors.password?.message}>
        <input type="password" placeholder="••••••••" {...form.register('password')} className={INPUT} />
      </Field>
      <Button type="submit" className="w-full mt-2" disabled={form.formState.isSubmitting}>
        {form.formState.isSubmitting && <Spinner size={14} />}
        {form.formState.isSubmitting ? 'Signing in…' : 'Sign In'}
      </Button>
      <p className="text-center text-[13px] text-slate-500 mt-1">
        Don't have an account?{' '}
        <button type="button" onClick={onSwitchToSignUp} className="text-violet-600 hover:text-violet-700 font-medium">
          Create one
        </button>
      </p>
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
  const form = useForm<SignUpData>({
    resolver: zodResolver(SignUpSchema),
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
      <Field label="Work Email" error={form.formState.errors.email?.message}>
        <input
          type="email"
          placeholder="you@club.com"
          {...form.register('email')}
          readOnly={emailLocked}
          className={INPUT + (emailLocked ? ' bg-slate-50 text-slate-500 cursor-not-allowed' : '')}
        />
      </Field>
      <Field
        label="Password"
        helper="Min 8 chars · uppercase · lowercase · number · special character"
        error={form.formState.errors.password?.message}
      >
        <input type="password" placeholder="••••••••" {...form.register('password')} className={INPUT} />
      </Field>
      <Field label="Confirm Password" error={form.formState.errors.confirmPassword?.message}>
        <input type="password" placeholder="••••••••" {...form.register('confirmPassword')} className={INPUT} />
      </Field>
      <Button type="submit" className="w-full mt-2" disabled={form.formState.isSubmitting}>
        {form.formState.isSubmitting && <Spinner size={14} />}
        {form.formState.isSubmitting ? 'Creating account…' : 'Create Account'}
      </Button>
      <p className="text-center text-[13px] text-slate-500 mt-1">
        Already have an account?{' '}
        <button type="button" onClick={onSwitchToSignIn} className="text-violet-600 hover:text-violet-700 font-medium">
          Sign in
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
      onError('Invalid or expired code. Please try again.')
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
        <p className="text-sm font-medium text-slate-900 mb-1">Check your email</p>
        <p className="text-[13px] text-slate-500">
          We sent an {OTP_LENGTH}-digit code to <span className="font-medium text-slate-700">{email}</span>
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
        {loading ? 'Verifying…' : 'Verify'}
      </Button>

      <div className="flex items-center justify-between text-[13px] text-slate-500">
        <button type="button" onClick={onBack} className="hover:text-slate-700 transition-colors">
          ← Back
        </button>
        {resendCooldown > 0 ? (
          <span className="text-slate-400">Resend in {resendCooldown}s</span>
        ) : (
          <button type="button" onClick={resend} className="text-violet-600 hover:text-violet-700 font-medium transition-colors">
            Resend code
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
