/**
 * First-login bootstrap ordering.
 *
 * Regression cover for the "Unable to load this workspace" first login: the app
 * entered the workspace the moment a session existed, so the shell, the routed
 * page and the copilot all mounted and fired workspace-scoped requests
 * alongside the `/me` + `/club` bootstrap they depend on. On a brand-new
 * account those requests reached the API before the application user existed
 * and came back 503. A refresh "fixed" it only because by then the bootstrap
 * had completed.
 *
 * These tests assert the ordering contract directly at the network boundary —
 * what was actually requested, and when — rather than trusting the hooks'
 * `enabled` flags to be spelled correctly.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { render, screen, waitFor, cleanup } from '@testing-library/react'
import { QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter, Route, Routes } from 'react-router-dom'

const hoisted = vi.hoisted(() => ({
  session: null as { access_token: string; user: { id: string; email: string } } | null,
  authCallback: null as ((event: string, session: unknown) => void) | null,
}))

vi.mock('@/lib/supabase', () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: hoisted.session } }),
      onAuthStateChange: (cb: (event: string, session: unknown) => void) => {
        hoisted.authCallback = cb
        return { data: { subscription: { unsubscribe: () => {} } } }
      },
    },
  },
}))

import { ProtectedRoute } from './ProtectedRoute'
import { queryClient } from '@/lib/queryClient'
import { useClubStore } from '@/stores/club'
import { useAuthStore } from '@/stores/auth'
import {
  useLeagueTableQuery,
  useRosterQuery,
  useScenarioDetailsQuery,
  useManagerQuery,
} from '@/lib/queries'

// ---------------------------------------------------------------------------
// Network double
// ---------------------------------------------------------------------------

/** Requests that can only be answered once the caller's workspace is resolved. */
const WORKSPACE_SCOPED = ['/api/roster', '/api/league-table', '/api/scenarios', '/api/chat/sessions']

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((r) => { resolve = r })
  return { promise, resolve }
}

interface Recorder {
  calls: string[]
  statuses: number[]
  me: ReturnType<typeof deferred<void>>
  club: ReturnType<typeof deferred<void>>
  clubFails: boolean
}

function installFetch(recorder: Recorder) {
  const json = (body: unknown, status = 200) => {
    recorder.statuses.push(status)
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  }

  vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString()
    recorder.calls.push(url)

    if (url === '/api/me') {
      await recorder.me.promise
      return json({
        id: 'user-1', title: null, canEditRoster: true, canEditScenarios: true,
        isWorkspaceAdmin: true, fullName: 'Club CFO', email: 'cfo@club.com',
        isTotpEnabled: false, aiBalanceUsd: 5,
      })
    }
    if (url === '/api/club') {
      await recorder.club.promise
      if (recorder.clubFails) return json({ error: 'Database unavailable' }, 503)
      return json({
        id: 'club-1', name: 'Test FC', shortName: 'TFC',
        leagueId: 'efl-championship', logoUrl: null, baseCurrency: 'GBP',
      })
    }
    if (url.startsWith('/api/club/financials')) {
      return json({
        id: 'fin-1', clubId: 'club-1', season: '2026-27',
        footballRelatedRevenue: 100_000_000, currentSquadCosts: 80_000_000,
        contractCount: 20, squadCostsMode: 'derived', derivedSquadCosts: 80_000_000,
        manualSquadCosts: null, currentAllowanceRatio: 0.3,
        ownerEquityUsed1yr: null, ownerEquityUsed3yr: null,
      })
    }
    if (url.startsWith('/api/roster/manager')) return json({ manager: null })
    if (url.startsWith('/api/roster')) return json({ players: [] })
    if (url.startsWith('/api/league-table')) {
      return json({
        leagueId: 'efl-championship', competition: 'Championship', season: '2026-27',
        source: 'fallback', fetchedAt: new Date(0).toISOString(), standings: [],
      })
    }
    if (url.startsWith('/api/scenarios')) return json({ scenarios: [], total: 0, page: 1, limit: 100 })

    return json({ error: `unexpected request ${url}` }, 404)
  }))
}

/** A page standing in for the routed workspace surfaces the shell mounts. */
function WorkspacePage() {
  const roster = useRosterQuery()
  const leagueTable = useLeagueTableQuery()
  const scenarios = useScenarioDetailsQuery()
  const manager = useManagerQuery()
  const loaded = !roster.isPending && !leagueTable.isPending && !scenarios.isPending && !manager.isPending
  return <div data-testid="page">{loaded ? 'workspace-loaded' : 'workspace-loading'}</div>
}

function renderApp() {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/dashboard']}>
        <Routes>
          <Route path="/login" element={<div data-testid="login">sign in</div>} />
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <WorkspacePage />
              </ProtectedRoute>
            }
          />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

function newRecorder(overrides: Partial<Recorder> = {}): Recorder {
  return {
    calls: [], statuses: [],
    me: deferred<void>(), club: deferred<void>(),
    clubFails: false,
    ...overrides,
  }
}

const workspaceCalls = (recorder: Recorder) =>
  recorder.calls.filter((url) => WORKSPACE_SCOPED.some((prefix) => url.startsWith(prefix)))

// ---------------------------------------------------------------------------

describe('first-login workspace bootstrap', () => {
  beforeEach(() => {
    localStorage.clear()
    queryClient.clear()
    hoisted.session = { access_token: 'token-1', user: { id: 'user-1', email: 'cfo@club.com' } }
    hoisted.authCallback = null
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

  it('fires no workspace-scoped request until the user and club are resolved', async () => {
    const recorder = newRecorder()
    installFetch(recorder)
    renderApp()

    // Bootstrap is in flight: /me and /club have been requested and neither has
    // answered yet. Nothing that depends on their result may have gone out.
    await waitFor(() => {
      expect(recorder.calls).toContain('/api/me')
      expect(recorder.calls).toContain('/api/club')
    })
    expect(workspaceCalls(recorder)).toEqual([])

    // Resolve identity only — the club is still unknown, so the workspace is
    // still not resolved and dependent requests must stay held.
    recorder.me.resolve()
    await waitFor(() => expect(useAuthStore.getState().session).not.toBeNull())
    expect(workspaceCalls(recorder)).toEqual([])

    // Club resolves — now, and only now, the page queries may run.
    recorder.club.resolve()
    await waitFor(() => expect(useClubStore.getState().bootstrapStatus).toBe('ready'))
    await waitFor(() => expect(screen.getByTestId('page').textContent).toBe('workspace-loaded'))

    const calls = workspaceCalls(recorder)
    expect(calls.some((u) => u.startsWith('/api/roster?'))).toBe(true)
    expect(calls.some((u) => u.startsWith('/api/league-table'))).toBe(true)
    expect(calls.some((u) => u.startsWith('/api/scenarios'))).toBe(true)
  })

  it('completes a fresh login with no 5xx and no manual refresh', async () => {
    const recorder = newRecorder()
    installFetch(recorder)
    renderApp()

    recorder.me.resolve()
    recorder.club.resolve()

    await waitFor(() => expect(screen.getByTestId('page').textContent).toBe('workspace-loaded'))

    expect(recorder.statuses.filter((s) => s >= 500)).toEqual([])
    expect(screen.queryByText(/Unable to load this workspace/i)).toBeNull()
    // The whole bootstrap took exactly one /me and one /club — no retry loop.
    expect(recorder.calls.filter((u) => u === '/api/me')).toHaveLength(1)
    expect(recorder.calls.filter((u) => u === '/api/club')).toHaveLength(1)
  })

  it('requests every workspace surface exactly once across the first load', async () => {
    const recorder = newRecorder()
    installFetch(recorder)
    renderApp()
    recorder.me.resolve()
    recorder.club.resolve()

    await waitFor(() => expect(screen.getByTestId('page').textContent).toBe('workspace-loaded'))

    const counts = new Map<string, number>()
    for (const url of recorder.calls) counts.set(url, (counts.get(url) ?? 0) + 1)
    for (const [url, count] of counts) {
      expect(count, `${url} was requested ${count} times`).toBe(1)
    }
  })

  it('loads club, financials, roster, league table and scenarios', async () => {
    const recorder = newRecorder()
    installFetch(recorder)
    renderApp()
    recorder.me.resolve()
    recorder.club.resolve()

    await waitFor(() => expect(screen.getByTestId('page').textContent).toBe('workspace-loaded'))

    expect(useClubStore.getState().clubName).toBe('Test FC')
    await waitFor(() => expect(useClubStore.getState().financialsStatus).toBe('ready'))
    expect(recorder.calls.some((u) => u.startsWith('/api/club/financials'))).toBe(true)
    expect(recorder.calls.some((u) => u.startsWith('/api/roster?'))).toBe(true)
    expect(recorder.calls.some((u) => u.startsWith('/api/league-table'))).toBe(true)
    expect(recorder.calls.some((u) => u.startsWith('/api/scenarios'))).toBe(true)
  })

  it('behaves identically on a page reload with an existing session', async () => {
    // Seed the persisted auth store the way a reload rehydrates it.
    localStorage.setItem('headroom-auth', JSON.stringify({
      state: { session: hoisted.session, user: hoisted.session?.user },
      version: 0,
    }))
    const recorder = newRecorder()
    installFetch(recorder)
    renderApp()

    await waitFor(() => expect(recorder.calls).toContain('/api/club'))
    expect(workspaceCalls(recorder)).toEqual([])

    recorder.me.resolve()
    recorder.club.resolve()
    await waitFor(() => expect(screen.getByTestId('page').textContent).toBe('workspace-loaded'))
    expect(recorder.statuses.filter((s) => s >= 500)).toEqual([])
  })

  it('redirects to login when there is no session, without touching the API', async () => {
    hoisted.session = null
    const recorder = newRecorder()
    installFetch(recorder)
    renderApp()

    await waitFor(() => expect(screen.getByTestId('login')).toBeTruthy())
    expect(screen.queryByTestId('page')).toBeNull()
    expect(recorder.calls).toEqual([])
  })

  it('surfaces the workspace error only after the bootstrap genuinely fails', async () => {
    const recorder = newRecorder({ clubFails: true })
    installFetch(recorder)
    renderApp()

    recorder.me.resolve()
    // Still loading: the failure has not happened yet, so no error screen.
    expect(screen.queryByText(/Unable to load this workspace/i)).toBeNull()

    recorder.club.resolve()
    await waitFor(() => expect(screen.getByText(/Unable to load this workspace/i)).toBeTruthy())

    // A failed bootstrap must not let dependent requests through either.
    expect(workspaceCalls(recorder)).toEqual([])
  })
})
