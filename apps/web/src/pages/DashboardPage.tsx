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

import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '@/lib/api'
import { useClubStore } from '@/stores/club'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/components/ui/badge'
import { Spinner } from '@/components/ui/spinner'
import { DashboardSkeleton } from '@/components/ui/page-skeletons'
import { ComplianceGauge } from '@/components/simulator/ComplianceGauge'
import { computeActiveBaseline, computeThresholds, statusFromRatio } from '@/lib/scr'
import { exportSquadPDF } from '@/lib/exports/squadPdf'
import { calculateSquadCosts, calculateLevy, calculatePointsDeduction, type ContractInput } from '@headroom/engine'
import type { PlayerWithContract } from '@headroom/shared'
import { formatPence, LEAGUE_CONFIGS } from '@headroom/shared'
import { findCountry } from '@/lib/countries'
import { Flag } from '@/components/ui/flag'
import { AnimatedNumber } from '@/components/ui/animated-number'
import { cn } from '@/lib/utils'

// Format a pence integer as a pretty £ string ("£1,234,567") — used by the
// AnimatedNumber `format` callback so the intermediate frames during the
// count-up still render in the same shape as the final value.
function formatPenceNumber(pence: number) {
  return '£' + Math.round(pence / 100).toLocaleString('en-GB')
}

type SortKey = 'squadNumber' | 'name' | 'position' | 'wage' | 'amortisation' | 'agentFee' | 'total' | 'expiry'
type SortDir = 'asc' | 'desc'

export function DashboardPage() {
  const { financials, scenarios, scenariosLoaded, clubName, leagueId } = useClubStore()
  const [players, setPlayers] = useState<PlayerWithContract[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('total')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [filter, setFilter] = useState<'all' | 'expiring' | 'GK' | 'DEF' | 'MID' | 'FWD'>('all')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    api.roster.list()
      .then((data) => { if (!cancelled) setPlayers(data.players) })
      .catch((e: Error) => { if (!cancelled) setError(e.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

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
      }))
    const { totalSquadCostsPence, breakdown } = calculateSquadCosts(inputs)
    const map = new Map<string, typeof breakdown[number]>()
    for (const b of breakdown) map.set(b.playerId, b)
    return {
      totalSquadCostsPence,
      breakdownByPlayer: inputs.map((p) => ({
        ...p,
        ...map.get(p.playerId)!,
      })),
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
        case 'squadNumber': return ((a.squadNumber ?? Infinity) - (b.squadNumber ?? Infinity)) * dir
        case 'name':     return a.playerName.localeCompare(b.playerName) * dir
        case 'position': return (a.position ?? '').localeCompare(b.position ?? '') * dir
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

  // Baseline (no scenarios) — shows the live SCR derived from contracts alone.
  // Active baseline (with included scenarios) — shown in the TopBar pill.
  const baseline = useMemo(() => {
    if (!financials) return null
    return {
      squadCostsPence: totalSquadCostsPence,
      revenuePence: financials.footballRelatedRevenue + (financials.ownerEquityUsed1yr ?? 0),
    }
  }, [financials, totalSquadCostsPence])

  const ratio = baseline && baseline.revenuePence > 0
    ? baseline.squadCostsPence / baseline.revenuePence
    : 0
  const status = financials ? statusFromRatio(ratio, financials.currentAllowanceRatio) : 'green'
  const thresholds = baseline ? computeThresholds(baseline.revenuePence, financials!.currentAllowanceRatio) : null
  const headroomPence = thresholds ? thresholds.greenPence - totalSquadCostsPence : 0

  const activeBaseline = useMemo(
    () => financials ? computeActiveBaseline(financials, scenarios) : null,
    [financials, scenarios]
  )

  // Hold the skeleton until BOTH the roster and the included scenarios are in —
  // the hero SCR overlay, gauge and financial-risk card all fold in scenarios,
  // so revealing before they load would show numbers that then jump. (Only gate
  // on scenarios when financials exist, since that's the only case we fetch them.)
  if (loading || (financials != null && !scenariosLoaded)) return <DashboardSkeleton />

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
          <p className="text-[15px] font-medium text-slate-900">Set up your club to begin</p>
          <p className="text-[13px] text-slate-500 mt-2">
            Enter your season revenue and allowance to compute compliance thresholds.
          </p>
          <Link to="/financials" className="inline-block mt-5">
            <Button>Go to financials</Button>
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
          <p className="text-[15px] font-medium text-slate-900">No players in your squad yet</p>
          <p className="text-[13px] text-slate-500 mt-2 max-w-md mx-auto">
            Squad costs are derived from your active roster. Upload a CSV or add players manually to see your live SCR.
          </p>
          <Link to="/roster" className="inline-block mt-5">
            <Button>Go to roster</Button>
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

  const handleExport = () => {
    if (!financials || players.length === 0) return
    exportSquadPDF({
      clubName: clubName ?? 'Headroom FC',
      leagueId: leagueId ?? 'efl-championship',
      financials,
      players,
    })
  }

  return (
    <div>
      <PageHeader onExport={handleExport} canExport={players.length > 0} />

      {/* Hero — derived SCR position */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {/* Big SCR card */}
        <Card className="col-span-2 p-6">
          <div className="flex items-start justify-between mb-5">
            <div>
              <div className="meta-label">Live Squad Cost Ratio</div>
              <p className="text-[12px] text-slate-500 mt-1">
                Derived from {players.length} active {players.length === 1 ? 'contract' : 'contracts'}. Includes amortisation + annualised agent fees.
              </p>
            </div>
            <StatusBadge status={status}>
              {status === 'green' ? 'Compliant' : status === 'amber' ? 'Levy Zone' : 'Points Risk'}
            </StatusBadge>
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
            <span className="text-[14px] text-slate-400">of revenue</span>
          </div>
          {activeBaseline && activeBaseline.includedCount > 0 && (
            <div className={cn('mt-5 flex items-center justify-between gap-3 rounded-xl border px-4 py-3', activePillStyle)}>
              <div className="flex items-center gap-2.5 flex-wrap">
                <span className="meta-label text-slate-600">
                  With {activeBaseline.includedCount} included {activeBaseline.includedCount === 1 ? 'scenario' : 'scenarios'}
                </span>
                <StatusBadge status={activeBaseline.status}>
                  {activeBaseline.status === 'green' ? 'Compliant' : activeBaseline.status === 'amber' ? 'Levy Zone' : 'Points Risk'}
                </StatusBadge>
              </div>
              <div className="flex items-baseline gap-2">
                <AnimatedNumber
                  value={activeBaseline.ratio * 100}
                  decimals={1}
                  suffix="%"
                  className={cn('num text-[24px] font-semibold leading-none', activeNumStyle)}
                />
                <span className="text-[12px] text-slate-400">of revenue</span>
              </div>
            </div>
          )}
        </Card>

        {/* Threshold stat */}
        <Card className="p-6 flex flex-col">
          <div className="meta-label">Headroom to Green</div>
          <AnimatedNumber
            value={headroomPence}
            format={(n) => (n >= 0 ? formatPenceNumber(n) : `−${formatPenceNumber(Math.abs(n))}`)}
            className={cn(
              'num text-[28px] font-semibold leading-none mt-3',
              headroomPence >= 0 ? 'text-slate-900' : 'text-red-700'
            )}
          />
          <div className="text-[12px] text-slate-400 mt-2 num">
            Green threshold: {formatPence(thresholds!.greenPence)}
          </div>
          <div className="text-[12px] text-slate-400 num">
            Revenue: {formatPence(baseline!.revenuePence)}
          </div>
        </Card>
      </div>

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

      {/* Financial risk — projected sanctions at the active ratio (incl. scenarios) */}
      <FinancialRiskCard
        status={riskStatus}
        levyPence={levyPence}
        pointsDeduction={pointsDeduction}
        overspendGreenPence={overspendGreenPence}
        headroomPence={riskHeadroomPence}
        includedCount={includedCount}
      />

      {/* Breakdown table */}
      <Card className="overflow-hidden">
        <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <span className="inline-block w-1 h-5 rounded-full bg-violet-600" />
            <div>
              <h3 className="text-[15px] font-semibold text-slate-900 leading-tight">Per-Player SCR Contribution</h3>
              <p className="text-[12px] text-slate-500 mt-0.5">
                Annual cost = wage + amortisation + annualised agent fee
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
                {f === 'all' ? 'All' : f === 'expiring' ? 'Expiring ≤ 6 mo' : f}
              </button>
            ))}
          </div>
        </div>

        <table className="w-full">
          <thead className="border-b border-slate-100 bg-slate-50/40">
            <tr>
              <SortableTh field="squadNumber"  label="#"             align="right" sortKey={sortKey} sortDir={sortDir} onSort={(f, d) => { setSortKey(f); setSortDir(d) }} />
              <SortableTh field="name"         label="Name"          align="left"  sortKey={sortKey} sortDir={sortDir} onSort={(f, d) => { setSortKey(f); setSortDir(d) }} />
              <SortableTh field="position"     label="Position"      align="left"  sortKey={sortKey} sortDir={sortDir} onSort={(f, d) => { setSortKey(f); setSortDir(d) }} />
              <SortableTh field="wage"         label="Annual Wage"   align="right" sortKey={sortKey} sortDir={sortDir} onSort={(f, d) => { setSortKey(f); setSortDir(d) }} />
              <SortableTh field="amortisation" label="Annual Amortisation" align="right" sortKey={sortKey} sortDir={sortDir} onSort={(f, d) => { setSortKey(f); setSortDir(d) }} />
              <SortableTh field="agentFee"     label="Annualised Agent Fee" align="right" sortKey={sortKey} sortDir={sortDir} onSort={(f, d) => { setSortKey(f); setSortDir(d) }}
                titleHint="For SCR purposes, agent fees are spread evenly across the contract length, regardless of when the fee is paid."
              />
              <SortableTh field="total"        label="Total / yr"    align="right" sortKey={sortKey} sortDir={sortDir} onSort={(f, d) => { setSortKey(f); setSortDir(d) }} />
              <SortableTh field="expiry"       label="To Expiry"     align="right" sortKey={sortKey} sortDir={sortDir} onSort={(f, d) => { setSortKey(f); setSortDir(d) }} />
            </tr>
          </thead>
          <tbody>
            {filteredBreakdown.map((row) => (
              <tr key={row.playerId} className="border-b border-slate-100 last:border-0 hover:bg-violet-50/40 transition-colors">
                <td className="px-6 py-3.5 text-[13px] num text-right text-slate-500 tabular-nums w-12">{row.squadNumber ?? '—'}</td>
                <td className="px-6 py-3.5 text-[14px] text-slate-900 font-medium">
                  <span className="inline-flex items-center gap-2 align-middle">
                    <NationalityFlag nationality={row.nationality} />
                    <span>{row.playerName}</span>
                  </span>
                </td>
                <td className="px-6 py-3.5">
                  <PositionPill position={row.position} />
                </td>
                <td className="px-6 py-3.5 text-[13px] num text-right text-slate-700">{formatPence(row.wagePence)}</td>
                <td className="px-6 py-3.5 text-[13px] num text-right text-slate-700">{formatPence(row.amortisationPence)}</td>
                <td className="px-6 py-3.5 text-[13px] num text-right text-slate-700">{formatPence(row.annualisedAgentFeePence)}</td>
                <td className="px-6 py-3.5 text-[13px] num text-right text-slate-900 font-medium">{formatPence(row.totalAnnualCostPence)}</td>
                <td className="px-6 py-3.5 text-right">
                  <ExpiryChip months={row.monthsToExpiry} />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot className="bg-slate-50/60 border-t border-slate-200">
            <tr>
              <td className="px-6 py-3.5 text-[12px] meta-label" colSpan={6}>Total — {filteredBreakdown.length} {filteredBreakdown.length === 1 ? 'player' : 'players'}</td>
              <td className="px-6 py-3.5 text-[14px] num text-right text-slate-900 font-semibold">
                {formatPence(filteredBreakdown.reduce((s, r) => s + r.totalAnnualCostPence, 0))}
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
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
  return (
    <div className="mb-6 flex items-center gap-3">
      <span className="inline-block w-1.5 h-7 rounded-full bg-violet-600" />
      <div className="flex-1">
        <h1 className="text-[24px] font-bold text-slate-900 tracking-tight leading-none">
          Dashboard
        </h1>
        <p className="text-[13px] text-slate-500 mt-1.5">
          Your live compliance position — derived directly from active contracts.
        </p>
      </div>
      {onExport && (
        <Button variant="secondary" onClick={onExport} disabled={!canExport}>
          Export PDF
        </Button>
      )}
      <Link to="/scenarios">
        <Button variant="outline">Plan a scenario</Button>
      </Link>
    </div>
  )
}

// Projected regulatory sanctions for the current SCR position. Mirrors the
// Scenario builder's SanctionsPanel, plus a positive "compliant" state so the
// element is always present on the dashboard (it shows the financial risk —
// levy in the amber zone, points deduction in the red zone).
function FinancialRiskCard({
  status, levyPence, pointsDeduction, overspendGreenPence, headroomPence, includedCount,
}: {
  status: 'green' | 'amber' | 'red'
  levyPence: number
  pointsDeduction: number
  overspendGreenPence: number
  headroomPence: number
  includedCount: number
}) {
  return (
    <Card className="p-6 mb-6">
      <div className="flex items-center gap-3 mb-4">
        <span className="inline-block w-1 h-5 rounded-full bg-violet-600" />
        <div>
          <h3 className="text-[15px] font-semibold text-slate-900 leading-tight">Financial Risk</h3>
          <p className="text-[12px] text-slate-500 mt-0.5">
            {includedCount > 0
              ? `Projected EFL sanctions with your ${includedCount} included ${includedCount === 1 ? 'scenario' : 'scenarios'} applied.`
              : 'Projected EFL sanctions at your current squad cost ratio.'}
          </p>
        </div>
      </div>

      {status === 'green' && (
        <div className="rounded-xl border border-slate-200 border-l-4 border-green-500 bg-green-50 p-5 flex items-start justify-between gap-4">
          <div>
            <div className="meta-label text-green-700">No sanctions</div>
            <p className="text-[13px] text-slate-700 mt-2 max-w-xl">
              Squad costs are within the Green Threshold — no levy or points deduction projected.
            </p>
          </div>
          <div className="text-right flex-shrink-0">
            <div className="meta-label">Headroom to Green</div>
            <div className="num text-[24px] font-semibold text-green-700 leading-none mt-1.5">{formatPence(headroomPence)}</div>
          </div>
        </div>
      )}

      {status === 'amber' && (
        <div className="rounded-xl border border-slate-200 border-l-4 border-amber-500 bg-amber-50 p-5 flex items-start justify-between gap-4">
          <div>
            <div className="meta-label text-amber-700">Estimated Financial Levy</div>
            <p className="text-[13px] text-slate-700 mt-2 max-w-xl">
              Based on <span className="num text-amber-700">{formatPence(overspendGreenPence)}</span> overspend above the Green Threshold. A levy applies but no points are deducted.
            </p>
          </div>
          <div className="num text-[32px] font-semibold text-amber-700 leading-none flex-shrink-0">{formatPence(levyPence)}</div>
        </div>
      )}

      {status === 'red' && (
        <div className="rounded-xl border border-slate-200 border-l-4 border-red-600 bg-red-50 p-5 flex items-start justify-between gap-4">
          <div>
            <div className="meta-label text-red-700">Estimated Points Deduction</div>
            <p className="text-[13px] text-slate-700 mt-2 max-w-xl">
              Squad costs exceed the Red Threshold. Points deductions are imposed in the same season the breach occurs.
            </p>
            <p className="text-[12px] text-red-700 mt-3 font-medium">Seek independent legal advice before proceeding.</p>
          </div>
          <div className="num text-[32px] font-semibold text-red-700 leading-none whitespace-nowrap flex-shrink-0">
            {pointsDeduction} pts
          </div>
        </div>
      )}
    </Card>
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
  return <Flag code={country.code} title={country.name} width={20} />
}

function PositionPill({ position }: { position: string | null }) {
  if (!position) return <span className="text-[12px] text-slate-400">—</span>
  return (
    <span className="inline-block text-[11px] font-medium px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 whitespace-nowrap">
      {position}
    </span>
  )
}

// "49" → "4 years 1 month" — years lead, months only when non-zero, singular/plural correct.
function formatExpiryLabel(months: number): string {
  const years = Math.floor(months / 12)
  const rem = months % 12
  if (years === 0) return `${rem} ${rem === 1 ? 'month' : 'months'}`
  const yearPart = `${years} ${years === 1 ? 'year' : 'years'}`
  if (rem === 0) return yearPart
  return `${yearPart} ${rem} ${rem === 1 ? 'month' : 'months'}`
}

function ExpiryChip({ months }: { months: number | null }) {
  if (months == null) return <span className="text-slate-400 text-[12px]">—</span>
  if (months < 0) return <span className="text-red-700 num text-[12px]">expired</span>
  if (months <= 6) {
    return (
      <span className="inline-block text-[11px] font-medium px-2 py-0.5 rounded-md bg-amber-100 text-amber-700 whitespace-nowrap">
        {formatExpiryLabel(months)}
      </span>
    )
  }
  return <span className="text-slate-500 text-[12px] whitespace-nowrap">{formatExpiryLabel(months)}</span>
}
