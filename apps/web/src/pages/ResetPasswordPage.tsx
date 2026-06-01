import { useState } from 'react'
import { useSearchParams, useNavigate, Link } from 'react-router-dom'
import { api } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'

const INPUT = 'w-full px-3 py-2.5 text-sm text-slate-900 rounded-lg border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-violet-500 focus:border-transparent'

// Mirrors the backend PasswordSchema — returns the first unmet rule, or null.
function passwordIssue(pw: string): string | null {
  if (pw.length < 8) return 'Must be at least 8 characters'
  if (!/[A-Z]/.test(pw)) return 'Must contain an uppercase letter'
  if (!/[a-z]/.test(pw)) return 'Must contain a lowercase letter'
  if (!/[0-9]/.test(pw)) return 'Must contain a number'
  if (!/[^A-Za-z0-9]/.test(pw)) return 'Must contain a special character'
  return null
}

export function ResetPasswordPage() {
  const [search] = useSearchParams()
  const navigate = useNavigate()
  const token = search.get('token') ?? ''

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [done, setDone] = useState(false)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    const issue = passwordIssue(password)
    if (issue) { setError(issue); return }
    if (password !== confirm) { setError("Passwords don't match"); return }
    setLoading(true)
    try {
      await api.auth.resetPassword(token, password)
      setDone(true)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reset password')
    } finally {
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
          {!token ? (
            <div className="flex flex-col gap-4">
              <p className="text-sm font-medium text-slate-900">Invalid reset link</p>
              <p className="text-[13px] text-slate-500">
                This link is missing its token. Request a new password reset from the sign-in screen.
              </p>
              <Link to="/login" className="text-[13px] text-violet-600 hover:text-violet-700 font-medium">← Back to sign in</Link>
            </div>
          ) : done ? (
            <div className="flex flex-col gap-5">
              <div>
                <p className="text-sm font-medium text-slate-900 mb-1">Password updated</p>
                <p className="text-[13px] text-slate-500">You can now sign in with your new password.</p>
              </div>
              <Button className="w-full" onClick={() => navigate('/login')}>Go to sign in</Button>
            </div>
          ) : (
            <form onSubmit={submit} className="flex flex-col gap-4">
              <div>
                <p className="text-sm font-medium text-slate-900 mb-1">Choose a new password</p>
                <p className="text-[13px] text-slate-500">Min 8 chars · uppercase · lowercase · number · special character.</p>
              </div>

              {error && (
                <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2">
                  <p className="text-xs text-red-600">{error}</p>
                </div>
              )}

              <label className="block">
                <span className="meta-label block mb-2">New Password</span>
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" autoComplete="new-password" className={INPUT} />
              </label>
              <label className="block">
                <span className="meta-label block mb-2">Confirm New Password</span>
                <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="••••••••" autoComplete="new-password" className={INPUT} />
              </label>

              <Button type="submit" className="w-full mt-1" disabled={loading || !password || !confirm}>
                {loading && <Spinner size={14} />}
                {loading ? 'Updating…' : 'Reset password'}
              </Button>
              <Link to="/login" className="text-[13px] text-slate-500 hover:text-slate-700 text-center">← Back to sign in</Link>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
