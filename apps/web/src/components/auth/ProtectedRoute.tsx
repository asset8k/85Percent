import { useEffect, useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '@/stores/auth'
import { supabase } from '@/lib/supabase'
import { api } from '@/lib/api'
import { useClubStore } from '@/stores/club'
import { Spinner } from '@/components/ui/spinner'

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { session, setSession } = useAuthStore()
  const { clubName, setClub, setFinancials } = useClubStore()
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

    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession)
      setInitialized(true)
    })

    return () => listener.subscription.unsubscribe()
  }, [setSession])

  useEffect(() => {
    if (session && !clubName) {
      Promise.all([api.club.get(), api.club.getFinancials('2026-27').catch(() => null)]).then(
        ([club, financials]) => {
          setClub(club.id, club.name, club.leagueId)
          if (financials) setFinancials(financials)
        }
      )
    }
  }, [session, clubName, setClub, setFinancials])

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
