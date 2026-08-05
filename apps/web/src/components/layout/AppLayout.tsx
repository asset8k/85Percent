import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { createPortal } from 'react-dom'
import { Link, Outlet, useLocation } from 'react-router-dom'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { Sidebar } from './Sidebar'
import { NotificationBell } from './NotificationBell'
import { useClubStore } from '@/stores/club'
import { useSeasonStore, seasonLabel } from '@/stores/season'
import { useMe, accessLabel, compactAccessLabel } from '@/lib/role'
import { useAuthStore } from '@/stores/auth'
import { StatusBadge } from '@/components/ui/badge'
import { AnimatedNumber } from '@/components/ui/animated-number'
import { ProgressBar } from '@/components/ui/progress-bar'
import { Skeleton } from '@/components/ui/skeleton'
import { ToastHost } from '@/components/ui/toast'
import { CopilotChat, CopilotLauncher } from '@/components/ai/CopilotChat'
import type { ClubFinancialsResponse, ScenarioDetail } from '@/lib/api'
import { computeActiveBaseline, type ActiveBaseline } from '@/lib/scr'
import { useWorkspaceCurrency } from '@/lib/useWorkspaceCurrency'
import type { ComplianceStatus } from '@85percent/shared'
import { useScenarioDetailsQuery } from '@/lib/queries'
import { formatPercentage, formatPercentagePointDelta } from '@/lib/percentage'

type ScrWidgetState = 'loading' | 'ready' | 'notConfigured' | 'error'

// Maps the first path segment to its i18n key for the breadcrumb title.
const routeLabelKey: Record<string, string> = {
  '/dashboard': 'nav.dashboard',
  '/roster':    'nav.roster',
  '/scenarios': 'nav.scenarios',
  '/league-table': 'nav.leagueTable',
  '/calendar':  'nav.calendar',
  '/rules':     'nav.rules',
  '/financials':'nav.financials',
  '/ssr':       'nav.ssrTests',
  '/setup':     'chrome.settings',
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
  const { t } = useTranslation()
  const {
    bootstrapStatus,
    clubName,
    financials,
    financialsStatus,
    scenarios,
    scenariosStatus,
    setScenarios,
    setScenariosLoading,
    setScenariosError,
    retryFinancials,
  } = useClubStore()
  const seasonStartYear = useSeasonStore((s) => s.startYear)
  const location = useLocation()
  const reduceMotion = useReducedMotion()
  const scenariosQuery = useScenarioDetailsQuery()

  // Current user identity for the top-right account chip.
  const me = useMe()
  const authEmail = useAuthStore((s) => s.user?.email ?? null)
  const displayName =
    me?.fullName?.trim() ||
    me?.email?.split('@')[0] ||
    authEmail?.split('@')[0] ||
    'Account'
  const displayRole = me ? compactAccessLabel(me) : ''
  const fullRole = me ? accessLabel(me) : ''

  const firstSegment = '/' + location.pathname.split('/')[1]
  const pageTitleKey = routeLabelKey[firstSegment]
  const pageTitle = pageTitleKey ? t(pageTitleKey) : firstSegment.replace('/', '')

  // Scenario details use the same TanStack Query entry as ScenariosPage. This
  // lets their request run in parallel with season financials and prevents the
  // top bar from issuing a second list + detail request sequence.
  useEffect(() => {
    if (financialsStatus !== 'ready' || !financials) return
    if (scenariosQuery.isPending) {
      setScenariosLoading()
    } else if (scenariosQuery.isError) {
      setScenariosError()
    } else if (scenariosQuery.data) {
      setScenarios(scenariosQuery.data)
    }
  }, [financials, financialsStatus, scenariosQuery.data, scenariosQuery.isError, scenariosQuery.isPending, setScenarios, setScenariosError, setScenariosLoading])

  const baseline = useMemo(() => {
    if (!financials) return null
    return computeActiveBaseline(financials, scenarios)
  }, [financials, scenarios])

  const scrPct = baseline ? baseline.ratio * 100 : null
  const scrStatus = baseline?.status ?? 'green'
  const statusDot = scrStatus === 'green' ? '#16a34a' : scrStatus === 'amber' ? '#f59e0b' : '#dc2626'
  const statusText = scrStatus === 'green' ? t('common.status.compliant') : scrStatus === 'amber' ? t('common.status.levyZone') : t('common.status.pointsRisk')

  const stackedOn = baseline ? baseline.includedCount > 0 : false
  const shellLoading = bootstrapStatus !== 'ready'
  const scrWidgetState: ScrWidgetState = shellLoading || financialsStatus === 'idle' || financialsStatus === 'loading'
    ? 'loading'
    : financialsStatus === 'error' || scenariosStatus === 'error'
      ? 'error'
      : financialsStatus === 'ready' && financials === null
        ? 'notConfigured'
        : financialsStatus === 'ready' && scenariosStatus === 'ready' && baseline
          ? 'ready'
          : 'loading'

  return (
    <div className="min-h-screen flex bg-white text-slate-900">
      <ProgressBar />
      <ToastHost />
      <CopilotChat />
      <CopilotLauncher />
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 sticky top-0 z-10 bg-white/95 backdrop-blur border-b border-slate-200 flex items-center gap-4 px-8">
          <div className="flex-1 flex items-center gap-2 text-[13px] text-slate-500 min-w-0">
            {shellLoading ? (
              <>
                <Skeleton className="h-3.5 w-32" />
                <span className="text-slate-300 select-none">/</span>
                <Skeleton className="h-3.5 w-20" />
              </>
            ) : (
              <>
                <span className="text-slate-700 font-medium">{clubName}</span>
                <span className="text-slate-300 select-none">/</span>
                <span className="capitalize">{pageTitle}</span>
              </>
            )}
          </div>

          {scrWidgetState === 'loading' ? (
            <SCRLoadingPill />
          ) : scrWidgetState === 'ready' && scrPct !== null && financials && baseline ? (
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
          ) : scrWidgetState === 'notConfigured' ? (
            <Link
              to="/financials"
              className="flex items-center gap-3 px-3 py-1.5 rounded-full bg-slate-50 border border-slate-200 hover:border-slate-300 whitespace-nowrap transition-colors"
            >
              <span className="meta-label text-slate-500">{t('chrome.topbar.currentScr')}</span>
              <span className="num text-[13px] text-slate-400 font-medium">—</span>
              <span className="w-px h-3.5 bg-slate-200" />
              <span className="text-[12px] font-medium text-violet-600 inline-flex items-center gap-0.5">
                {t('chrome.topbar.setUpFinancials')}
                <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14" /><path d="M13 6l6 6-6 6" />
                </svg>
              </span>
            </Link>
          ) : (
            <SCRErrorPill onRetry={() => {
              retryFinancials()
              void scenariosQuery.refetch()
            }} />
          )}

          <div className="flex-1 flex items-center justify-end gap-2.5 min-w-0">
            {shellLoading ? <HeaderAccountSkeleton /> : <>
              <NotificationBell />
              <ProfileMenu
                displayName={displayName}
                displayRole={displayRole}
                fullRole={fullRole}
              />
            </>}
          </div>
        </header>

        <main className="flex-1 px-8 py-8">
          <div className="max-w-[1280px] mx-auto">
            {/* Route transition: a single, calm fade + gentle rise on the new
                page. Keyed on the first path segment so it plays on tab switches
                (not sub-route changes within a page). We deliberately avoid an
                exit animation + `mode="wait"` — those add a gap and an up/down
                jolt; remounting the keyed element lets the incoming page ease in
                on its own. The smooth, evenly-paced curve (no fast-start expo)
                keeps a pre-loaded tab from snapping into place. Honours the OS
                "reduce motion" setting by dropping the movement. */}
            <motion.div
              key={firstSegment}
              initial={{ opacity: 0, y: reduceMotion ? 0 : 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.45, ease: [0.25, 0.1, 0.25, 1] }}
            >
              <Outlet />
            </motion.div>
          </div>
        </main>

        <footer className="px-8 py-5 border-t border-slate-100">
          <div className="max-w-[1280px] mx-auto flex items-center justify-between">
            <p className="text-[11px] text-slate-400">{t('chrome.disclaimer')}</p>
            <p className="num text-[11px] text-slate-400">v2.0 · {seasonLabel(seasonStartYear)}</p>
          </div>
        </footer>
      </div>
    </div>
  )
}

function HeaderAccountSkeleton() {
  return (
    <div className="flex items-center gap-2.5" aria-hidden="true">
      <Skeleton className="h-10 w-10 rounded-full" />
      <div className="space-y-1.5 w-[132px]">
        <Skeleton className="h-3 w-24 ml-auto" />
        <Skeleton className="h-3 w-12 ml-auto" />
      </div>
      <Skeleton className="h-8 w-8 rounded-full" />
    </div>
  )
}

function ProfileMenu({
  displayName,
  displayRole,
  fullRole,
}: {
  displayName: string
  displayRole: string
  fullRole: string
}) {
  const { t } = useTranslation()
  const { signOut } = useAuthStore()
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const itemRefs = useRef<Array<HTMLAnchorElement | HTMLButtonElement | null>>([])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setOpen(false)
      triggerRef.current?.focus()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const moveFocus = (direction: 1 | -1) => {
    const current = itemRefs.current.findIndex((item) => item === document.activeElement)
    const next = current === -1
      ? (direction === 1 ? 0 : itemRefs.current.length - 1)
      : (current + direction + itemRefs.current.length) % itemRefs.current.length
    itemRefs.current[next]?.focus()
  }

  return (
    <div ref={menuRef} className="relative min-w-0">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls="profile-actions-menu"
        aria-label={`${displayName}, ${fullRole || displayRole}. Account actions`}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
            event.preventDefault()
            setOpen(true)
            requestAnimationFrame(() => moveFocus(event.key === 'ArrowDown' ? 1 : -1))
          }
        }}
        className="group flex max-w-[240px] items-center gap-2.5 rounded-lg px-1.5 py-1 text-left transition-colors hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"
      >
        <div className="text-right leading-tight min-w-0">
          <div className="text-[13px] text-slate-900 font-medium truncate max-w-[160px]">{displayName}</div>
          {displayRole && <div className="text-[11px] text-slate-400 truncate max-w-[160px]">{displayRole}</div>}
        </div>
        <span
          className="inline-flex items-center justify-center rounded-full bg-violet-600 text-white font-medium flex-shrink-0"
          style={{ width: 32, height: 32, fontSize: 11, letterSpacing: 0.4 }}
          aria-hidden="true"
        >
          {initialsOf(displayName)}
        </span>
      </button>

      {open && (
        <div
          id="profile-actions-menu"
          role="menu"
          aria-label="Account actions"
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault()
              moveFocus(event.key === 'ArrowDown' ? 1 : -1)
            }
          }}
          className="absolute right-0 top-full z-30 mt-2 w-44 overflow-hidden rounded-lg border border-slate-200 bg-white p-1 shadow-lg shadow-slate-900/10"
        >
          <Link
            ref={(element) => { itemRefs.current[0] = element }}
            to="/setup"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 rounded-md px-2.5 py-2 text-[13px] text-slate-700 hover:bg-slate-50 focus-visible:outline-none focus-visible:bg-violet-50 focus-visible:text-violet-800"
          >
            <SettingsMenuIcon />
            {t('chrome.settings')}
          </Link>
          <button
            ref={(element) => { itemRefs.current[1] = element }}
            type="button"
            role="menuitem"
            onClick={async () => {
              setOpen(false)
              await signOut()
            }}
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[13px] text-slate-600 hover:bg-slate-50 hover:text-slate-900 focus-visible:outline-none focus-visible:bg-violet-50 focus-visible:text-violet-800"
          >
            <SignOutMenuIcon />
            {t('chrome.signOut')}
          </button>
        </div>
      )}
    </div>
  )
}

function SettingsMenuIcon() {
  return <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1A2 2 0 1 1 4.4 17l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8L4.2 7A2 2 0 1 1 7 4.2l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1A2 2 0 1 1 19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg>
}

function SignOutMenuIcon() {
  return <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="M16 17l5-5-5-5" /><path d="M21 12H9" /></svg>
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
  const { t } = useTranslation()
  return (
    <div className="flex items-center gap-3 px-3 py-1.5 rounded-full bg-slate-50 border border-slate-200 whitespace-nowrap">
      <span className="meta-label text-slate-500">{t('chrome.topbar.currentScr')}</span>
      <Skeleton className="h-3.5 w-12" />
      <span className="w-px h-3.5 bg-slate-200" />
      <Skeleton className="h-3.5 w-16" />
    </div>
  )
}

function SCRErrorPill({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation()
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-red-50 border border-red-200 whitespace-nowrap">
      <span className="meta-label text-red-700">{t('chrome.topbar.currentScr')}</span>
      <span className="text-[12px] text-red-700">Unavailable</span>
      <button
        type="button"
        onClick={onRetry}
        className="text-[12px] font-medium text-violet-700 hover:text-violet-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 rounded"
      >
        Retry
      </button>
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
  const { t } = useTranslation()
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
        <span className="meta-label text-violet-700">{stackedOn ? t('chrome.topbar.projectedScr') : t('chrome.topbar.currentScr')}</span>
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
  const { t } = useTranslation()
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
    ? t('chrome.breakdown.manualOverride')
    : t('chrome.breakdown.derivedFromRoster')

  const statusColor = scrStatus === 'green' ? '#16a34a' : scrStatus === 'amber' ? '#f59e0b' : '#dc2626'

  if (!anchor) return null

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          id="scr-breakdown-popover"
          role="dialog"
          aria-label={t('chrome.breakdown.ariaTitle')}
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
                <div className="meta-label text-violet-700">{stackedOn ? t('chrome.topbar.projectedScr') : t('chrome.topbar.currentScr')}</div>
                <div className="flex items-baseline gap-2 mt-1">
                  <span className="num text-[22px] font-semibold text-slate-900 tabular-nums">{formatPercentage(scrPct / 100)}</span>
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
                aria-label={t('chrome.breakdown.ariaClose')}
                className="text-slate-400 hover:text-slate-600 -mr-1 mt-0.5"
              >
                <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 6L6 18" /><path d="M6 6l12 12" />
                </svg>
              </button>
            </div>
            {stackedOn && (
              <div className="mt-2 flex items-center gap-1.5 text-[11.5px]">
                <span className="text-slate-500">{t('chrome.breakdown.settingsOnly')}</span>
                <span className="num text-slate-700 font-medium tabular-nums">{formatPercentage(settingsOnlyPct / 100)}</span>
                {deltaDir !== 'flat' && (
                  <span
                    className={`inline-flex items-center gap-0.5 num font-medium tabular-nums ${
                      deltaDir === 'up' ? 'text-red-600' : 'text-emerald-600'
                    }`}
                  >
                    {deltaDir === 'up' ? '↑' : '↓'}{formatPercentagePointDelta(deltaAbs).replace('+', '')}
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Inputs from Settings */}
          <div className="px-4 py-3 border-b border-slate-100">
            <div className="meta-label mb-2">{t('chrome.breakdown.fromSettings')}</div>
            <BreakdownRow label={t('chrome.breakdown.footballRevenue')} value={fmtGBP(financials.footballRelatedRevenue)} />
            {financials.ownerEquityUsed1yr != null && financials.ownerEquityUsed1yr > 0 && (
              <BreakdownRow label={t('chrome.breakdown.ownerEquity')} value={`+ ${fmtGBP(financials.ownerEquityUsed1yr)}`} />
            )}
            <BreakdownRow
              label={t('chrome.breakdown.squadCosts')}
              value={fmtGBP(financials.currentSquadCosts)}
              hint={squadSrc}
            />
            <BreakdownRow
              label={t('chrome.breakdown.currentAllowance')}
              value={`${(financials.currentAllowanceRatio * 100).toFixed(0)}%`}
            />
          </div>

          {/* Scenarios stacked */}
          <div className="px-4 py-3">
            <div className="flex items-center justify-between mb-2">
              <div className="meta-label">{t('chrome.breakdown.scenariosStacked')}</div>
              <span className="text-[11px] text-slate-400">{t('chrome.breakdown.countOfTotal', { shown: included.length, total: scenarios.length })}</span>
            </div>
            {included.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-200 px-3 py-2.5">
                <div className="text-[12.5px] text-slate-600">{t('chrome.breakdown.noneIncluded')}</div>
                <div className="text-[11px] text-slate-400 mt-0.5">
                  {t('chrome.breakdown.noneIncludedHint')}
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
                      {t('common.actions', { count: s.actions.length })}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Footer link */}
          <div className="px-4 pt-1 pb-3 border-t border-slate-100 bg-slate-50/40 flex items-center justify-between">
            <span className="text-[11px] text-slate-400">
              {t('chrome.breakdown.adjustedRevenue')} <span className="num text-slate-600">{fmtGBP(baseline.adjustedRevenue)}</span>
            </span>
            <Link
              to="/scenarios"
              onClick={onClose}
              className="text-[11.5px] font-medium text-violet-600 hover:text-violet-700 inline-flex items-center gap-0.5"
            >
              {t('chrome.breakdown.manageScenarios')}
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
