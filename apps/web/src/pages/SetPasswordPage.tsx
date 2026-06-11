import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate, Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { passwordIssue } from '@/lib/password'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'

const INPUT = 'w-full px-3 py-2.5 text-sm text-slate-900 rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent'

/**
 * SetPasswordPage — the destination for an admin-provisioned Supabase invite
 * (auth.admin.inviteUserByEmail → redirectTo `${APP_URL}/set-password`).
 *
 * The invite link carries the session tokens in the URL hash; the shared
 * `supabase` client has `detectSessionInUrl` on (default), so it exchanges them
 * for a session shortly after load. We wait for that session, then let the
 * invitee choose a password via `supabase.auth.updateUser`. On success we send
 * them to the dashboard — the API auto-provisions a fresh workspace for the new
 * auth user on their first authenticated request.
 *
 * This is the Supabase-native flow, distinct from the custom token-based
 * ResetPasswordPage (which goes through our own API).
 */
export function SetPasswordPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()

  // checking → ready (session established) | invalid (no/expired link); done after save.
  const [phase, setPhase] = useState<'checking' | 'ready' | 'invalid' | 'done'>('checking')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    // The session can arrive either synchronously (already parsed) or via the
    // auth event once detectSessionInUrl finishes exchanging the hash tokens.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) setPhase('ready')
    })
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setPhase('ready')
    })
    // If no session materialises shortly, the link is missing, used, or expired.
    const timer = setTimeout(() => {
      setPhase((p) => (p === 'checking' ? 'invalid' : p))
    }, 1500)
    return () => {
      sub.subscription.unsubscribe()
      clearTimeout(timer)
    }
  }, [])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    const issue = passwordIssue(password, t)
    if (issue) { setError(issue); return }
    if (password !== confirm) { setError(t('validation.passwordMatch')); return }
    setLoading(true)
    try {
      const { error: updErr } = await supabase.auth.updateUser({ password })
      if (updErr) throw new Error(updErr.message)
      setPhase('done')
      navigate('/') // dashboard — the API auto-provisions the workspace on first call
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not set your password. Please try again.')
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen w-full bg-slate-50 flex items-center justify-center p-6">
      <div className="w-full max-w-[420px]">
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
        </div>

        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-7">
          {phase === 'checking' ? (
            <div className="flex flex-col items-center gap-3 py-4">
              <Spinner size={20} />
              <p className="text-[13px] text-slate-500">Verifying your invitation…</p>
            </div>
          ) : phase === 'invalid' ? (
            <div className="flex flex-col gap-4">
              <p className="text-sm font-medium text-slate-900">This invitation link is invalid or has expired</p>
              <p className="text-[13px] text-slate-500">
                Ask your 85Percent contact to send a fresh invite, then open the link from that email.
              </p>
              <Link to="/login" className="text-[13px] text-violet-600 hover:text-violet-700 font-medium">← {t('auth.backToSignIn')}</Link>
            </div>
          ) : (
            <form onSubmit={submit} className="flex flex-col gap-4">
              <div>
                <p className="text-sm font-medium text-slate-900 mb-1">Set Your Secure Password</p>
                <p className="text-[13px] text-slate-500">Choose a password to finish setting up your account.</p>
              </div>

              {error && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2">
                  <p className="text-xs text-red-600">{error}</p>
                </div>
              )}

              <label className="block">
                <span className="meta-label block mb-2">New password</span>
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" autoComplete="new-password" className={INPUT} />
              </label>
              <label className="block">
                <span className="meta-label block mb-2">Confirm password</span>
                <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="••••••••" autoComplete="new-password" className={INPUT} />
              </label>

              <Button type="submit" className="w-full mt-1" disabled={loading || !password || !confirm}>
                {loading && <Spinner size={14} />}
                {loading ? 'Setting password…' : 'Set password'}
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
