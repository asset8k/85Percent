import { useEffect } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { Sidebar } from './Sidebar'
import { useClubStore } from '@/stores/club'
import { StatusBadge } from '@/components/ui/badge'
import { api } from '@/lib/api'
import type { ComplianceStatus } from '@headroom/shared'

const DISCLAIMER =
  'Headroom is a decision-support tool. It does not constitute legal or financial advice. Always verify against the official EFL Handbook.'

const routeLabel: Record<string, string> = {
  '/simulator': 'Simulator',
  '/history': 'History',
  '/calendar': 'Calendar',
  '/setup': 'Settings',
}

export function AppLayout() {
  const {
    clubName, financials, currentSCRRatio, setCurrentSCRRatio,
    scrInfluence, setScrInfluence,
    simulationCount, totalStackedCostImpact, setStackedHistory,
  } = useClubStore()
  const location = useLocation()

  const pageTitle = routeLabel[location.pathname] ?? location.pathname.replace('/', '')

  // Bootstrap stacked history totals on first load (and whenever financials change after a settings save)
  useEffect(() => {
    if (!financials) return
    api.simulations.list(1, 100).then((data) => {
      const total = data.simulations.reduce(
        (sum, s) => sum + ((s.scrResult as { totalAnnualCostImpact?: number })?.totalAnnualCostImpact ?? 0),
        0
      )
      setStackedHistory(data.total, total)
    }).catch(() => {})
  }, [financials])

  // Centralised SCR recompute — fires whenever the toggle, financials, or stacked totals change
  useEffect(() => {
    if (!financials) return
    const baseRevenue = financials.footballRelatedRevenue + (financials.ownerEquityUsed1yr ?? 0)
    setCurrentSCRRatio(
      (financials.currentSquadCosts + (scrInfluence ? totalStackedCostImpact : 0)) / baseRevenue
    )
  }, [scrInfluence, financials, totalStackedCostImpact])

  const allowanceRatio = financials?.currentAllowanceRatio ?? 0.30
  const scrPct = currentSCRRatio !== null ? currentSCRRatio * 100 : null
  const scrStatus: ComplianceStatus =
    currentSCRRatio === null ? 'green'
    : currentSCRRatio > (0.85 + allowanceRatio) ? 'red'
    : currentSCRRatio > 0.85 ? 'amber'
    : 'green'

  const statusDot = scrStatus === 'green' ? '#16a34a' : scrStatus === 'amber' ? '#f59e0b' : '#dc2626'
  const statusText = scrStatus === 'green' ? 'Compliant' : scrStatus === 'amber' ? 'Levy Zone' : 'Points Risk'

  return (
    <div className="min-h-screen flex bg-white text-slate-900">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        {/* Top bar */}
        <header className="h-16 sticky top-0 z-10 bg-white/95 backdrop-blur border-b border-slate-200 flex items-center gap-4 px-8">
          {/* Breadcrumb — left */}
          <div className="flex-1 flex items-center gap-2 text-[13px] text-slate-500">
            <span className="text-slate-700 font-medium">{clubName ?? 'Headroom'}</span>
            <span className="text-slate-300 select-none">/</span>
            <span className="capitalize">{pageTitle}</span>
          </div>

          {/* SCR pill */}
          {scrPct !== null && (
            <div className="flex items-center gap-3 px-3 py-1.5 rounded-full bg-violet-50 border border-violet-100 whitespace-nowrap">
              <span className="meta-label text-violet-700">
                {scrInfluence && simulationCount > 0 ? 'Stacked SCR' : 'Current SCR'}
              </span>
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

          {/* Stack history toggle — visible once there are simulations */}
          {simulationCount > 0 && (
            <div className="flex items-center gap-2.5 px-3 py-1.5 rounded-full border border-slate-200 bg-slate-50 whitespace-nowrap">
              <span className="text-[12px] text-slate-600 font-medium select-none">Stack history</span>
              <button
                type="button"
                role="switch"
                aria-checked={scrInfluence}
                onClick={() => setScrInfluence(!scrInfluence)}
                className="toggle"
                data-on={scrInfluence ? 'true' : 'false'}
              />
            </div>
          )}

          {/* User — right */}
          <div className="flex items-center gap-2.5">
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
            <p className="num text-[11px] text-slate-400">v0.4.2 · 2026/27</p>
          </div>
        </footer>
      </div>
    </div>
  )
}
