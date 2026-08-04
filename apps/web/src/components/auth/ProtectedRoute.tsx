import { useEffect, useRef, useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuthStore } from '@/stores/auth'
import { supabase } from '@/lib/supabase'
import { api } from '@/lib/api'
import { useClubStore } from '@/stores/club'
import { useSeasonStore, seasonKey } from '@/stores/season'
import { useNotificationsStore } from '@/stores/notifications'
import { queryClient } from '@/lib/queryClient'
import { Spinner } from '@/components/ui/spinner'
import { queryKeys } from '@/lib/queries'

export function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { session, setSession } = useAuthStore()
  const {
    clubId,
    bootstrapStatus,
    financialsRequestVersion,
    setClub,
    setFinancials,
    setFinancialsLoading,
    setFinancialsError,
    setBootstrapStatus,
  } = useClubStore()
  const seasonStartYear = useSeasonStore((s) => s.startYear)
  const location = useLocation()

  // `initialized` becomes true once we've confirmed the session state from Supabase.
  // Until then we show nothing — preventing a redirect on the first render before
  // getSession() has resolved (the "needs two logins" bug).
  const [initialized, setInitialized] = useState(false)
  const [bootstrapAttempt, setBootstrapAttempt] = useState(0)
  const bootstrappedUserId = useRef<string | null>(null)

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
          bootstrapStatus: 'idle',
          clubId: null,
          clubName: null,
          leagueId: null,
          financials: null,
          financialsLoaded: false,
          financialsStatus: 'idle',
          scenarios: [],
          scenariosLoaded: false,
          scenariosStatus: 'idle',
        })
        useNotificationsStore.getState().reset()
        queryClient.clear()
      }
    })

    return () => listener.subscription.unsubscribe()
  }, [setSession])

  useEffect(() => {
    const userId = session?.user?.id
    if (!userId) {
      bootstrappedUserId.current = null
      return
    }
    if (bootstrappedUserId.current === userId) return

    bootstrappedUserId.current = userId
    setBootstrapStatus('loading')
    useClubStore.setState({
      financialsLoaded: false,
      financialsStatus: 'idle',
      scenariosLoaded: false,
      scenariosStatus: 'idle',
    })

    // Fetch identity through the shared QueryClient cache and the workspace club
    // together. The mounted shell keeps these values localized as placeholders
    // until both resolve, then builds navigation once from stable capabilities.
    Promise.all([
      queryClient.fetchQuery({ queryKey: queryKeys.me, queryFn: () => api.me.get() }),
      api.club.get(),
    ])
      .then(([, club]) => {
        // React Strict Mode replays effects in development. Do not discard this
        // result merely because that replay ran its cleanup; only ignore a
        // response if the authenticated user actually changed in the meantime.
        if (bootstrappedUserId.current !== userId) return
        setClub(club.id, club.name, club.leagueId, club.logoUrl, club.baseCurrency)
        setBootstrapStatus('ready')
      })
      .catch((err) => {
        if (bootstrappedUserId.current !== userId) return
        console.error('Failed to bootstrap workspace:', err)
        setBootstrapStatus('error')
      })
  }, [bootstrapAttempt, session?.user?.id, setBootstrapStatus, setClub])

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
    setFinancialsLoading()
    api.club.getFinancials(seasonKey(seasonStartYear))
      .then((f) => { if (!cancelled) setFinancials(f) })
      .catch(() => { if (!cancelled) setFinancialsError() })
    return () => { cancelled = true }
  }, [userId, clubId, seasonStartYear, financialsRequestVersion, setFinancials, setFinancialsError, setFinancialsLoading])

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

  if (bootstrapStatus === 'error') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-3 bg-white px-6 text-center">
        <p className="text-[15px] font-medium text-slate-900">Unable to load this workspace.</p>
        <p className="text-[13px] text-slate-500">Check your connection and try again.</p>
        <button
          type="button"
          onClick={() => {
            bootstrappedUserId.current = null
            setBootstrapStatus('idle')
            setBootstrapAttempt((attempt) => attempt + 1)
          }}
          className="mt-2 rounded-lg bg-violet-600 px-3.5 py-2 text-[13px] font-medium text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2"
        >
          Try again
        </button>
      </div>
    )
  }

  return <>{children}</>
}
