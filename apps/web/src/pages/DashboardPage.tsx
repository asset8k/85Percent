/**
 * DashboardPage — MVP 2.0 home view.
 *
 * Shows the club's *live* SCR derived from the active roster (contracts), the
 * compliance gauge, and the per-player annual cost breakdown table. This is
 * the read-only "what's our current position" surface; the Scenarios page is
 * where users plan changes.
 *
 * Architecture:
 * - `financials.currentSquadCosts` is server-derived from contracts (see club.ts).
 * - The Active Baseline (TopBar pill) overlays included scenarios on top of
 *   that. The Dashboard shows BOTH baseline (no scenarios) and active SCR
 *   (with included scenarios) for clarity.
 */

import { useMemo } from 'react'
import { useTranslation, Trans } from 'react-i18next'
import { Link } from 'react-router-dom'
import { api, type ScenarioDetail, type ClubFinancialsResponse } from '@/lib/api'
import { useRosterQuery } from '@/lib/queries'
import { useClubStore } from '@/stores/club'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { useCan } from '@/lib/role'
import { Spinner } from '@/components/ui/spinner'
import { DashboardSkeleton } from '@/components/ui/page-skeletons'
import { ComplianceGauge } from '@/components/simulator/ComplianceGauge'
import { LeagueImpactTable } from '@/components/dashboard/LeagueImpactTable'
import { useLeagueTable, type UseLeagueTableResult } from '@/lib/useLeagueTable'
import { Skeleton } from '@/components/ui/skeleton'
import { computeActiveBaseline, computeThresholds, statusFromRatio, scenarioMoneyImpact } from '@/lib/scr'
import { exportSquadPDF } from '@/lib/exports/squadPdf'
import { calculateSquadCosts, calculateLevy, calculatePointsDeduction, type ContractInput } from '@85percent/engine'
import type { PlayerWithContract } from '@85percent/shared'
import { LEAGUE_CONFIGS } from '@85percent/shared'
import { useWorkspaceCurrency } from '@/lib/useWorkspaceCurrency'
import { findCountry, countryName } from '@/lib/countries'
import { activeLocale } from '@/lib/locale'
import { Flag } from '@/components/ui/flag'
import { AnimatedNumber } from '@/components/ui/animated-number'
import { cn } from '@/lib/utils'
import { useCopilot } from '@/stores/copilot'
import { CopilotTriggerButton } from '@/components/ai/CopilotTrigger'
import { compareByPosition, compareSquadNumbers } from '@/lib/positionSort'
import { TABLE_COLUMN_LABELS, formatSquadNumber, formatTableMoney, formatTimeLeft } from '@/lib/tablePresentation'
import { useTablePreferences } from '@/lib/useTablePreferences'

// Format a pence integer as a pretty symbol string ("£1,234,567") — used by the
// AnimatedNumber `format` callback so the intermediate frames during the
// count-up still render in the same shape as the final value. The symbol comes
// from the active workspace currency (defaults to £).
function formatPenceNumber(pence: number, symbol = '£') {
  return symbol + Math.round(pence / 100).toLocaleString('en-GB')
}

type SortKey = 'squadNumber' | 'name' | 'position' | 'wage' | 'amortisation' | 'agentFee' | 'total' | 'expiry'
type SortDir = 'asc' | 'desc'
type TableFilter = 'all' | 'expiring' | 'GK' | 'DEF' | 'MID' | 'FWD'

type DashboardTablePreferences = { sortKey: SortKey; sortDir: SortDir; filter: TableFilter }
const DASHBOARD_TABLE_DEFAULTS: DashboardTablePreferences = { sortKey: 'total', sortDir: 'desc', filter: 'all' }
const DASHBOARD_SORT_KEYS: SortKey[] = ['squadNumber', 'name', 'position', 'wage', 'amortisation', 'agentFee', 'total', 'expiry']
const TABLE_FILTERS: TableFilter[] = ['all', 'expiring', 'GK', 'DEF', 'MID', 'FWD']

function isDashboardTablePreferences(value: unknown): value is DashboardTablePreferences {
  if (!value || typeof value !== 'object') return false
  const preferences = value as Partial<DashboardTablePreferences>
  return DASHBOARD_SORT_KEYS.includes(preferences.sortKey as SortKey)
    && (preferences.sortDir === 'asc' || preferences.sortDir === 'desc')
    && TABLE_FILTERS.includes(preferences.filter as TableFilter)
}

export function DashboardPage() {
  const { t } = useTranslation()
  const { financials, financialsLoaded, scenarios, scenariosLoaded, clubName, leagueId, clubId, setScenarioInclusion } = useClubStore()
  const can = useCan()
  const { format: fmtMoney, symbol, currency } = useWorkspaceCurrency()
  // Hook must run unconditionally, before any early return below (loading /
  // no-financials), or the hook count changes when the loader clears → crash.
  const openCopilot = useCopilot((s) => s.open)
  // Squad is cached in the QueryClient (above the router), so returning to this
  // tab serves it instantly — no re-fetch, no skeleton — until it goes stale.
  const rosterQuery = useRosterQuery()
  const players = rosterQuery.data ?? []
  const error = rosterQuery.error instanceof Error ? rosterQuery.error.message : ''
  const tablePreferences = useTablePreferences(
    'dashboard-player-costs', clubId, DASHBOARD_TABLE_DEFAULTS, isDashboardTablePreferences,
  )
  const { sortKey, sortDir, filter } = tablePreferences.value
  const setSort = (nextSortKey: SortKey, nextSortDir: SortDir) => tablePreferences.setValue((current) => ({
    ...current, sortKey: nextSortKey, sortDir: nextSortDir,
  }))
  const setFilter = (nextFilter: TableFilter) => tablePreferences.setValue((current) => ({ ...current, filter: nextFilter }))

  // Live real-world standings — feeds the Consequence Engine (breach → impact
  // visualiser). Fetched unconditionally so the hook order is stable across the
  // page's early returns; the result is only consumed when a breach is detected.
  const leagueTable = useLeagueTable()

  // Per-player breakdown via the engine — same math the API uses to derive the total.
  const { totalSquadCostsPence, breakdownByPlayer } = useMemo(() => {
    const inputs: Array<ContractInput & { playerName: string; squadNumber: number | null; position: string | null; nationality: string | null; monthsToExpiry: number | null }> = players
      .filter((p) => p.contract)
      .map((p) => ({
        playerId: p.id,
        playerName: p.name,
        squadNumber: p.squadNumber,
        position: p.position,
        nationality: p.nationality,
        monthsToExpiry: p.monthsToExpiry,
        transferFeePence: p.contract!.transferFeePence,
        // Carried Book Value override (when set) replaces the transfer fee as the
        // amortisation principal — must be passed so the client-side live SCR
        // matches the server-derived `currentSquadCosts` (and the TopBar pill).
        carriedBookValuePence: p.contract!.carriedBookValuePence,
        annualWagePence:  p.contract!.annualWagePence,
        agentFeePence:    p.contract!.agentFeePence,
        contractLengthYears: p.contract!.contractLengthYears,
        annualAmortisationOverridePence: p.contract!.annualAmortisationPence,
        annualisedAgentFeeOverridePence: p.contract!.annualisedAgentFeePence,
      }))
    const { totalSquadCostsPence, breakdown } = calculateSquadCosts(inputs)
    const map = new Map<string, typeof breakdown[number]>()
    for (const b of breakdown) map.set(b.playerId, b)
    const canonicalTotals = new Map(
      players.flatMap((player) => player.contract ? [[player.id, player.contract.totalAnnualCostPence] as const] : []),
    )
    const canonicalBreakdown = inputs.map((p) => ({
      ...p,
      ...map.get(p.playerId)!,
      // This is the server-resolved, canonical player total also used by the
      // Roster. The engine remains the source for its component breakdown.
      totalAnnualCostPence: canonicalTotals.get(p.playerId) ?? map.get(p.playerId)!.totalAnnualCostPence,
    }))
    return {
      totalSquadCostsPence: canonicalBreakdown.reduce((sum, row) => sum + row.totalAnnualCostPence, 0) || totalSquadCostsPence,
      breakdownByPlayer: canonicalBreakdown,
    }
  }, [players])

  const filteredBreakdown = useMemo(() => {
    let rows = breakdownByPlayer
    if (filter === 'expiring') {
      rows = rows.filter((r) => r.monthsToExpiry != null && r.monthsToExpiry <= 6)
    } else if (filter !== 'all') {
      rows = rows.filter((r) => r.position === filter)
    }
    const sorted = [...rows]
    const cmp = (a: typeof rows[number], b: typeof rows[number]) => {
      const dir = sortDir === 'asc' ? 1 : -1
      switch (sortKey) {
        case 'squadNumber': {
          const numberOrder = compareSquadNumbers(a.squadNumber, b.squadNumber, sortDir)
          return numberOrder || a.playerName.localeCompare(b.playerName)
        }
        case 'name':     return a.playerName.localeCompare(b.playerName) * dir
        case 'position': return compareByPosition({ position: a.position, squadNumber: a.squadNumber, name: a.playerName }, { position: b.position, squadNumber: b.squadNumber, name: b.playerName }, sortDir)
        case 'wage':     return (a.wagePence - b.wagePence) * dir
        case 'amortisation': return (a.amortisationPence - b.amortisationPence) * dir
        case 'agentFee': return (a.annualisedAgentFeePence - b.annualisedAgentFeePence) * dir
        case 'total':    return (a.totalAnnualCostPence - b.totalAnnualCostPence) * dir
        case 'expiry':   return ((a.monthsToExpiry ?? 9999) - (b.monthsToExpiry ?? 9999)) * dir
      }
    }
    sorted.sort(cmp)
    return sorted
  }, [breakdownByPlayer, filter, sortKey, sortDir])

  // Baseline (no scenarios) — use the Financials API's canonical value rather
  // than the player-only table sum. The API includes an active head coach and
  // honours the explicit manual override when the club has selected one.
  // Active baseline (with included scenarios) — shown in the TopBar pill.
  const baseline = useMemo(() => {
    if (!financials) return null
    return {
      squadCostsPence: financials.currentSquadCosts,
      revenuePence: financials.footballRelatedRevenue + (financials.ownerEquityUsed1yr ?? 0),
    }
  }, [financials])

  const ratio = baseline && baseline.revenuePence > 0
    ? baseline.squadCostsPence / baseline.revenuePence
    : 0
  const status = financials ? statusFromRatio(ratio, financials.currentAllowanceRatio) : 'green'
  const thresholds = baseline ? computeThresholds(baseline.revenuePence, financials!.currentAllowanceRatio) : null

  const activeBaseline = useMemo(
    () => financials ? computeActiveBaseline(financials, scenarios) : null,
    [financials, scenarios]
  )

  // Hold the skeleton until BOTH the roster and the included scenarios are in —
  // the hero SCR overlay, gauge and financial-risk card all fold in scenarios,
  // so revealing before they load would show numbers that then jump. (Only gate
  // on scenarios when financials exist, since that's the only case we fetch them.)
  // Hold the skeleton until financials are actually known (loaded), so we never
  // flash the "set up your club" empty-state while they're still in flight. Once
  // loaded: null ⇒ genuine empty-state; present ⇒ wait for scenarios to fold in.
  if (rosterQuery.isPending || !financialsLoaded || (financials != null && !scenariosLoaded) || !tablePreferences.ready)
    return <DashboardSkeleton />

  if (error) {
    return (
      <div>
        <PageHeader />
        <Card className="p-6 border-red-200 bg-red-50">
          <p className="text-[13px] text-red-700">{error}</p>
        </Card>
      </div>
    )
  }

  if (!financials) {
    return (
      <div>
        <PageHeader />
        <Card className="p-12 text-center">
          <p className="text-[15px] font-medium text-slate-900">{t('dashboard.setup.title')}</p>
          <p className="text-[13px] text-slate-500 mt-2">
            {t('dashboard.setup.body')}
          </p>
          <Link to="/financials" className="inline-block mt-5">
            <Button>{t('dashboard.setup.cta')}</Button>
          </Link>
        </Card>
      </div>
    )
  }

  if (players.length === 0) {
    return (
      <div>
        <PageHeader />
        <Card className="p-12 text-center">
          <p className="text-[15px] font-medium text-slate-900">{t('dashboard.noPlayers.title')}</p>
          <p className="text-[13px] text-slate-500 mt-2 max-w-md mx-auto">
            {t('dashboard.noPlayers.body')}
          </p>
          <Link to="/roster" className="inline-block mt-5">
            <Button>{t('dashboard.noPlayers.cta')}</Button>
          </Link>
        </Card>
      </div>
    )
  }

  const currentPct = ratio * 100
  const greenPct = 85
  const redPct = baseline && baseline.revenuePence > 0
    ? (thresholds!.redPence / baseline.revenuePence) * 100
    : 85

  // Projected regulatory sanctions. Computed on the *active* position — live
  // squad costs PLUS any included scenarios — so it matches the Projected SCR
  // pill rather than the bare live ratio (a club can be compliant today but in
  // the points-deduction zone once an included transfer plan is applied). Levy
  // applies in the amber zone (over Green), points deduction in the red zone.
  const cfg = LEAGUE_CONFIGS[leagueId ?? 'efl-championship'] ?? LEAGUE_CONFIGS['efl-championship']!
  const riskSquadCostsPence = activeBaseline?.baselineSquadCosts ?? totalSquadCostsPence
  const riskRevenuePence     = activeBaseline?.adjustedRevenue ?? baseline!.revenuePence
  const riskStatus           = activeBaseline?.status ?? status
  const includedCount        = activeBaseline?.includedCount ?? 0
  const riskThresholds = computeThresholds(riskRevenuePence, financials.currentAllowanceRatio)
  const levyPence = calculateLevy(riskSquadCostsPence, riskThresholds.greenPence, riskRevenuePence, cfg.greenThresholdRatio)
  const pointsDeduction = calculatePointsDeduction(riskSquadCostsPence, riskThresholds.redPence, cfg.pointsDeductionPerUnit, cfg.pointsDeductionBasePoints)
  const overspendGreenPence = riskSquadCostsPence - riskThresholds.greenPence
  const riskHeadroomPence   = riskThresholds.greenPence - riskSquadCostsPence

  // Status-tinted styling for the (now prominent) included-scenarios row.
  const activeStatus = activeBaseline?.status ?? 'green'
  const activePillStyle = activeStatus === 'red'
    ? 'bg-red-50 border-red-200'
    : activeStatus === 'amber' ? 'bg-amber-50 border-amber-200' : 'bg-green-50 border-green-200'
  const activeNumStyle = activeStatus === 'red'
    ? 'text-red-700'
    : activeStatus === 'amber' ? 'text-amber-700' : 'text-green-700'

  // Toggle a scenario's inclusion straight from the dashboard. Optimistic — the
  // store update recomputes the Active Baseline immediately, so the hero %,
  // headroom, gauge and consequence section all move the moment the switch
  // flips; the API call is reconciled in the background (rolled back on error).
  const handleToggleInclude = async (id: string, next: boolean) => {
    setScenarioInclusion(id, next)
    try {
      await api.scenarios.update(id, { isIncluded: next })
    } catch {
      setScenarioInclusion(id, !next)
    }
  }

  const handleExport = () => {
    if (!financials || players.length === 0) return
    exportSquadPDF({
      clubName: clubName ?? '85Percent FC',
      leagueId: leagueId ?? 'efl-championship',
      financials,
      players,
      currency,
    })
  }

  // Phase 4 trigger — serialize the current compliance position (engine output)
  // and open the Co-pilot for an immediate plain-English breakdown.
  // (openCopilot hook is declared at the top of the component, above the early
  // returns — see note there.)
  const handleAskCopilot = () =>
    openCopilot({
      module: 'Dashboard',
      data: {
        totalRevenue: fmtMoney(riskRevenuePence),
        totalSquadCosts: fmtMoney(riskSquadCostsPence),
        currentSCR: `${currentPct.toFixed(1)}%`,
        zone:
          riskStatus === 'green'
            ? 'Green — compliant'
            : riskStatus === 'amber'
              ? 'Amber — levy zone'
              : 'Red — points-deduction risk',
        headroomToGreen:
          riskHeadroomPence >= 0
            ? fmtMoney(riskHeadroomPence)
            : `−${fmtMoney(Math.abs(riskHeadroomPence))}`,
        greenThreshold: fmtMoney(riskThresholds.greenPence),
        redThreshold: fmtMoney(riskThresholds.redPence),
        includedScenarios: includedCount,
      },
    })

  return (
    <div>
      <PageHeader onExport={handleExport} canExport={players.length > 0} />

      {/* Hero — derived SCR position */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {/* Big SCR card */}
        <Card className="col-span-2 p-6">
          <div className="flex items-start justify-between mb-5">
            <div>
              <div className="meta-label">{t('dashboard.hero.liveScr')}</div>
              <p className="text-[12px] text-slate-500 mt-1">
                {t('dashboard.hero.derivedFrom', { count: players.length })}
              </p>
            </div>
            <div className="flex flex-col items-end gap-2">
              {/* Reflects the ACTIVE position (live squad costs + any included
                  scenarios) so it can't read "Compliant" while an included plan
                  has pushed the projected SCR into the levy / points-risk zone —
                  matches the TopBar pill and the projected row below. */}
              <StatusBadge status={riskStatus}>
                {riskStatus === 'green' ? t('common.status.compliant') : riskStatus === 'amber' ? t('common.status.levyZone') : t('common.status.pointsRisk')}
              </StatusBadge>
              <CopilotTriggerButton onClick={handleAskCopilot} size="sm" />
            </div>
          </div>
          <div className="flex items-baseline gap-3">
            <AnimatedNumber
              value={currentPct}
              decimals={1}
              suffix="%"
              className={cn(
                'num text-[44px] font-semibold leading-none',
                status === 'green' ? 'text-slate-900' : status === 'amber' ? 'text-amber-700' : 'text-red-700'
              )}
            />
            <span className="text-[14px] text-slate-400">{t('dashboard.hero.ofRevenue')}</span>
          </div>
          {activeBaseline && activeBaseline.includedCount > 0 && (
            <div className={cn('mt-5 flex items-center justify-between gap-3 rounded-xl border px-4 py-3', activePillStyle)}>
              <div className="flex items-center gap-2.5 flex-wrap">
                <span className="meta-label text-slate-600">
                  {t('dashboard.hero.withIncluded', { count: activeBaseline.includedCount })}
                </span>
                <StatusBadge status={activeBaseline.status}>
                  {activeBaseline.status === 'green' ? t('common.status.compliant') : activeBaseline.status === 'amber' ? t('common.status.levyZone') : t('common.status.pointsRisk')}
                </StatusBadge>
              </div>
              <div className="flex items-baseline gap-2">
                <AnimatedNumber
                  value={activeBaseline.ratio * 100}
                  decimals={1}
                  suffix="%"
                  className={cn('num text-[24px] font-semibold leading-none', activeNumStyle)}
                />
                <span className="text-[12px] text-slate-400">{t('dashboard.hero.ofRevenue')}</span>
              </div>
            </div>
          )}
        </Card>

        {/* Threshold stat — reflects the ACTIVE position (live squad costs plus
            any included scenarios), so it stays in step with the SCR pill rather
            than reporting the bare settings-only headroom. */}
        <Card className="p-6 flex flex-col">
          <div className="flex items-center justify-between">
            <div className="meta-label">{t('dashboard.headroom.title')}</div>
            {includedCount > 0 && (
              <span className="text-[10px] font-medium uppercase tracking-wide text-violet-600 bg-violet-50 rounded px-1.5 py-0.5">
                {t('dashboard.headroom.inclScenarios', { count: includedCount })}
              </span>
            )}
          </div>
          <AnimatedNumber
            value={riskHeadroomPence}
            format={(n) => (n >= 0 ? formatPenceNumber(n, symbol) : `−${formatPenceNumber(Math.abs(n), symbol)}`)}
            className={cn(
              'num text-[28px] font-semibold leading-none mt-3',
              riskHeadroomPence >= 0 ? 'text-slate-900' : 'text-red-700'
            )}
          />
          <div className="text-[12px] text-slate-400 mt-2 num">
            {t('dashboard.headroom.greenThreshold', { value: fmtMoney(riskThresholds.greenPence) })}
          </div>
          <div className="text-[12px] text-slate-400 num">
            {t('dashboard.headroom.revenue', { value: fmtMoney(riskRevenuePence) })}
          </div>
        </Card>
      </div>

      {/* Scenario inclusion — toggle planned scenarios into the live position.
          Each switch recomputes the Active Baseline, moving the SCR %, headroom
          and gauge above in real time. */}
      {scenarios.length > 0 && (
        <ScenarioInclusionCard
          scenarios={scenarios}
          financials={financials}
          canToggle={can.toggleActiveBaseline}
          onToggle={handleToggleInclude}
        />
      )}

      {/* Consequence Engine — regulatory breach → real-world league impact.
          Renders only in the red (points-deduction) zone. */}
      {riskStatus === 'red' && (
        <ConsequenceSection pointsDeducted={pointsDeduction} leagueTable={leagueTable} />
      )}

      {/* Compliance Gauge */}
      <Card className="p-6 mb-6">
        <ComplianceGauge
          currentPct={currentPct}
          projectedPct={
            activeBaseline && activeBaseline.includedCount > 0
              ? activeBaseline.ratio * 100
              : currentPct
          }
          greenPct={greenPct}
          redPct={redPct}
        />
      </Card>

      {/* Financial risk — levy (amber) / headroom (green). In the red zone the
          points deduction is shown once, by the Consequence Engine above, so we
          drop this card to avoid repeating the same figure. */}
      {riskStatus !== 'red' && (
        <FinancialRiskCard
          status={riskStatus}
          levyPence={levyPence}
          overspendGreenPence={overspendGreenPence}
          headroomPence={riskHeadroomPence}
          includedCount={includedCount}
        />
      )}

      {/* Breakdown table */}
      <Card className="overflow-hidden">
        <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <span className="inline-block w-1 h-5 rounded-full bg-violet-600" />
            <div>
              <h3 className="text-[15px] font-semibold text-slate-900 leading-tight">{t('dashboard.table.title')}</h3>
              <p className="text-[12px] text-slate-500 mt-0.5">
                {t('dashboard.table.subtitle')}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {(['all', 'expiring', 'GK', 'DEF', 'MID', 'FWD'] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={cn(
                  'px-3 py-1.5 text-[12px] font-medium rounded-full border transition-colors',
                  filter === f
                    ? 'border-violet-600 bg-violet-600 text-white'
                    : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
                )}
              >
                {f === 'all' ? t('dashboard.table.filterAll') : f === 'expiring' ? t('dashboard.table.filterExpiring') : t(`common.positions.${f}`)}
              </button>
            ))}
            {!tablePreferences.isDefault && (
              <button
                type="button"
                onClick={tablePreferences.reset}
                className="px-2 py-1.5 text-[12px] font-medium text-slate-500 hover:text-violet-700"
              >
                Reset view
              </button>
            )}
          </div>
        </div>

        <div className="overflow-x-auto">
        <table className="w-full min-w-[720px]">
          <thead className="border-b border-slate-100 bg-slate-50/40">
            <tr>
              <SortableTh field="squadNumber"  label={TABLE_COLUMN_LABELS.squadNumber}       align="right" sortKey={sortKey} sortDir={sortDir} onSort={setSort} />
              <SortableTh field="name"         label={TABLE_COLUMN_LABELS.name}              align="left"  sortKey={sortKey} sortDir={sortDir} onSort={setSort} />
              <SortableTh field="position"     label={TABLE_COLUMN_LABELS.position}          align="left"  sortKey={sortKey} sortDir={sortDir} onSort={setSort} />
              <SortableTh field="wage"         label={TABLE_COLUMN_LABELS.annualWage}        align="right" sortKey={sortKey} sortDir={sortDir} onSort={setSort} />
              <SortableTh field="amortisation" label={TABLE_COLUMN_LABELS.amortisation}      align="right" sortKey={sortKey} sortDir={sortDir} onSort={setSort} />
              <SortableTh field="agentFee"     label={TABLE_COLUMN_LABELS.agentFees}         align="right" sortKey={sortKey} sortDir={sortDir} onSort={setSort}
                titleHint={t('dashboard.table.agentFeeHint')}
              />
              <SortableTh field="total"        label={TABLE_COLUMN_LABELS.annualCost}        align="right" sortKey={sortKey} sortDir={sortDir} onSort={setSort} />
              <SortableTh field="expiry"       label={TABLE_COLUMN_LABELS.timeLeft}          align="right" sortKey={sortKey} sortDir={sortDir} onSort={setSort} />
            </tr>
          </thead>
          <tbody>
            {filteredBreakdown.map((row) => (
              <tr key={row.playerId} className="border-b border-slate-100 last:border-0 hover:bg-violet-50/40 transition-colors">
                <td className="px-6 py-3.5 text-[13px] num text-right text-slate-500 tabular-nums w-12">{formatSquadNumber(row.squadNumber)}</td>
                <td className="px-6 py-3.5 text-[14px] text-slate-900 font-medium">
                  <span className="inline-flex items-center gap-2 align-middle">
                    <NationalityFlag nationality={row.nationality} />
                    <span>{row.playerName}</span>
                  </span>
                </td>
                <td className="px-6 py-3.5">
                  <PositionPill position={row.position} />
                </td>
                <td className="px-6 py-3.5 text-[13px] num text-right text-slate-700">{formatTableMoney(row.wagePence, fmtMoney)}</td>
                <td className="px-6 py-3.5 text-[13px] num text-right text-slate-700">{formatTableMoney(row.amortisationPence, fmtMoney)}</td>
                <td className="px-6 py-3.5 text-[13px] num text-right text-slate-700">{formatTableMoney(row.annualisedAgentFeePence, fmtMoney)}</td>
                <td className="px-6 py-3.5 text-[13px] num text-right text-slate-900 font-medium">{formatTableMoney(row.totalAnnualCostPence, fmtMoney)}</td>
                <td className="px-6 py-3.5 text-right">
                  <ExpiryChip months={row.monthsToExpiry} />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-slate-50/60 border-t border-slate-200">
            <tr>
              <td className="px-6 py-3.5 text-[12px] meta-label" colSpan={6}>{t('dashboard.table.totalRow', { count: filteredBreakdown.length })}</td>
              <td className="px-6 py-3.5 text-[14px] num text-right text-slate-900 font-semibold">
                {formatTableMoney(filteredBreakdown.reduce((s, r) => s + r.totalAnnualCostPence, 0), fmtMoney)}
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
        </div>
      </Card>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function PageHeader({
  onExport, canExport,
}: { onExport?: () => void; canExport?: boolean } = {}) {
  const { t } = useTranslation()
  return (
    <div className="mb-6 flex items-center gap-3">
      <span className="inline-block w-1.5 h-7 rounded-full bg-violet-600" />
      <div className="flex-1">
        <h1 className="text-[24px] font-bold text-slate-900 tracking-tight leading-none">
          {t('nav.dashboard')}
        </h1>
        <p className="text-[13px] text-slate-500 mt-1.5">
          {t('dashboard.subtitle')}
        </p>
      </div>
      {onExport && (
        <Button variant="secondary" onClick={onExport} disabled={!canExport}>
          {t('dashboard.exportPdf')}
        </Button>
      )}
      <Link to="/scenarios">
        <Button variant="outline">{t('dashboard.planScenario')}</Button>
      </Link>
    </div>
  )
}

// Projected regulatory risk for the current SCR position — the GREEN (no
// sanction, shows headroom) and AMBER (financial levy) states only. The RED
// points-deduction zone is owned by the Consequence Engine section, which
// renders the figure once with the league-table impact, so this card is not
// shown in that state.
function FinancialRiskCard({
  status, levyPence, overspendGreenPence, headroomPence, includedCount,
}: {
  status: 'green' | 'amber' | 'red'
  levyPence: number
  overspendGreenPence: number
  headroomPence: number
  includedCount: number
}) {
  const { t } = useTranslation()
  const { format: fmtMoney } = useWorkspaceCurrency()
  return (
    <Card className="p-6 mb-6">
      <div className="flex items-center gap-3 mb-4">
        <span className="inline-block w-1 h-5 rounded-full bg-violet-600" />
        <div>
          <h3 className="text-[15px] font-semibold text-slate-900 leading-tight">{t('dashboard.risk.title')}</h3>
          <p className="text-[12px] text-slate-500 mt-0.5">
            {includedCount > 0
              ? t('dashboard.risk.subtitleIncluded', { count: includedCount })
              : t('dashboard.risk.subtitleNone')}
          </p>
        </div>
      </div>

      {status === 'green' && (
        <div className="rounded-xl border border-slate-200 border-l-4 border-green-500 bg-green-50 p-5 flex items-start justify-between gap-4">
          <div>
            <div className="meta-label text-green-700">{t('dashboard.risk.noSanctions')}</div>
            <p className="text-[13px] text-slate-700 mt-2 max-w-xl">
              {t('dashboard.risk.noSanctionsBody')}
            </p>
          </div>
          <div className="text-right flex-shrink-0">
            <div className="meta-label">{t('dashboard.headroom.title')}</div>
            <div className="num text-[24px] font-semibold text-green-700 leading-none mt-1.5">{fmtMoney(headroomPence)}</div>
          </div>
        </div>
      )}

      {status === 'amber' && (
        <div className="rounded-xl border border-slate-200 border-l-4 border-amber-500 bg-amber-50 p-5 flex items-start justify-between gap-4">
          <div>
            <div className="meta-label text-amber-700">{t('dashboard.risk.levyTitle')}</div>
            <p className="text-[13px] text-slate-700 mt-2 max-w-xl">
              <Trans
                i18nKey="dashboard.risk.levyBody"
                values={{ value: fmtMoney(overspendGreenPence) }}
                components={{ s: <span className="num text-amber-700" /> }}
              />
            </p>
          </div>
          <div className="num text-[32px] font-semibold text-amber-700 leading-none flex-shrink-0">{fmtMoney(levyPence)}</div>
        </div>
      )}
    </Card>
  )
}

// ---------------------------------------------------------------------------
// Scenario inclusion — interactive switches that fold planned scenarios into
// the live Active Baseline. Toggling recomputes the SCR % / headroom / gauge
// above instantly (optimistic store update).
// ---------------------------------------------------------------------------
function ScenarioInclusionCard({
  scenarios, financials, canToggle, onToggle,
}: {
  scenarios: ScenarioDetail[]
  financials: ClubFinancialsResponse
  canToggle: boolean
  onToggle: (id: string, next: boolean) => void
}) {
  const { t } = useTranslation()
  const includedCount = scenarios.filter((s) => s.isIncluded).length
  return (
    <Card className="p-6 mb-6">
      <div className="flex items-center gap-3 mb-4">
        <span className="inline-block w-1 h-5 rounded-full bg-violet-600" />
        <div className="flex-1">
          <h3 className="text-[15px] font-semibold text-slate-900 leading-tight">{t('dashboard.inclusion.title')}</h3>
          <p className="text-[12px] text-slate-500 mt-0.5">
            {t('dashboard.inclusion.subtitle')}
          </p>
        </div>
        <span className="text-[12px] text-slate-400 num whitespace-nowrap">
          {t('dashboard.inclusion.summary', { count: includedCount, total: scenarios.length })}
        </span>
      </div>

      <div className="space-y-1.5">
        {scenarios.map((s) => {
          const impact = scenarioMoneyImpact(financials, s)
          return (
            <div
              key={s.id}
              className={cn(
                'flex items-center justify-between gap-3 rounded-xl border px-4 py-3 transition-colors',
                s.isIncluded ? 'border-violet-200 bg-violet-50/60' : 'border-slate-200 bg-white',
              )}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <span className={cn('inline-block w-1.5 h-1.5 rounded-full flex-shrink-0', s.isIncluded ? 'bg-violet-500' : 'bg-slate-300')} />
                <div className="min-w-0">
                  <Link
                    to="/scenarios"
                    className="text-[14px] font-medium text-slate-900 hover:text-violet-700 transition-colors truncate block"
                  >
                    {s.name}
                  </Link>
                  <div className="text-[11px] text-slate-400 num">
                    {t('common.actions', { count: s.actions.length })}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3 flex-shrink-0">
                {/* SCR money impact — shown only while the scenario is included
                    in the live calculation, per the inclusion rule. */}
                {s.isIncluded ? (
                  <ScenarioImpactBadge impact={impact} />
                ) : (
                  <span className="text-[11px] font-medium text-slate-400">{t('dashboard.inclusion.excluded')}</span>
                )}
                <Switch
                  checked={s.isIncluded}
                  onChange={(next) => onToggle(s.id, next)}
                  disabled={!canToggle}
                  tooltip={canToggle ? undefined : t('dashboard.inclusion.lockTooltip')}
                  aria-label={t('dashboard.inclusion.includeAria', { name: s.name })}
                />
              </div>
            </div>
          )
        })}
      </div>
    </Card>
  )
}

// Compact signed money figure for a scenario's effect on SCR headroom.
// + (green) frees room toward the Green threshold; − (red) consumes it. The
// title surfaces the cost / revenue split behind the net figure.
function ScenarioImpactBadge({ impact }: { impact: ReturnType<typeof scenarioMoneyImpact> }) {
  const { t } = useTranslation()
  const { symbol } = useWorkspaceCurrency()
  const net = impact.headroomDeltaPence
  const frees = net >= 0
  const title =
    t('dashboard.impact.net', { value: signedCompactPence(net, symbol) }) + '\n' +
    t('dashboard.impact.costs', { value: signedCompactPence(-impact.costDeltaPence, symbol) }) +
    (impact.revenueDeltaPence !== 0 ? '\n' + t('dashboard.impact.revenue', { value: signedCompactPence(impact.revenueDeltaPence, symbol) }) : '')
  return (
    <span
      title={title}
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-semibold num whitespace-nowrap',
        frees ? 'text-green-700 bg-green-50 border border-green-200' : 'text-red-700 bg-red-50 border border-red-200',
      )}
    >
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
        {frees ? <path d="M12 19V5M5 12l7-7 7 7" /> : <path d="M12 5v14M19 12l-7 7-7-7" />}
      </svg>
      {signedCompactPence(net, symbol)}
    </span>
  )
}

// Pence → compact signed money string: "+£8.2M", "−€450K", "$0". Symbol comes
// from the active workspace currency (defaults to £).
function signedCompactPence(pence: number, symbol = '£'): string {
  const pounds = Math.round(pence / 100)
  if (pounds === 0) return `${symbol}0`
  const sign = pounds > 0 ? '+' : '−'
  const abs = Math.abs(pounds)
  let body: string
  if (abs >= 1_000_000) body = `${symbol}${(abs / 1_000_000).toFixed(1)}M`
  else if (abs >= 1_000) body = `${symbol}${(abs / 1_000).toFixed(0)}K`
  else body = `${symbol}${abs}`
  return `${sign}${body}`
}

// The Consequence Engine block: a high-visibility breach alert plus the
// real-world league-impact visualiser. Shown only when the club is in the
// points-deduction zone. The league table is fetched independently, so this
// gracefully degrades — skeleton while loading, and a contained notice if the
// standings can't be reached or the club isn't matched in the table.
function ConsequenceSection({
  pointsDeducted,
  leagueTable,
}: {
  pointsDeducted: number
  leagueTable: UseLeagueTableResult
}) {
  const { t } = useTranslation()
  const { data, loading, error, clubRowIndex } = leagueTable
  return (
    <div className="mb-6">
      <ConsequenceAlert pointsDeducted={pointsDeducted} />

      {loading && (
        <div className="rounded-xl border border-slate-200 bg-white p-5 space-y-3">
          <Skeleton className="h-5 w-56" />
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4">
              <Skeleton className="h-4 w-5" />
              <Skeleton className="h-4 flex-1 max-w-[200px]" />
              <Skeleton className="h-4 w-8 ml-auto" />
            </div>
          ))}
        </div>
      )}

      {!loading && data && clubRowIndex !== -1 && (
        <LeagueImpactTable
          standings={data.standings}
          clubRowIndex={clubRowIndex}
          pointsDeducted={pointsDeducted}
          competition={data.competition}
        />
      )}

      {!loading && (error || !data || clubRowIndex === -1) && (
        <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-5">
          <p className="text-[13px] text-slate-600">
            {error || !data
              ? t('dashboard.consequence.standingsUnavailable')
              : t('dashboard.consequence.clubNotMatched')}
          </p>
        </div>
      )}
    </div>
  )
}

// "Regulatory Breach Detected" banner — danger-styled, mirrors the result-panel
// rail pattern used across the app (rounded-xl + left rail + tint).
function ConsequenceAlert({ pointsDeducted }: { pointsDeducted: number }) {
  const { t } = useTranslation()
  return (
    <div className="rounded-xl border border-red-200 border-l-4 border-l-red-600 bg-red-50 p-5 mb-4 flex items-start gap-4">
      <span className="inline-flex items-center justify-center w-9 h-9 rounded-full bg-red-100 text-red-600 flex-shrink-0">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round">
          <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
          <path d="M12 9v4" /><path d="M12 17h.01" />
        </svg>
      </span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="meta-label text-red-700">{t('dashboard.consequence.breach')}</span>
          <StatusBadge status="red">{t('common.status.pointsRisk')}</StatusBadge>
        </div>
        <p className="text-[14px] text-slate-800 mt-1.5 leading-snug">
          <Trans
            i18nKey="dashboard.consequence.sanctionBody"
            count={pointsDeducted}
            components={{ s: <span className="num font-semibold text-red-700" /> }}
          />
        </p>
      </div>
      <div className="num text-[34px] font-semibold text-red-700 leading-none whitespace-nowrap flex-shrink-0 self-center">
        −{pointsDeducted}
        <span className="text-[14px] font-medium text-red-500 ml-1">{t('dashboard.consequence.pts')}</span>
      </div>
    </div>
  )
}

function SortableTh({
  field, label, align, sortKey, sortDir, onSort, titleHint,
}: {
  field: SortKey
  label: string
  align: 'left' | 'right'
  sortKey: SortKey
  sortDir: SortDir
  onSort: (f: SortKey, d: SortDir) => void
  titleHint?: string
}) {
  const isActive = sortKey === field
  const handle = () => {
    if (isActive) onSort(field, sortDir === 'asc' ? 'desc' : 'asc')
    else onSort(field, align === 'right' ? 'desc' : 'asc')
  }
  return (
    <th
      onClick={handle}
      title={titleHint}
      className={cn(
        'meta-label px-6 py-3 cursor-pointer select-none whitespace-nowrap',
        align === 'right' ? 'text-right' : 'text-left',
        'hover:text-slate-700 transition-colors',
        isActive && 'text-violet-700'
      )}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {isActive && (
          <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            {sortDir === 'asc' ? <path d="M3 8l3-4 3 4" /> : <path d="M3 4l3 4 3-4" />}
          </svg>
        )}
      </span>
    </th>
  )
}

// Renders a sharp SVG country flag for a player's nationality. Returns null
// when the value is empty or doesn't match a known country (e.g. legacy
// free-text values) — keeps the row clean rather than showing a placeholder.
function NationalityFlag({ nationality }: { nationality: string | null }) {
  const country = findCountry(nationality)
  if (!country) return null
  return <Flag code={country.code} title={countryName(country, activeLocale())} width={20} />
}

function PositionPill({ position }: { position: string | null }) {
  const { t } = useTranslation()
  if (!position) return <span className="text-[12px] text-slate-400">—</span>
  // Known position codes map to localized abbreviations; unknown values pass through.
  const label = t(`common.positions.${position}`, { defaultValue: position })
  return (
    <span className="inline-block text-[11px] font-medium px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 whitespace-nowrap">
      {label}
    </span>
  )
}

function ExpiryChip({ months }: { months: number | null }) {
  const { t } = useTranslation()
  if (months == null) return <span className="text-slate-400 text-[12px]">—</span>
  if (months < 0) return <span className="text-red-700 num text-[12px]">{t('dashboard.expiry.expired')}</span>
  if (months <= 6) {
    return (
      <span className="inline-block text-[11px] font-medium px-2 py-0.5 rounded-md bg-amber-100 text-amber-700 whitespace-nowrap">
        {formatTimeLeft(months, t)}
      </span>
    )
  }
  return <span className="text-slate-500 text-[12px] whitespace-nowrap">{formatTimeLeft(months, t)}</span>
}
