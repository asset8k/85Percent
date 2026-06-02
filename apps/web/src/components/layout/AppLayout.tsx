import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, Outlet, useLocation } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { Sidebar } from './Sidebar'
import { NotificationBell } from './NotificationBell'
import { useClubStore } from '@/stores/club'
import { useSeasonStore, seasonLabel } from '@/stores/season'
import { useMe, roleLabel } from '@/lib/role'
import { useAuthStore } from '@/stores/auth'
import { StatusBadge } from '@/components/ui/badge'
import { AnimatedNumber } from '@/components/ui/animated-number'
import { ProgressBar } from '@/components/ui/progress-bar'
import { ToastHost } from '@/components/ui/toast'
import { api, type ClubFinancialsResponse, type ScenarioDetail } from '@/lib/api'
import { computeActiveBaseline, type ActiveBaseline } from '@/lib/scr'
import { useWorkspaceCurrency } from '@/lib/useWorkspaceCurrency'
import type { ComplianceStatus } from '@headroom/shared'

const DISCLAIMER =
  'Headroom is a decision-support tool. It does not constitute legal or financial advice. Always verify against the official EFL Handbook.'

const routeLabel: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/roster':    'Roster',
  '/scenarios': 'Scenarios',
  '/league-table': 'League Table',
  '/calendar':  'Calendar',
  '/financials':'Financials',
  '/setup':     'Settings',
}

// Initials for the avatar — first + last initial, or the first two letters of a
// single-word name. Falls back to "?" so the chip is never blank.
function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase()
}

export function AppLayout() {
  const { clubName, financials, scenarios, scenariosLoaded, setScenarios, setScenariosLoaded } = useClubStore()
  const seasonStartYear = useSeasonStore((s) => s.startYear)
  const location = useLocation()

  // Current user identity for the top-right account chip.
  const me = useMe()
  const authEmail = useAuthStore((s) => s.user?.email ?? null)
  const displayName =
    me?.fullName?.trim() ||
    me?.email?.split('@')[0] ||
    authEmail?.split('@')[0] ||
    'Account'
  const displayRole = roleLabel(me?.role ?? null)

  const firstSegment = '/' + location.pathname.split('/')[1]
  const pageTitle = routeLabel[firstSegment] ?? firstSegment.replace('/', '')

  // Bootstrap scenarios into the store. Refresh when financials change after a save.
  useEffect(() => {
    if (!financials) return
    let cancelled = false
    // Only gate the SCR pill (show the loading placeholder) on the genuine FIRST
    // load, when we have no scenarios yet and a number would otherwise render
    // pre-scenario and then jump. On later refreshes the scenarios already in the
    // store give a correct baseline, so we reload silently in the background and
    // let the figure animate in place — no skeleton flash on every reload.
    if (!useClubStore.getState().scenariosLoaded) setScenariosLoaded(false)

    async function load() {
      try {
        const list = await api.scenarios.list(1, 100)
        // For Active Baseline math we need each scenario's actions — fetch in parallel.
        const details = await Promise.all(list.scenarios.map((s) => api.scenarios.get(s.id)))
        if (!cancelled) setScenarios(details) // also flips scenariosLoaded → true
      } catch {
        // Silent — proceed with whatever we have rather than holding forever.
        if (!cancelled) setScenariosLoaded(true)
      }
    }

    load()
    return () => { cancelled = true }
  }, [financials, setScenarios, setScenariosLoaded])

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

          {financials && !scenariosLoaded ? (
            // Financials are in, but the included scenarios that feed the Active
            // Baseline are still loading — show a placeholder rather than a number
            // that would jump once they land.
            <SCRLoadingPill />
          ) : scrPct !== null && financials && baseline ? (
            <SCRBadgePill
              scrPct={scrPct}
              scrStatus={scrStatus}
              statusDot={statusDot}
              statusText={statusText}
              stackedOn={stackedOn}
              financials={financials}
              baseline={baseline}
              scenarios={scenarios}
            />
          ) : (
            // No financials configured for this season yet — keep the slot
            // occupied with a clear call to action rather than an empty gap.
            <Link
              to="/financials"
              className="flex items-center gap-3 px-3 py-1.5 rounded-full bg-slate-50 border border-slate-200 hover:border-slate-300 whitespace-nowrap transition-colors"
            >
              <span className="meta-label text-slate-500">Current SCR</span>
              <span className="num text-[13px] text-slate-400 font-medium">—</span>
              <span className="w-px h-3.5 bg-slate-200" />
              <span className="text-[12px] font-medium text-violet-600 inline-flex items-center gap-0.5">
                Set up financials
                <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14" /><path d="M13 6l6 6-6 6" />
                </svg>
              </span>
            </Link>
          )}

          <div className="flex-1 flex items-center justify-end gap-2.5 min-w-0">
            <NotificationBell />
            <div className="text-right leading-tight min-w-0">
              <div className="text-[13px] text-slate-900 font-medium truncate max-w-[180px]">{displayName}</div>
              {displayRole && <div className="text-[11px] text-slate-400 truncate max-w-[180px]">{displayRole}</div>}
            </div>
            <span
              className="inline-flex items-center justify-center rounded-full bg-violet-600 text-white font-medium flex-shrink-0"
              style={{ width: 32, height: 32, fontSize: 11, letterSpacing: 0.4 }}
              title={displayName}
            >
              {initialsOf(displayName)}
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
            <p className="num text-[11px] text-slate-400">v2.0 · {seasonLabel(seasonStartYear)}</p>
          </div>
        </footer>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// SCR pill + breakdown popover
// ---------------------------------------------------------------------------
// Pill is a button; on click a portal-anchored popover explains how the value
// was computed — squad-cost source, revenue composition, and which scenarios
// (if any) are stacked on top of the Settings baseline.

// Compact money for the SCR breakdown popover. Symbol comes from the active
// workspace currency (defaults to £); no conversion — same value, new label.
function fmtMoneyCompact(pence: number, symbol = '£'): string {
  const pounds = Math.round(pence / 100)
  if (Math.abs(pounds) >= 1_000_000) return `${symbol}${(pounds / 1_000_000).toFixed(1)}M`
  if (Math.abs(pounds) >= 1_000)     return `${symbol}${(pounds / 1_000).toFixed(0)}K`
  return `${symbol}${pounds.toLocaleString('en-GB')}`
}

interface SCRBadgePillProps {
  scrPct: number
  scrStatus: ComplianceStatus
  statusDot: string
  statusText: string
  stackedOn: boolean
  financials: ClubFinancialsResponse
  baseline: ActiveBaseline
  scenarios: ScenarioDetail[]
}

// Placeholder shown in the TopBar SCR slot while the included scenarios that
// feed the Active Baseline are still loading. Mirrors the pill's shape so the
// header doesn't reflow when the real figure lands.
function SCRLoadingPill() {
  return (
    <div className="flex items-center gap-3 px-3 py-1.5 rounded-full bg-slate-50 border border-slate-200 whitespace-nowrap">
      <span className="meta-label text-slate-500">Current SCR</span>
      <span className="h-3.5 w-12 rounded bg-slate-200 animate-pulse" />
      <span className="w-px h-3.5 bg-slate-200" />
      <span className="h-3.5 w-16 rounded bg-slate-200 animate-pulse" />
    </div>
  )
}

function SCRBadgePill({
  scrPct,
  scrStatus,
  statusDot,
  statusText,
  stackedOn,
  financials,
  baseline,
  scenarios,
}: SCRBadgePillProps) {
  const [open, setOpen] = useState(false)
  const btnRef = useRef<HTMLButtonElement | null>(null)
  const [anchor, setAnchor] = useState<{ top: number; right: number } | null>(null)

  // Measure the pill so the popover can hang from its bottom-right edge.
  useLayoutEffect(() => {
    if (!open || !btnRef.current) return
    const update = () => {
      const r = btnRef.current!.getBoundingClientRect()
      setAnchor({ top: r.bottom + 8, right: window.innerWidth - r.right })
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [open])

  // ESC + outside-click dismiss
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    const onClick = (e: MouseEvent) => {
      const t = e.target as Node
      if (btnRef.current?.contains(t)) return
      const pop = document.getElementById('scr-breakdown-popover')
      if (pop?.contains(t)) return
      setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onClick)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onClick)
    }
  }, [open])

  return (
    <>
      <motion.button
        ref={btnRef}
        layout
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={`flex items-center gap-3 px-3 py-1.5 rounded-full bg-violet-50 border whitespace-nowrap transition-colors ${
          open ? 'border-violet-300 ring-2 ring-violet-200/60' : 'border-violet-100 hover:border-violet-200'
        }`}
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
        <motion.svg
          width={11}
          height={11}
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="text-violet-500"
          animate={{ rotate: open ? 180 : 0 }}
          transition={{ duration: 0.18 }}
        >
          <path d="M6 9l6 6 6-6" />
        </motion.svg>
      </motion.button>

      <SCRBreakdownPopover
        open={open}
        anchor={anchor}
        scrPct={scrPct}
        scrStatus={scrStatus}
        statusText={statusText}
        stackedOn={stackedOn}
        financials={financials}
        baseline={baseline}
        scenarios={scenarios}
        onClose={() => setOpen(false)}
      />
    </>
  )
}

interface SCRBreakdownPopoverProps {
  open: boolean
  anchor: { top: number; right: number } | null
  scrPct: number
  scrStatus: ComplianceStatus
  statusText: string
  stackedOn: boolean
  financials: ClubFinancialsResponse
  baseline: ActiveBaseline
  scenarios: ScenarioDetail[]
  onClose: () => void
}

function SCRBreakdownPopover({
  open,
  anchor,
  scrPct,
  scrStatus,
  statusText,
  stackedOn,
  financials,
  baseline,
  scenarios,
  onClose,
}: SCRBreakdownPopoverProps) {
  const { symbol } = useWorkspaceCurrency()
  const fmtGBP = (pence: number) => fmtMoneyCompact(pence, symbol)
  const included = useMemo(() => scenarios.filter((s) => s.isIncluded), [scenarios])

  // "Settings-only" SCR — what the pill would read with no scenarios stacked.
  // Lets the popover surface the delta the scenarios add.
  const settingsOnly = useMemo(
    () => computeActiveBaseline(financials, []),
    [financials],
  )
  const settingsOnlyPct = settingsOnly.ratio * 100
  const deltaPct = scrPct - settingsOnlyPct
  const deltaAbs = Math.abs(deltaPct)
  const deltaDir = deltaPct > 0.05 ? 'up' : deltaPct < -0.05 ? 'down' : 'flat'

  const squadSrc = financials.squadCostsMode === 'manual'
    ? 'Manual override'
    : 'Derived from active roster'

  const statusColor = scrStatus === 'green' ? '#16a34a' : scrStatus === 'amber' ? '#f59e0b' : '#dc2626'

  if (!anchor) return null

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          id="scr-breakdown-popover"
          role="dialog"
          aria-label="Projected SCR breakdown"
          initial={{ opacity: 0, y: -4, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -4, scale: 0.98, transition: { duration: 0.12 } }}
          transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
          style={{
            position: 'fixed',
            top: anchor.top,
            right: anchor.right,
            zIndex: 50,
            width: 360,
            transformOrigin: 'top right',
          }}
          className="rounded-xl bg-white shadow-[0_18px_40px_-12px_rgba(15,23,42,0.18),0_4px_10px_-6px_rgba(15,23,42,0.08)] ring-1 ring-slate-200/80 overflow-hidden"
        >
          {/* Header */}
          <div className="px-4 pt-4 pb-3 border-b border-slate-100">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="meta-label text-violet-700">{stackedOn ? 'Projected SCR' : 'Current SCR'}</div>
                <div className="flex items-baseline gap-2 mt-1">
                  <span className="num text-[22px] font-semibold text-slate-900 tabular-nums">{scrPct.toFixed(1)}%</span>
                  <span
                    className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium"
                    style={{ backgroundColor: `${statusColor}1a`, color: statusColor }}
                  >
                    <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ backgroundColor: statusColor }} />
                    {statusText}
                  </span>
                </div>
              </div>
              <button
                onClick={onClose}
                aria-label="Close breakdown"
                className="text-slate-400 hover:text-slate-600 -mr-1 mt-0.5"
              >
                <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 6L6 18" /><path d="M6 6l12 12" />
                </svg>
              </button>
            </div>
            {stackedOn && (
              <div className="mt-2 flex items-center gap-1.5 text-[11.5px]">
                <span className="text-slate-500">Settings only:</span>
                <span className="num text-slate-700 font-medium tabular-nums">{settingsOnlyPct.toFixed(1)}%</span>
                {deltaDir !== 'flat' && (
                  <span
                    className={`inline-flex items-center gap-0.5 num font-medium tabular-nums ${
                      deltaDir === 'up' ? 'text-red-600' : 'text-emerald-600'
                    }`}
                  >
                    {deltaDir === 'up' ? '↑' : '↓'}{deltaAbs.toFixed(1)} pp
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Inputs from Settings */}
          <div className="px-4 py-3 border-b border-slate-100">
            <div className="meta-label mb-2">From Settings</div>
            <BreakdownRow label="Football-related revenue" value={fmtGBP(financials.footballRelatedRevenue)} />
            {financials.ownerEquityUsed1yr != null && financials.ownerEquityUsed1yr > 0 && (
              <BreakdownRow label="Owner-equity top-up (1yr)" value={`+ ${fmtGBP(financials.ownerEquityUsed1yr)}`} />
            )}
            <BreakdownRow
              label="Squad costs"
              value={fmtGBP(financials.currentSquadCosts)}
              hint={squadSrc}
            />
            <BreakdownRow
              label="Current allowance"
              value={`${(financials.currentAllowanceRatio * 100).toFixed(0)}%`}
            />
          </div>

          {/* Scenarios stacked */}
          <div className="px-4 py-3">
            <div className="flex items-center justify-between mb-2">
              <div className="meta-label">Scenarios stacked</div>
              <span className="text-[11px] text-slate-400">{included.length} of {scenarios.length}</span>
            </div>
            {included.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-200 px-3 py-2.5">
                <div className="text-[12.5px] text-slate-600">No scenarios included.</div>
                <div className="text-[11px] text-slate-400 mt-0.5">
                  SCR is calculated from Settings + your active roster.
                </div>
              </div>
            ) : (
              <ul className="space-y-1">
                {included.map((s) => (
                  <li
                    key={s.id}
                    className="flex items-center justify-between gap-2 rounded-md px-2 py-1.5 bg-violet-50/60 ring-1 ring-violet-100/70"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="inline-block w-1.5 h-1.5 rounded-full bg-violet-500 flex-shrink-0" />
                      <span className="text-[12.5px] text-slate-800 font-medium truncate">{s.name}</span>
                    </div>
                    <span className="text-[11px] text-slate-400 num flex-shrink-0">
                      {s.actions.length} {s.actions.length === 1 ? 'action' : 'actions'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Footer link */}
          <div className="px-4 pt-1 pb-3 border-t border-slate-100 bg-slate-50/40 flex items-center justify-between">
            <span className="text-[11px] text-slate-400">
              Adjusted revenue: <span className="num text-slate-600">{fmtGBP(baseline.adjustedRevenue)}</span>
            </span>
            <Link
              to="/scenarios"
              onClick={onClose}
              className="text-[11.5px] font-medium text-violet-600 hover:text-violet-700 inline-flex items-center gap-0.5"
            >
              Manage scenarios
              <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12h14" /><path d="M13 6l6 6-6 6" />
              </svg>
            </Link>
          </div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}

function BreakdownRow({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1">
      <div className="min-w-0">
        <div className="text-[12.5px] text-slate-600 truncate">{label}</div>
        {hint && <div className="text-[10.5px] text-slate-400 mt-0.5">{hint}</div>}
      </div>
      <div className="num text-[12.5px] text-slate-900 font-medium tabular-nums">{value}</div>
    </div>
  )
}
