import { useEffect, useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '@/stores/auth'
import { supabase } from '@/lib/supabase'
import { api } from '@/lib/api'
import { useClubStore } from '@/stores/club'
import { useSeasonStore, seasonKey } from '@/stores/season'
import { useNotificationsStore } from '@/stores/notifications'
import { queryClient } from '@/lib/queryClient'
import { Spinner } from '@/components/ui/spinner'

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { session, setSession } = useAuthStore()
  const { clubId, setClub, setFinancials } = useClubStore()
  const seasonStartYear = useSeasonStore((s) => s.startYear)
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
      //
      // Crucially this resets BOTH the financials value AND its `financialsLoaded`
      // flag: leaving the flag true while the value is null makes the next login
      // render the Dashboard's "set up your club" empty-state (the gate thinks the
      // first load already settled) for the few seconds until the new club +
      // financials arrive. We also clear the TanStack Query cache so the next user
      // doesn't momentarily see the previous user's cached roster/scenarios — and
      // so those queries report `isPending` again, holding their skeletons.
      if (event === 'SIGNED_OUT') {
        useClubStore.setState({
          clubId: null,
          clubName: null,
          leagueId: null,
          financials: null,
          financialsLoaded: false,
          scenarios: [],
          scenariosLoaded: false,
        })
        useNotificationsStore.getState().reset()
        queryClient.clear()
      }
    })

    return () => listener.subscription.unsubscribe()
  }, [setSession])

  useEffect(() => {
    // Fetch when there's a session AND the club has not been hydrated for THIS user.
    // Using clubId (not clubName) — clubName can be set by an optimistic update during signin.
    if (session && !clubId) {
      // Logged in but no club known yet (fresh login / switched user). A stale
      // `financialsLoaded` flag from a previous session would let the Dashboard
      // fall through to its "set up your club" empty-state during this bootstrap
      // window. Force it false so the skeleton holds until the real club +
      // financials land. Runs only here (clubId is set the rest of the time), so
      // it never interferes with season switches.
      if (useClubStore.getState().financialsLoaded) {
        useClubStore.setState({ financialsLoaded: false })
      }
      api.club.get()
        .then((club) => setClub(club.id, club.name, club.leagueId, club.logoUrl, club.baseCurrency))
        .catch((err) => {
          // Don't leave the user stuck on a blank screen; surface the failure to the console
          // and let them try again. A hard club failure means the API is unreachable.
          console.error('Failed to load club for authenticated user:', err)
        })
    }
  }, [session, clubId, setClub])

  // Financials are season-scoped: (re)load them whenever the club is known or the
  // active season changes. A season with no configured row resolves to null, and
  // the Dashboard renders its "set up your financials" empty-state for it.
  //
  // Keyed on the user id, NOT the whole `session` object: Supabase fires several
  // auth events on a page load (INITIAL_SESSION, SIGNED_IN, TOKEN_REFRESHED),
  // each handing us a fresh session reference. Depending on `session` would
  // refetch financials on every one of them, churning the store and flashing the
  // TopBar SCR pill. The user id is stable across those events.
  const userId = session?.user?.id ?? null
  useEffect(() => {
    if (!userId || !clubId) return
    let cancelled = false
    api.club.getFinancials(seasonKey(seasonStartYear))
      .then((f) => { if (!cancelled) setFinancials(f) })
      .catch(() => { if (!cancelled) setFinancials(null) })
    return () => { cancelled = true }
  }, [userId, clubId, seasonStartYear, setFinancials])

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
