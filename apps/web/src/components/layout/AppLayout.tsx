import { useEffect, useMemo } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { Sidebar } from './Sidebar'
import { useClubStore } from '@/stores/club'
import { StatusBadge } from '@/components/ui/badge'
import { AnimatedNumber } from '@/components/ui/animated-number'
import { ProgressBar } from '@/components/ui/progress-bar'
import { ToastHost } from '@/components/ui/toast'
import { api } from '@/lib/api'
import { computeActiveBaseline } from '@/lib/scr'

const DISCLAIMER =
  'Headroom is a decision-support tool. It does not constitute legal or financial advice. Always verify against the official EFL Handbook.'

const routeLabel: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/roster':    'Roster',
  '/scenarios': 'Scenarios',
  '/calendar':  'Calendar',
  '/setup':     'Settings',
}

export function AppLayout() {
  const { clubName, financials, scenarios, setScenarios } = useClubStore()
  const location = useLocation()

  const firstSegment = '/' + location.pathname.split('/')[1]
  const pageTitle = routeLabel[firstSegment] ?? firstSegment.replace('/', '')

  // Bootstrap scenarios into the store. Refresh when financials change after a save.
  useEffect(() => {
    if (!financials) return
    let cancelled = false

    async function load() {
      try {
        const list = await api.scenarios.list(1, 100)
        // For Active Baseline math we need each scenario's actions — fetch in parallel.
        const details = await Promise.all(list.scenarios.map((s) => api.scenarios.get(s.id)))
        if (!cancelled) setScenarios(details)
      } catch {
        // Silent — Dashboard will simply show baseline without scenario deltas
      }
    }

    load()
    return () => { cancelled = true }
  }, [financials, setScenarios])

  const baseline = useMemo(() => {
    if (!financials) return null
    return computeActiveBaseline(financials, scenarios)
  }, [financials, scenarios])

  const scrPct = baseline ? baseline.ratio * 100 : null
  const scrStatus = baseline?.status ?? 'green'
  const statusDot = scrStatus === 'green' ? '#16a34a' : scrStatus === 'amber' ? '#f59e0b' : '#dc2626'
  const statusText = scrStatus === 'green' ? 'Compliant' : scrStatus === 'amber' ? 'Levy Zone' : 'Points Risk'

  const stackedOn = baseline ? baseline.includedCount > 0 : false

  return (
    <div className="min-h-screen flex bg-white text-slate-900">
      <ProgressBar />
      <ToastHost />
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 sticky top-0 z-10 bg-white/95 backdrop-blur border-b border-slate-200 flex items-center gap-4 px-8">
          <div className="flex-1 flex items-center gap-2 text-[13px] text-slate-500 min-w-0">
            <span className="text-slate-700 font-medium">{clubName ?? 'Headroom'}</span>
            <span className="text-slate-300 select-none">/</span>
            <span className="capitalize">{pageTitle}</span>
          </div>

          {scrPct !== null && (
            <motion.div
              layout
              className="flex items-center gap-3 px-3 py-1.5 rounded-full bg-violet-50 border border-violet-100 whitespace-nowrap"
            >
              <span className="meta-label text-violet-700">{stackedOn ? 'Projected SCR' : 'Current SCR'}</span>
              <AnimatedNumber
                value={scrPct}
                decimals={1}
                suffix="%"
                className="num text-[13px] text-slate-900 font-medium"
              />
              <span className="w-px h-3.5 bg-violet-200" />
              <StatusBadge status={scrStatus}>
                <motion.span
                  layout
                  initial={false}
                  animate={{ backgroundColor: statusDot }}
                  transition={{ duration: 0.35 }}
                  className="inline-block w-1.5 h-1.5 rounded-full mr-1.5"
                />
                {statusText}
              </StatusBadge>
            </motion.div>
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
            {/* Route transition: fade + tiny lift. Keyed on the first path
                segment so navigating between sub-routes within the same page
                doesn't trigger a full remount animation. */}
            <AnimatePresence mode="wait" initial={false}>
              <motion.div
                key={firstSegment}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
              >
                <Outlet />
              </motion.div>
            </AnimatePresence>
          </div>
        </main>

        <footer className="px-8 py-5 border-t border-slate-100">
          <div className="max-w-[1280px] mx-auto flex items-center justify-between">
            <p className="text-[11px] text-slate-400">{DISCLAIMER}</p>
            <p className="num text-[11px] text-slate-400">v2.0 · 2026/27</p>
          </div>
        </footer>
      </div>
    </div>
  )
}
