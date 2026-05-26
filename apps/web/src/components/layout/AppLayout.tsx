import { useEffect, useMemo } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { useClubStore } from '@/stores/club'
import { StatusBadge } from '@/components/ui/badge'
import { api } from '@/lib/api'
import { computeActiveBaseline } from '@/lib/scr'

const DISCLAIMER =
  'Headroom is a decision-support tool. It does not constitute legal or financial advice. Always verify against the official EFL Handbook.'

const routeLabel: Record<string, string> = {
  '/simulator': 'Simulator',
  '/history': 'History',
  '/calendar': 'Calendar',
  '/setup': 'Settings',
}

export function AppLayout() {
  const { clubName, financials, leagueId, simulations, setSimulations } = useClubStore()
  const location = useLocation()

  // Use only the first path segment so nested routes (e.g. /history/:id) don't leak ids into the crumb.
  const firstSegment = '/' + location.pathname.split('/')[1]
  const pageTitle = routeLabel[firstSegment] ?? firstSegment.replace('/', '')

  // Bootstrap simulations into the store (or refresh when financials change after a save).
  useEffect(() => {
    if (!financials) return
    api.simulations
      .list(1, 100)
      .then((data) => {
        setSimulations(
          data.simulations.map((s) => ({
            id: s.id,
            label: s.label,
            season: s.season,
            transferInput: s.transferInput,
            isIncluded: s.isIncluded,
            createdAt: s.createdAt,
            user: s.user,
          }))
        )
      })
      .catch(() => {})
  }, [financials, setSimulations])

  // Derive the active baseline — the source of truth for the Current SCR pill.
  const baseline = useMemo(() => {
    if (!financials || !leagueId) return null
    return computeActiveBaseline(financials, leagueId, simulations)
  }, [financials, leagueId, simulations])

  const scrPct = baseline ? baseline.ratio * 100 : null
  const scrStatus = baseline?.status ?? 'green'
  const statusDot = scrStatus === 'green' ? '#16a34a' : scrStatus === 'amber' ? '#f59e0b' : '#dc2626'
  const statusText = scrStatus === 'green' ? 'Compliant' : scrStatus === 'amber' ? 'Levy Zone' : 'Points Risk'

  return (
    <div className="min-h-screen flex bg-white text-slate-900">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="h-16 sticky top-0 z-10 bg-white/95 backdrop-blur border-b border-slate-200 flex items-center gap-4 px-8">
          <div className="flex-1 flex items-center gap-2 text-[13px] text-slate-500 min-w-0">
            <span className="text-slate-700 font-medium">{clubName ?? 'Headroom'}</span>
            <span className="text-slate-300 select-none">/</span>
            <span className="capitalize">{pageTitle}</span>
          </div>

          {/* Single Current SCR pill — centered, always live against the active baseline */}
          {scrPct !== null && (
            <div className="flex items-center gap-3 px-3 py-1.5 rounded-full bg-violet-50 border border-violet-100 whitespace-nowrap">
              <span className="meta-label text-violet-700">Current SCR</span>
              <span className="num text-[13px] text-slate-900 font-medium">{scrPct.toFixed(1)}%</span>
              <span className="w-px h-3.5 bg-violet-200" />
              <StatusBadge status={scrStatus}>
                <span
                  className="inline-block w-1.5 h-1.5 rounded-full mr-1.5"
                  style={{ background: statusDot }}
                />
                {statusText}
              </StatusBadge>
            </div>
          )}

          <div className="flex-1 flex items-center justify-end gap-2.5 min-w-0">
            <div className="text-right leading-tight">
              <div className="text-[13px] text-slate-900 font-medium">CFO</div>
              <div className="text-[11px] text-slate-400">Finance</div>
            </div>
            <span className="inline-flex items-center justify-center rounded-full bg-violet-600 text-white font-medium" style={{ width: 32, height: 32, fontSize: 11, letterSpacing: 0.4 }}>
              CF
            </span>
          </div>
        </header>

        <main className="flex-1 px-8 py-8">
          <div className="max-w-[1280px] mx-auto">
            <Outlet />
          </div>
        </main>

        <footer className="px-8 py-5 border-t border-slate-100">
          <div className="max-w-[1280px] mx-auto flex items-center justify-between">
            <p className="text-[11px] text-slate-400">{DISCLAIMER}</p>
            <p className="num text-[11px] text-slate-400">v0.5.0 · 2026/27</p>
          </div>
        </footer>
      </div>
    </div>
  )
}
