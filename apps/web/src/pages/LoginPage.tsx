import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'

// ── Schemas ────────────────────────────────────────────────────────────────

const SignInSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
})
type SignInData = z.infer<typeof SignInSchema>

const SignUpSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  confirmPassword: z.string(),
}).refine((d) => d.password === d.confirmPassword, {
  message: "Passwords don't match",
  path: ['confirmPassword'],
})
type SignUpData = z.infer<typeof SignUpSchema>

const MagicLinkSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
})
type MagicLinkData = z.infer<typeof MagicLinkSchema>

// ── Shared input style ──────────────────────────────────────────────────────

const INPUT = 'w-full px-3 py-2.5 text-sm text-slate-900 rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent'

// ── Root ────────────────────────────────────────────────────────────────────

export function LoginPage() {
  const navigate = useNavigate()
  const [tab, setTab] = useState<'password' | 'magic'>('password')
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [serverError, setServerError] = useState('')
  const [magicSent, setMagicSent] = useState(false)
  const [signUpDone, setSignUpDone] = useState(false)

  const switchTab = (t: 'password' | 'magic') => {
    setTab(t)
    setServerError('')
  }

  const switchMode = (m: 'signin' | 'signup') => {
    setMode(m)
    setServerError('')
  }

  return (
    <div className="min-h-screen w-full bg-slate-50 flex items-center justify-center p-6">
      <div className="w-full max-w-[420px]">

        {/* Logo — football pitch H, matched to the in-app sidebar mark */}
        <div className="flex flex-col items-center mb-8">
          <span className="inline-flex items-baseline gap-0 select-none" style={{ color: '#6d28d9', fontFamily: 'Inter', fontWeight: 700, letterSpacing: '-0.02em', fontSize: 28 }}>
            <span aria-hidden="true" className="inline-flex items-end" style={{ height: 31 }}>
              <svg width={25} height={31} viewBox="0 0 18 22" fill="none">
                {/* Left post — sideline */}
                <rect x="0" y="0" width="3.5" height="22" fill="#6d28d9" />
                {/* Right post — sideline */}
                <rect x="12.5" y="0" width="3.5" height="22" fill="#6d28d9" />
                {/* Halfway line */}
                <rect x="3.5" y="9.75" width="9" height="2.5" fill="#6d28d9" />
                {/* Top goal */}
                <rect x="5.5" y="0" width="5" height="3.5" fill="#6d28d9" opacity="0.65" />
                {/* Bottom goal */}
                <rect x="5.5" y="18.5" width="5" height="3.5" fill="#6d28d9" opacity="0.65" />
                {/* Center circle */}
                <circle cx="8" cy="11" r="2.6" stroke="#6d28d9" strokeWidth="1" fill="none" opacity="0.6" />
              </svg>
            </span>
            <span>eadroom</span>
          </span>
          <p className="mt-3 text-sm text-slate-500 text-center">Financial compliance for professional football.</p>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-7">
          {/* Tabs */}
          <div className="flex items-center gap-1 border-b border-slate-200 mb-6 -mt-1">
            <button
              onClick={() => switchTab('password')}
              className={`relative px-1 pb-3 mr-5 text-sm font-medium transition-colors ${
                tab === 'password' ? 'text-slate-900' : 'text-slate-400 hover:text-slate-700'
              }`}
            >
              Email &amp; Password
              {tab === 'password' && <span className="absolute -bottom-px left-0 right-0 h-[2px] bg-violet-600 rounded-full" />}
            </button>
            <button
              onClick={() => switchTab('magic')}
              className={`relative px-1 pb-3 text-sm font-medium transition-colors ${
                tab === 'magic' ? 'text-slate-900' : 'text-slate-400 hover:text-slate-700'
              }`}
            >
              Magic Link
              {tab === 'magic' && <span className="absolute -bottom-px left-0 right-0 h-[2px] bg-violet-600 rounded-full" />}
            </button>
          </div>

          {serverError && (
            <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2">
              <p className="text-xs text-red-600">{serverError}</p>
            </div>
          )}

          {tab === 'password' ? (
            mode === 'signin' ? (
              <SignInForm
                onSuccess={() => navigate('/simulator')}
                onError={setServerError}
                onSwitchToSignUp={() => switchMode('signup')}
              />
            ) : signUpDone ? (
              <SignUpConfirmation onSwitchToSignIn={() => { setSignUpDone(false); switchMode('signin') }} />
            ) : (
              <SignUpForm
                onSuccess={(hasSession) => {
                  if (hasSession) navigate('/simulator')
                  else setSignUpDone(true)
                }}
                onError={setServerError}
                onSwitchToSignIn={() => switchMode('signin')}
              />
            )
          ) : magicSent ? (
            <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3">
              <p className="text-sm text-green-700 font-medium">Check your email</p>
              <p className="text-xs text-slate-500 mt-1">We sent a magic link to your email. Click it to sign in.</p>
            </div>
          ) : (
            <MagicLinkForm onSuccess={() => setMagicSent(true)} onError={setServerError} />
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
}: {
  onSuccess: (hasSession: boolean) => void
  onError: (msg: string) => void
  onSwitchToSignIn: () => void
}) {
  const form = useForm<SignUpData>({ resolver: zodResolver(SignUpSchema) })

  const onSubmit = async (data: SignUpData) => {
    onError('')
    const { data: result, error } = await supabase.auth.signUp({
      email: data.email,
      password: data.password,
      options: { emailRedirectTo: `${window.location.origin}/simulator` },
    })
    if (error) { onError(error.message); return }
    // If Supabase email confirmation is disabled, a session is returned immediately.
    onSuccess(!!result.session)
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
      <Field label="Work Email" error={form.formState.errors.email?.message}>
        <input type="email" placeholder="you@club.com" {...form.register('email')} className={INPUT} />
      </Field>
      <Field label="Password" helper="Minimum 8 characters" error={form.formState.errors.password?.message}>
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

// ── Sign-up confirmation (when email confirmation is required) ──────────────

function SignUpConfirmation({ onSwitchToSignIn }: { onSwitchToSignIn: () => void }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border border-green-200 bg-green-50 px-4 py-3">
        <p className="text-sm text-green-700 font-medium">Check your email</p>
        <p className="text-xs text-slate-500 mt-1">
          We sent a confirmation link to your email address. Click it to activate your account, then sign in.
        </p>
      </div>
      <p className="text-center text-[13px] text-slate-500">
        <button type="button" onClick={onSwitchToSignIn} className="text-violet-600 hover:text-violet-700 font-medium">
          Back to Sign In
        </button>
      </p>
    </div>
  )
}

// ── Magic Link ─────────────────────────────────────────────────────────────

function MagicLinkForm({
  onSuccess,
  onError,
}: {
  onSuccess: () => void
  onError: (msg: string) => void
}) {
  const form = useForm<MagicLinkData>({ resolver: zodResolver(MagicLinkSchema) })

  const onSubmit = async (data: MagicLinkData) => {
    onError('')
    const { error } = await supabase.auth.signInWithOtp({
      email: data.email,
      options: { emailRedirectTo: `${window.location.origin}/simulator` },
    })
    if (error) { onError(error.message); return }
    onSuccess()
  }

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-4">
      <p className="text-[13px] text-slate-500 -mt-1">We'll email you a single-use link. No password needed.</p>
      <Field label="Work Email" error={form.formState.errors.email?.message}>
        <input type="email" placeholder="you@club.com" {...form.register('email')} className={INPUT} />
      </Field>
      <Button type="submit" className="w-full" disabled={form.formState.isSubmitting}>
        {form.formState.isSubmitting && <Spinner size={14} />}
        {form.formState.isSubmitting ? 'Sending…' : 'Send Magic Link'}
      </Button>
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
