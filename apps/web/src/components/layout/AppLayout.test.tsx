/**
 * Onboarding UX regression cover: the TopBar "CURRENT SCR" widget and the
 * Step 1 (choose a club) / Step 2 (set up Financials) coach-marks.
 *
 * Before this fix, a brand-new club with no `club_financials` row yet hit the
 * same generic error path as a genuine backend failure — `GET
 * /club/financials` 404s, `apiFetch` throws an `ApiError` for any non-OK
 * response, and `ProtectedRoute` funneled every rejection into
 * `setFinancialsError()`. That made the TopBar pill show red
 * "Unavailable"/"Retry" during completely normal onboarding, before the user
 * had ever had a chance to enter Financials.
 *
 * These tests assert the distinction at the real network boundary — what
 * `GET /club/financials` returns — rather than trusting the store wiring to
 * be spelled correctly.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, cleanup, fireEvent } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

// jsdom has no IntersectionObserver — framer-motion's useInView (used by the
// TopBar's AnimatedNumber, which only mounts in the "ready" SCR state) needs
// one. This is an environment gap, not something to reset between tests.
if (typeof globalThis.IntersectionObserver === 'undefined') {
  class MockIntersectionObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  // @ts-expect-error -- minimal test polyfill, not a spec-complete implementation
  globalThis.IntersectionObserver = MockIntersectionObserver
}

const hoisted = vi.hoisted(() => ({
  session: null as { access_token: string; user: { id: string; email: string } } | null,
}))

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: hoisted.session } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => {} } } }),
    },
  },
}))

import { ProtectedRoute } from '@/components/auth/ProtectedRoute'
import { AppLayout } from './AppLayout'
import { queryClient } from '@/lib/queryClient'
import { useClubStore } from '@/stores/club'
import { useAuthStore } from '@/stores/auth'

// ---------------------------------------------------------------------------
// Network double
// ---------------------------------------------------------------------------

interface FetchOptions {
  financialsStatus: 200 | 404 | 500
  playerCount: number
}

function installFetch({ financialsStatus, playerCount }: FetchOptions) {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString()

    if (url === '/api/me') {
      return json({
        id: 'user-1', title: null, canEditRoster: true, canEditScenarios: true,
        isWorkspaceAdmin: true, fullName: 'Club CFO', email: 'cfo@club.com',
        isTotpEnabled: false, aiBalanceUsd: 5,
      })
    }
    if (url === '/api/club') {
      return json({
        id: 'club-1', name: 'Test FC', shortName: 'TFC',
        leagueId: 'efl-championship', logoUrl: null, baseCurrency: 'GBP',
      })
    }
    if (url.startsWith('/api/club/financials')) {
      if (financialsStatus === 404) return json({ error: 'No financials found for this season' }, 404)
      if (financialsStatus === 500) return json({ error: 'Failed to load financials' }, 500)
      return json({
        id: 'fin-1', clubId: 'club-1', season: '2026-27',
        footballRelatedRevenue: 100_000_000, currentSquadCosts: 80_000_000,
        contractCount: playerCount, squadCostsMode: 'derived', derivedSquadCosts: 80_000_000,
        manualSquadCosts: null, currentAllowanceRatio: 0.3,
        ownerEquityUsed1yr: null, ownerEquityUsed3yr: null,
      })
    }
    if (url.startsWith('/api/roster/manager')) return json({ manager: null })
    if (url.startsWith('/api/roster')) {
      const players = Array.from({ length: playerCount }, (_, i) => ({ id: `p${i}` }))
      return json({ players })
    }
    if (url.startsWith('/api/league-table')) {
      return json({
        leagueId: 'efl-championship', competition: 'Championship', season: '2026-27',
        source: 'fallback', fetchedAt: new Date(0).toISOString(), standings: [],
      })
    }
    if (url.startsWith('/api/scenarios')) return json({ scenarios: [], total: 0, page: 1, limit: 100 })
    if (url.startsWith('/api/chat/sessions')) return json({ sessions: [] })
    if (url.startsWith('/api/notifications')) return json({ notifications: [], unreadCount: 0 })

    // Anything else (chat balance re-checks, notification refresh, etc.) is
    // silently handled by its caller on failure — a generic empty 200 keeps
    // those components quiet without asserting on them.
    return json({})
  }))
}

function renderApp(initialPath = '/dashboard') {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/login" element={<div data-testid="login">sign in</div>} />
          <Route
            element={
              <ProtectedRoute>
                <AppLayout />
              </ProtectedRoute>
            }
          >
            <Route path="/dashboard" element={<div data-testid="page">Dashboard</div>} />
            <Route path="/financials" element={<div data-testid="page">Financials</div>} />
          </Route>
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

async function bootstrap(options: FetchOptions) {
  installFetch(options)
  renderApp()
  await waitFor(() => expect(screen.getByTestId('page')).toBeTruthy())
  // Let the financials + roster + scenarios effects settle.
  await waitFor(() => expect(useClubStore.getState().financialsStatus).not.toBe('idle'))
  await waitFor(() => expect(useClubStore.getState().financialsStatus).not.toBe('loading'))
}

describe('onboarding UX: TopBar SCR widget + Step 1/2 coach-marks', () => {
  beforeEach(() => {
    localStorage.clear()
    queryClient.clear()
    hoisted.session = { access_token: 'token-1', user: { id: 'user-1', email: 'cfo@club.com' } }
    useClubStore.setState({
      bootstrapStatus: 'idle', clubId: null, clubName: null, leagueId: null,
      financials: null, financialsLoaded: false, financialsStatus: 'idle',
      scenarios: [], scenariosLoaded: false, scenariosStatus: 'idle',
    })
    useAuthStore.setState({ session: null, user: null, loading: true })
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  it('scenario 1: brand-new user with no squad — Step 1 club nudge shows, SCR is not an error', async () => {
    await bootstrap({ financialsStatus: 404, playerCount: 0 })

    await waitFor(() => expect(screen.getByText(/Start here/i)).toBeTruthy())
    expect(screen.queryByText(/Next: Financials/i)).toBeNull()

    expect(screen.queryByText('Unavailable')).toBeNull()
    expect(screen.queryByText('Retry')).toBeNull()
    await waitFor(() => expect(screen.getByText(/Set up financials/i)).toBeTruthy())
  })

  it('scenario 2: club selected, Financials missing — Step 2 nudge shows, SCR is a neutral setup state', async () => {
    await bootstrap({ financialsStatus: 404, playerCount: 20 })

    expect(screen.queryByText(/Start here/i)).toBeNull()
    await waitFor(() => expect(screen.getByText(/Next: Financials/i)).toBeTruthy())
    expect(screen.getByText(/Add your club's revenue and allowance/i)).toBeTruthy()

    expect(screen.queryByText('Unavailable')).toBeNull()
    expect(screen.queryByText('Retry')).toBeNull()
    expect(useClubStore.getState().financialsStatus).toBe('ready')
    expect(useClubStore.getState().financials).toBeNull()
    // Both the coach-mark CTA and the TopBar pill read "Set up financials".
    expect(screen.getAllByText(/Set up financials/i).length).toBeGreaterThan(0)
  })

  it('scenario 3: Financials configured — Step 2 nudge disappears, SCR renders normally', async () => {
    await bootstrap({ financialsStatus: 200, playerCount: 20 })

    expect(screen.queryByText(/Next: Financials/i)).toBeNull()
    expect(screen.queryByText(/Start here/i)).toBeNull()
    expect(screen.queryByText('Unavailable')).toBeNull()

    await waitFor(() => expect(useClubStore.getState().financialsStatus).toBe('ready'))
    expect(useClubStore.getState().financials).not.toBeNull()
    // The pill renders a real SCR status once scenarios have also settled —
    // "Compliant" only appears in the ready-state badge, never in loading,
    // notConfigured or error copy.
    await waitFor(() => expect(screen.getByText('Compliant')).toBeTruthy())
  })

  it('scenario 4: Financials configured but the request genuinely fails — Unavailable/Retry still appears', async () => {
    await bootstrap({ financialsStatus: 500, playerCount: 20 })

    await waitFor(() => expect(screen.getByText('Unavailable')).toBeTruthy())
    expect(screen.getByText('Retry')).toBeTruthy()
    expect(useClubStore.getState().financialsStatus).toBe('error')
    // Never the friendly onboarding copy for a genuine failure.
    expect(screen.queryByText(/Set up financials/i)).toBeNull()
  })

  it('scenario 5: refresh — a dismissed-by-completion Step 2 does not reappear on remount', async () => {
    await bootstrap({ financialsStatus: 200, playerCount: 20 })
    expect(screen.queryByText(/Next: Financials/i)).toBeNull()

    cleanup()
    useClubStore.setState({
      bootstrapStatus: 'idle', clubId: null, clubName: null, leagueId: null,
      financials: null, financialsLoaded: false, financialsStatus: 'idle',
      scenarios: [], scenariosLoaded: false, scenariosStatus: 'idle',
    })

    // Simulate a page reload with the same (now-configured) backend state —
    // the nudge is derived from real domain state, not a client-only flag, so
    // it stays gone without any persisted "dismissed" bit to manage.
    await bootstrap({ financialsStatus: 200, playerCount: 20 })
    expect(screen.queryByText(/Next: Financials/i)).toBeNull()
  })

  it('scenario 6: clicking "Set up financials" in the SCR pill navigates to /financials', async () => {
    await bootstrap({ financialsStatus: 404, playerCount: 20 })

    const pillLink = await waitFor(() => screen.getByRole('link', { name: /Set up financials/i }))
    fireEvent.click(pillLink)

    await waitFor(() => expect(screen.getByTestId('page').textContent).toBe('Financials'))
  })

  it('scenario 6b: clicking "Set up financials" in the Step 2 coach-mark navigates to /financials', async () => {
    await bootstrap({ financialsStatus: 404, playerCount: 20 })

    await waitFor(() => expect(screen.getByText(/Next: Financials/i)).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: /Set up financials/i }))

    await waitFor(() => expect(screen.getByTestId('page').textContent).toBe('Financials'))
  })
})
