import { useEffect, useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '@/stores/auth'
import { supabase } from '@/lib/supabase'
import { api } from '@/lib/api'
import { useClubStore } from '@/stores/club'
import { Spinner } from '@/components/ui/spinner'

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { session, setSession } = useAuthStore()
  const { clubId, setClub, setFinancials } = useClubStore()
  const location = useLocation()

  // `initialized` becomes true once we've confirmed the session state from Supabase.
  // Until then we show nothing — preventing a redirect on the first render before
  // getSession() has resolved (the "needs two logins" bug).
  const [initialized, setInitialized] = useState(false)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setInitialized(true)
    })

    const { data: listener } = supabase.auth.onAuthStateChange((event, newSession) => {
      setSession(newSession)
      setInitialized(true)
      // Clear per-club state on any sign-out (button, token expiry, or third-party revoke)
      // so a re-signin as a different user doesn't see the previous user's club + sims.
      if (event === 'SIGNED_OUT') {
        useClubStore.setState({
          clubId: null,
          clubName: null,
          leagueId: null,
          financials: null,
          scenarios: [],
        })
      }
    })

    return () => listener.subscription.unsubscribe()
  }, [setSession])

  useEffect(() => {
    // Fetch when there's a session AND the club has not been hydrated for THIS user.
    // Using clubId (not clubName) — clubName can be set by an optimistic update during signin.
    if (session && !clubId) {
      Promise.all([api.club.get(), api.club.getFinancials('2026-27').catch(() => null)])
        .then(([club, financials]) => {
          setClub(club.id, club.name, club.leagueId)
          if (financials) setFinancials(financials)
        })
        .catch((err) => {
          // Don't leave the user stuck on a blank screen; surface the failure to the console
          // and let them try again. They can still navigate to /setup manually if financials
          // are the issue, but a hard club failure means the API is unreachable.
          console.error('Failed to load club for authenticated user:', err)
        })
    }
  }, [session, clubId, setClub, setFinancials])

  // Still waiting for the initial session check — render nothing rather than
  // bouncing the user to /login prematurely.
  if (!initialized) return (
    <div className="min-h-screen flex items-center justify-center bg-white">
      <Spinner size={32} />
    </div>
  )

  if (!session) {
    return <Navigate to="/login" state={{ from: location }} replace />
  }

  return <>{children}</>
}
