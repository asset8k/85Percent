/**
 * SSRPage — Premier League Sustainability & Systemic Resilience tests.
 *
 * Three tabs, one per test. All three rely on the engine for pass/fail; the
 * page just renders inputs + the server-evaluated result.
 *
 * Visibility: this page is only reachable for clubs on the premier-league
 * config. The API also returns 404 for Championship requests (defence in
 * depth), so a stale bookmark cannot leak SSR data.
 */

import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '@/lib/api'
import { useClubStore } from '@/stores/club'
import { useSeasonStore, seasonKey } from '@/stores/season'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { FormPageSkeleton } from '@/components/ui/page-skeletons'
import { NumericInput } from '@/components/ui/numeric-input'
import { formatPence } from '@headroom/shared'
import { cn } from '@/lib/utils'
import type {
  WorkingCapitalResponse,
  LiquidityResponse,
  EquityResponse,
} from '@/lib/api'

type Tab = 'working-capital' | 'liquidity' | 'equity'

const TABS: Array<{ id: Tab; label: string; testNo: number }> = [
  { id: 'working-capital', label: 'Working Capital', testNo: 1 },
  { id: 'liquidity', label: 'Liquidity', testNo: 2 },
  { id: 'equity', label: 'Positive Equity', testNo: 3 },
]

export function SSRPage() {
  const { leagueId } = useClubStore()
  const [tab, setTab] = useState<Tab>('working-capital')

  // Gate the page client-side too — even though the API enforces it
  if (leagueId && leagueId !== 'premier-league') {
    return (
      <div>
        <PageHeader />
        <Card className="p-12 text-center">
          <p className="text-[15px] font-medium text-slate-900">Premier League only</p>
          <p className="text-[13px] text-slate-500 mt-2 max-w-md mx-auto">
            The three SSR solvency tests apply to Premier League clubs only. Switch your club to the Premier League configuration from the Financials page to access them.
          </p>
          <Link to="/financials" className="inline-block mt-5">
            <Button>Go to financials</Button>
          </Link>
        </Card>
      </div>
    )
  }

  return (
    <div>
      <PageHeader />

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-slate-200 mb-6">
        {TABS.map((t) => (
          <TabButton key={t.id} active={tab === t.id} onClick={() => setTab(t.id)} testNo={t.testNo}>
            {t.label}
          </TabButton>
        ))}
      </div>

      {tab === 'working-capital' && <WorkingCapitalTab />}
      {tab === 'liquidity'       && <LiquidityTab />}
      {tab === 'equity'          && <EquityTab />}
    </div>
  )
}

function PageHeader() {
  return (
    <div className="mb-6 flex items-center gap-3">
      <span className="inline-block w-1.5 h-7 rounded-full bg-violet-600" />
      <div>
        <h1 className="text-[24px] font-bold text-slate-900 tracking-tight leading-none">SSR Tests</h1>
        <p className="text-[13px] text-slate-500 mt-1.5">
          Premier League solvency tests — assessed on 7 July annually.
        </p>
      </div>
    </div>
  )
}

function TabButton({
  active,
  onClick,
  testNo,
  children,
}: {
  active: boolean
  onClick: () => void
  testNo: number
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'relative flex items-center gap-2 px-3.5 pb-3 pt-1 text-[14px] font-medium transition-colors',
        active ? 'text-violet-700' : 'text-slate-500 hover:text-slate-900',
      )}
    >
      <span
        className={cn(
          'inline-flex items-center justify-center w-5 h-5 rounded-md text-[11px] font-semibold transition-colors',
          active ? 'bg-violet-100 text-violet-700' : 'bg-slate-100 text-slate-400',
        )}
      >
        {testNo}
      </span>
      {children}
      {active && <span className="absolute left-0 right-0 bottom-[-1px] h-0.5 bg-violet-600 rounded-full" />}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Working Capital — 12-month grid
// ---------------------------------------------------------------------------

// The 12 fiscal months of a season (Jul of the start year → Jun of the next),
// derived from the active season so the grid follows the TopBar selector.
const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function monthsOfSeason(startYear: number): Array<{ key: string; label: string; short: string }> {
  const out: Array<{ key: string; label: string; short: string }> = []
  for (let i = 6; i < 18; i++) {
    const year = startYear + Math.floor(i / 12)
    const month = i % 12 // 0-indexed
    out.push({
      key: `${year}-${String(month + 1).padStart(2, '0')}`,
      label: `${MONTH_ABBR[month]} ${year}`,
      short: MONTH_ABBR[month] ?? '',
    })
  }
  return out
}

function WorkingCapitalTab() {
  const seasonStartYear = useSeasonStore((s) => s.startYear)
  const SEASON = seasonKey(seasonStartYear)
  const MONTHS_OF_SEASON = useMemo(() => monthsOfSeason(seasonStartYear), [seasonStartYear])
  const [data, setData] = useState<WorkingCapitalResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Local edit buffer: yearMonth -> { cashflowPounds, fundsPounds, dirty, saving }
  const [edits, setEdits] = useState<Record<string, {
    cashflowPounds: number
    fundsPounds: number
    dirty: boolean
    saving: boolean
  }>>({})

  const refresh = async () => {
    setLoading(true)
    setError('')
    try {
      const result = await api.ssr.getWorkingCapital(SEASON)
      setData(result)
      // Hydrate edit buffer from server state
      const next: typeof edits = {}
      for (const r of result.rows) {
        next[r.yearMonth] = {
          cashflowPounds: Math.round(r.adjustedCashflowPence / 100),
          fundsPounds:    Math.round(r.qualifyingFundsPence / 100),
          dirty: false,
          saving: false,
        }
      }
      setEdits(next)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load working capital')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { refresh() }, [seasonStartYear]) // eslint-disable-line react-hooks/exhaustive-deps

  const setField = (ym: string, key: 'cashflowPounds' | 'fundsPounds', value: number) => {
    setEdits((prev) => {
      const current = prev[ym] ?? { cashflowPounds: NaN, fundsPounds: NaN, dirty: false, saving: false }
      return { ...prev, [ym]: { ...current, [key]: value, dirty: true } }
    })
  }

  const saveRow = async (ym: string) => {
    const row = edits[ym]
    if (!row) return
    if (!Number.isFinite(row.cashflowPounds) || !Number.isFinite(row.fundsPounds)) return
    setEdits((p) => ({ ...p, [ym]: { ...row, saving: true } }))
    try {
      await api.ssr.putWorkingCapital({
        season: SEASON,
        yearMonth: ym,
        adjustedCashflowPence: Math.round(row.cashflowPounds * 100),
        qualifyingFundsPence:  Math.round(row.fundsPounds * 100),
      })
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save month')
      setEdits((p) => ({ ...p, [ym]: { ...row, saving: false } }))
    }
  }

  if (loading) return <FormPageSkeleton />

  const evaluation = data?.evaluation ?? null
  const rowsByMonth = new Map<string, number>()
  for (const m of evaluation?.months ?? []) {
    if (m.yearMonth) rowsByMonth.set(m.yearMonth, m.monthlyHeadroomPence)
  }

  const monthsWithData = MONTHS_OF_SEASON.filter((m) => rowsByMonth.has(m.key)).length
  const failingCount = evaluation?.failingMonthCount ?? 0
  const passingCount = Math.max(0, monthsWithData - failingCount)
  const hasData = monthsWithData > 0
  const status: TestStatus = !hasData ? 'nodata' : evaluation?.passing ? 'pass' : 'fail'

  return (
    <div className="space-y-5">
      {error && <ErrorCard message={error} />}

      <TestResultBanner
        status={status}
        statusText={status === 'fail' ? `${failingCount} month${failingCount === 1 ? '' : 's'} fail` : undefined}
        title="Working Capital"
        description={
          <>Each fiscal month must clear <Num>£12,500,000</Num> of adjusted cashflow + qualifying funds.</>
        }
        metricLabel="Worst monthly headroom"
        metric={
          evaluation && hasData ? (
            <SignedPence pence={evaluation.worstHeadroomPence} />
          ) : (
            <span className="text-slate-300">—</span>
          )
        }
      />

      {/* Visual 12-month pass/fail strip */}
      <Card className="p-6">
        <SectionHeader
          title="Season at a glance"
          sub="Each block is one fiscal month — green clears the floor, red falls short."
        />
        <div className="mt-5 grid grid-cols-12 gap-1.5">
          {MONTHS_OF_SEASON.map((m) => {
            const hr = rowsByMonth.get(m.key)
            const state = hr === undefined ? 'empty' : hr < 0 ? 'fail' : 'pass'
            return (
              <div key={m.key} className="flex flex-col items-center gap-1.5" title={
                hr === undefined ? `${m.label}: no data` : `${m.label}: ${(hr < 0 ? '−' : '') + formatPence(Math.abs(hr))} headroom`
              }>
                <div
                  className={cn(
                    'w-full h-9 rounded-md border transition-colors',
                    state === 'pass'  && 'bg-green-100 border-green-200',
                    state === 'fail'  && 'bg-red-100 border-red-200',
                    state === 'empty' && 'bg-slate-50 border-slate-200 border-dashed',
                  )}
                />
                <span className="text-[10px] text-slate-400 font-medium">{m.short}</span>
              </div>
            )
          })}
        </div>
        {hasData && (
          <div className="mt-5 pt-4 border-t border-slate-100 flex items-center gap-6 text-[12px]">
            <LegendDot className="bg-green-400" label={`${passingCount} passing`} />
            <LegendDot className="bg-red-400" label={`${failingCount} failing`} />
            <LegendDot className="bg-slate-200" label={`${MONTHS_OF_SEASON.length - monthsWithData} no data`} />
          </div>
        )}
      </Card>

      {/* 12-month editable grid */}
      <Card className="overflow-hidden">
        <div className="px-6 pt-5 pb-4 border-b border-slate-100">
          <SectionHeader title="Monthly inputs" sub="Enter adjusted cashflow and qualifying funds for each month." />
        </div>
        <table className="w-full">
          <thead className="border-b border-slate-100 bg-slate-50/60">
            <tr>
              <Th>Month</Th>
              <Th align="right">Adjusted Cashflow (£)</Th>
              <Th align="right">Qualifying Funds (£)</Th>
              <Th align="right">Headroom</Th>
              <Th align="right">{''}</Th>
            </tr>
          </thead>
          <tbody>
            {MONTHS_OF_SEASON.map((m) => {
              const edit = edits[m.key]
              const headroom = rowsByMonth.get(m.key)
              const cashflow = edit?.cashflowPounds ?? NaN
              const funds    = edit?.fundsPounds ?? NaN
              const failing  = headroom !== undefined && headroom < 0
              return (
                <tr key={m.key} className={cn('border-b border-slate-100 last:border-0 transition-colors', failing && 'bg-red-50/40')}>
                  <td className="px-6 py-3 text-[13px] text-slate-700 num">
                    <span className="inline-flex items-center gap-2">
                      <span className={cn(
                        'inline-block w-1.5 h-1.5 rounded-full',
                        headroom === undefined ? 'bg-slate-200' : failing ? 'bg-red-500' : 'bg-green-500',
                      )} />
                      {m.label}
                    </span>
                  </td>
                  <td className="px-2 py-2">
                    <PoundCell value={cashflow} onChange={(n) => setField(m.key, 'cashflowPounds', n)} />
                  </td>
                  <td className="px-2 py-2">
                    <PoundCell value={funds} onChange={(n) => setField(m.key, 'fundsPounds', n)} />
                  </td>
                  <td className={cn(
                    'px-6 py-3 text-[13px] num text-right',
                    headroom === undefined ? 'text-slate-300' : failing ? 'text-red-700 font-medium' : 'text-green-700'
                  )}>
                    {headroom === undefined ? '—' : (headroom < 0 ? '−' : '') + formatPence(Math.abs(headroom))}
                  </td>
                  <td className="px-6 py-3 text-right w-px">
                    {edit?.dirty && (
                      <button
                        onClick={() => saveRow(m.key)}
                        disabled={edit.saving || !Number.isFinite(cashflow) || !Number.isFinite(funds)}
                        className="text-[12px] font-medium text-violet-600 hover:text-violet-700 disabled:opacity-60 inline-flex items-center gap-1"
                      >
                        {edit.saving && <Spinner size={11} />}
                        {edit.saving ? 'Saving' : 'Save'}
                      </button>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </Card>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Liquidity tab
// ---------------------------------------------------------------------------

const LIQUIDITY_THRESHOLD_PENCE = 85_000_000_00

function LiquidityTab() {
  const seasonStartYear = useSeasonStore((s) => s.startYear)
  const SEASON = seasonKey(seasonStartYear)
  const [data, setData] = useState<LiquidityResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [assets, setAssets] = useState(NaN)
  const [liabilities, setLiabilities] = useState(NaN)
  const [marketValue, setMarketValue] = useState(NaN)
  const [saving, setSaving] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const result = await api.ssr.getLiquidity(SEASON)
      setData(result)
      if (result.row) {
        setAssets(Math.round(result.row.liquidAssetsPence / 100))
        setLiabilities(Math.round(result.row.liquidLiabilitiesPence / 100))
        setMarketValue(Math.round(result.row.squadMarketValuePence / 100))
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load liquidity')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [seasonStartYear]) // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    if (![assets, liabilities, marketValue].every(Number.isFinite)) return
    setSaving(true)
    setError('')
    try {
      await api.ssr.putLiquidity({
        season: SEASON,
        liquidAssetsPence:      Math.round(assets * 100),
        liquidLiabilitiesPence: Math.round(liabilities * 100),
        squadMarketValuePence:  Math.round(marketValue * 100),
      })
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  // Local preview (matches engine math): assets + 40% × marketValue − liabilities − £85M
  const preview = useMemo(() => {
    if (![assets, liabilities, marketValue].every(Number.isFinite)) return null
    const assetsP = Math.round(assets * 100)
    const liabP   = Math.round(liabilities * 100)
    const mvP     = Math.round(marketValue * 100)
    const effective = assetsP + Math.floor(mvP * 0.4)
    const net = effective - liabP
    const headroom = net - LIQUIDITY_THRESHOLD_PENCE
    return { effective, net, headroom, passing: headroom >= 0 }
  }, [assets, liabilities, marketValue])

  if (loading) return <FormPageSkeleton />

  const evalServer = data?.evaluation ?? null
  const passing = evalServer?.passing ?? preview?.passing ?? null
  const status: TestStatus = passing === null ? 'nodata' : passing ? 'pass' : 'fail'

  return (
    <div className="space-y-5">
      {error && <ErrorCard message={error} />}

      <TestResultBanner
        status={status}
        title="Liquidity"
        description={
          <>Liquid assets + 40% of squad market value − liquid liabilities must clear the <Num>£85,000,000</Num> stress test.</>
        }
        metricLabel="Liquidity headroom"
        metric={preview ? <SignedPence pence={preview.headroom} /> : <span className="text-slate-300">—</span>}
      />

      <Card className="p-6">
        <SectionHeader title="Inputs" sub="40% of squad market value is treated as a liquid asset." />
        <div className="mt-5 grid grid-cols-3 gap-5">
          <Field label="Liquid Assets (£)" helper="Cash, undrawn facilities, near-cash">
            <PoundInput value={assets} onChange={setAssets} />
          </Field>
          <Field label="Liquid Liabilities (£)" helper="Short-term obligations">
            <PoundInput value={liabilities} onChange={setLiabilities} />
          </Field>
          <Field label="Squad Market Value (£)" helper="40% counts toward liquid assets">
            <PoundInput value={marketValue} onChange={setMarketValue} />
          </Field>
        </div>

        {preview && (
          <>
            <div className="mt-6 pt-5 border-t border-slate-100">
              <div className="flex items-center justify-between mb-3">
                <span className="meta-label">Net liquid position vs stress floor</span>
                <span className={cn('num text-[12px] font-medium', preview.headroom < 0 ? 'text-red-600' : 'text-green-700')}>
                  {preview.headroom < 0 ? 'Below floor' : 'Above floor'}
                </span>
              </div>
              <ZoneBar
                value={preview.net}
                threshold={LIQUIDITY_THRESHOLD_PENCE}
                goodSide="above"
                thresholdLabel="£85M floor"
                formatTick={fmtCompactPence}
                valueLabel={fmtCompactPence(preview.net)}
              />
            </div>

            <div className="mt-6 pt-5 border-t border-slate-100 grid grid-cols-3 gap-5">
              <StatBlock
                label="Effective Liquid Assets"
                value={formatPence(preview.effective)}
                sub="Includes 40% squad market value"
              />
              <StatBlock
                label="Stress Test Threshold"
                value="£85,000,000"
                sub="PL solvency buffer"
              />
              <StatBlock
                label="Liquidity Headroom"
                value={`${preview.headroom < 0 ? '−' : ''}${formatPence(Math.abs(preview.headroom))}`}
                valueClass={preview.headroom < 0 ? 'text-red-700' : 'text-green-700'}
                sub={preview.headroom < 0 ? 'Short of the required floor' : 'Above the required floor'}
              />
            </div>
          </>
        )}

        <div className="mt-6 pt-5 border-t border-slate-100 flex items-center justify-end">
          <Button onClick={save} disabled={saving || ![assets, liabilities, marketValue].every(Number.isFinite)}>
            {saving && <Spinner size={14} />}
            {saving ? 'Saving…' : 'Save liquidity'}
          </Button>
        </div>
      </Card>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Equity tab
// ---------------------------------------------------------------------------

function EquityTab() {
  const seasonStartYear = useSeasonStore((s) => s.startYear)
  const SEASON = seasonKey(seasonStartYear)
  const [data, setData] = useState<EquityResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [liabilities, setLiabilities] = useState(NaN)
  const [adjustedAssets, setAdjustedAssets] = useState(NaN)
  const [saving, setSaving] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const result = await api.ssr.getEquity(SEASON)
      setData(result)
      if (result.row) {
        setLiabilities(Math.round(result.row.totalLiabilitiesPence / 100))
        setAdjustedAssets(Math.round(result.row.adjustedAssetsPence / 100))
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load equity')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [seasonStartYear]) // eslint-disable-line react-hooks/exhaustive-deps

  const save = async () => {
    if (!Number.isFinite(liabilities) || !Number.isFinite(adjustedAssets)) return
    setSaving(true)
    setError('')
    try {
      await api.ssr.putEquity({
        season: SEASON,
        totalLiabilitiesPence: Math.round(liabilities * 100),
        adjustedAssetsPence:   Math.round(adjustedAssets * 100),
      })
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  // Threshold tiers: 2026-27 ≤ 90%, 2027-28 ≤ 85%, 2028+ ≤ 80%
  const threshold = SEASON === '2026-27' ? 0.90 : SEASON === '2027-28' ? 0.85 : 0.80
  const preview = useMemo(() => {
    if (!Number.isFinite(liabilities) || !Number.isFinite(adjustedAssets) || adjustedAssets <= 0) return null
    const ratio = liabilities / adjustedAssets
    return { ratio, passing: ratio <= threshold, marginPp: (threshold - ratio) * 100 }
  }, [liabilities, adjustedAssets, threshold])

  if (loading) return <FormPageSkeleton />

  const evalServer = data?.evaluation ?? null
  const passing = evalServer?.passing ?? preview?.passing ?? null
  const status: TestStatus = passing === null ? 'nodata' : passing ? 'pass' : 'fail'

  return (
    <div className="space-y-5">
      {error && <ErrorCard message={error} />}

      <TestResultBanner
        status={status}
        title="Positive Equity"
        description={
          <>Total liabilities ÷ adjusted assets must stay at or below <Num>{(threshold * 100).toFixed(0)}%</Num> for {SEASON}.</>
        }
        metricLabel="Equity ratio"
        metric={
          preview ? (
            <span className={cn('num', preview.passing ? 'text-slate-900' : 'text-red-700')}>
              {(preview.ratio * 100).toFixed(1)}%
            </span>
          ) : (
            <span className="text-slate-300">—</span>
          )
        }
      />

      <Card className="p-6">
        <SectionHeader title="Inputs" sub="The ratio of what you owe against what you own." />
        <div className="mt-5 grid grid-cols-2 gap-5">
          <Field label="Total Liabilities (£)" helper="All balance-sheet liabilities incl. shareholder loans">
            <PoundInput value={liabilities} onChange={setLiabilities} />
          </Field>
          <Field label="Adjusted Assets (£)" helper="Net book value of players + assets (whichever is higher)">
            <PoundInput value={adjustedAssets} onChange={setAdjustedAssets} />
          </Field>
        </div>

        {preview && (
          <>
            <div className="mt-6 pt-5 border-t border-slate-100">
              <div className="flex items-center justify-between mb-3">
                <span className="meta-label">Equity ratio vs {SEASON} cap</span>
                <span className={cn('num text-[12px] font-medium', preview.passing ? 'text-green-700' : 'text-red-600')}>
                  {preview.passing ? 'Within cap' : 'Over cap'}
                </span>
              </div>
              <ZoneBar
                value={preview.ratio}
                threshold={threshold}
                goodSide="below"
                domainMax={Math.max(1, preview.ratio * 1.1)}
                thresholdLabel={`${(threshold * 100).toFixed(0)}% cap`}
                formatTick={fmtPctTick}
                valueLabel={`${(preview.ratio * 100).toFixed(1)}%`}
              />
            </div>

            <div className="mt-6 pt-5 border-t border-slate-100 grid grid-cols-3 gap-5">
              <StatBlock
                label="Equity Ratio"
                value={(preview.ratio * 100).toFixed(1) + '%'}
                valueClass={preview.passing ? 'text-slate-900' : 'text-red-700'}
                sub={`Threshold for ${SEASON}: ${(threshold * 100).toFixed(0)}%`}
              />
              <StatBlock
                label="Margin to cap"
                value={`${preview.marginPp >= 0 ? '+' : ''}${preview.marginPp.toFixed(2)} pp`}
                valueClass={preview.marginPp >= 0 ? 'text-green-700' : 'text-red-700'}
                sub="Distance below the season threshold"
              />
              <StatBlock
                label="Threshold Tier"
                value={SEASON === '2026-27' ? '90% cap' : SEASON === '2027-28' ? '85% cap' : '80% cap'}
                sub="Tightens each season through 2028-29"
              />
            </div>
          </>
        )}

        <div className="mt-6 pt-5 border-t border-slate-100 flex items-center justify-end">
          <Button onClick={save} disabled={saving || !Number.isFinite(liabilities) || !Number.isFinite(adjustedAssets)}>
            {saving && <Spinner size={14} />}
            {saving ? 'Saving…' : 'Save equity'}
          </Button>
        </div>
      </Card>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Shared result primitives
// ---------------------------------------------------------------------------

type TestStatus = 'pass' | 'fail' | 'nodata'

const STATUS_STYLE: Record<TestStatus, { bd: string; bg: string; dot: string; text: string; label: string }> = {
  pass:   { bd: 'border-l-green-600', bg: 'bg-green-50/50', dot: '#16a34a', text: 'text-green-700', label: 'PASS' },
  fail:   { bd: 'border-l-red-600',   bg: 'bg-red-50/50',   dot: '#dc2626', text: 'text-red-700',   label: 'FAIL' },
  nodata: { bd: 'border-l-slate-300', bg: 'bg-white',       dot: '#cbd5e1', text: 'text-slate-400', label: 'NO DATA' },
}

/**
 * The headline pass/fail card shared by all three tests. Mirrors the
 * SCRResultPanel StatusBanner: a coloured left rail + tint, a status dot and
 * label on the left, and the test's single most important figure on the right.
 */
function TestResultBanner({
  status,
  statusText,
  title,
  description,
  metricLabel,
  metric,
}: {
  status: TestStatus
  statusText?: string
  title: string
  description: React.ReactNode
  metricLabel: string
  metric: React.ReactNode
}) {
  const c = STATUS_STYLE[status]
  return (
    <Card className={cn('p-6 border-l-4 flex items-center justify-between gap-6', c.bd, c.bg)}>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: c.dot }} />
          <span className={cn('meta-label', c.text)} style={{ letterSpacing: '0.1em' }}>
            {statusText ?? c.label}
          </span>
        </div>
        <h3 className="text-[16px] font-semibold text-slate-900 mt-2 tracking-tight">{title}</h3>
        <p className="text-[13px] text-slate-600 mt-1 max-w-xl leading-relaxed">{description}</p>
      </div>
      <div className="text-right flex-shrink-0">
        <div className="meta-label">{metricLabel}</div>
        <div className={cn('num text-[30px] font-semibold leading-none mt-1.5', c.text)}>{metric}</div>
      </div>
    </Card>
  )
}

/**
 * Horizontal pass/fail bar. A red and a green zone split at the threshold; a
 * marker shows where the club currently sits. `goodSide` says which side of the
 * threshold is compliant.
 */
function ZoneBar({
  value,
  threshold,
  goodSide,
  thresholdLabel,
  formatTick,
  valueLabel,
  domainMax,
}: {
  value: number
  threshold: number
  goodSide: 'above' | 'below'
  thresholdLabel: string
  formatTick: (n: number) => string
  valueLabel: string
  /** Optional explicit upper bound for the axis (defaults to a padded fit). */
  domainMax?: number
}) {
  const lo = Math.min(0, value, threshold)
  const hi = domainMax ?? Math.max(value, threshold)
  const pad = (hi - lo) * 0.12 || threshold * 0.2
  const min = lo - (lo < 0 ? pad : 0)
  const max = hi + pad
  const pos = (n: number) => Math.max(0, Math.min(100, ((n - min) / (max - min)) * 100))
  const tPos = pos(threshold)
  const vPos = pos(value)
  const belowGood = goodSide === 'below'

  return (
    <div>
      <div className="gauge-track bg-slate-100">
        <div
          className="zone"
          style={{ left: 0, width: `${tPos}%`, background: belowGood ? '#bbf7d0' : '#fecaca' }}
        />
        <div
          className="zone"
          style={{ left: `${tPos}%`, right: 0, background: belowGood ? '#fecaca' : '#bbf7d0' }}
        />
        {/* threshold divider */}
        <div className="absolute -top-1 -bottom-1 w-[2px] bg-slate-900/80 rounded-full" style={{ left: `${tPos}%` }} />
        {/* current-value marker */}
        <div className="absolute top-1/2" style={{ left: `${vPos}%` }}>
          <span className="block -translate-x-1/2 -translate-y-1/2 w-3.5 h-3.5 rounded-full bg-white border-[3px] border-slate-900 shadow-sm" />
        </div>
      </div>
      {/* axis labels */}
      <div className="relative mt-2.5 h-4 text-[11px]">
        <span className="absolute left-0 text-slate-400">{formatTick(min)}</span>
        <span
          className="absolute -translate-x-1/2 text-slate-600 font-medium whitespace-nowrap"
          style={{ left: `${tPos}%` }}
        >
          {thresholdLabel}
        </span>
        <span className="absolute right-0 text-slate-400">{formatTick(max)}</span>
      </div>
      <div className="mt-1.5 text-[11px] text-slate-400">
        You are at <span className="num text-slate-600 font-medium">{valueLabel}</span>
      </div>
    </div>
  )
}

function SectionHeader({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="flex items-center gap-3">
      <span className="inline-block w-1 h-5 rounded-full bg-violet-600" />
      <div>
        <h3 className="text-[15px] font-semibold text-slate-900 leading-tight">{title}</h3>
        {sub && <p className="text-[12px] text-slate-500 mt-0.5">{sub}</p>}
      </div>
    </div>
  )
}

function LegendDot({ className, label }: { className: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-slate-500">
      <span className={cn('inline-block w-2.5 h-2.5 rounded-sm', className)} />
      {label}
    </span>
  )
}

function ErrorCard({ message }: { message: string }) {
  return (
    <Card className="p-4 border-red-200 bg-red-50">
      <p className="text-[13px] text-red-700">{message}</p>
    </Card>
  )
}

function SignedPence({ pence }: { pence: number }) {
  return <>{(pence < 0 ? '−' : '') + formatPence(Math.abs(pence))}</>
}

function Num({ children }: { children: React.ReactNode }) {
  return <span className="num text-slate-900">{children}</span>
}

// Compact pence → "£85M" / "£250k" for axis ticks.
function fmtCompactPence(pence: number): string {
  const sign = pence < 0 ? '−' : ''
  const abs = Math.abs(pence) / 100
  if (abs >= 1_000_000) return `${sign}£${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1).replace(/\.0$/, '')}M`
  if (abs >= 1_000) return `${sign}£${Math.round(abs / 1_000)}k`
  return `${sign}£${Math.round(abs)}`
}

function fmtPctTick(ratio: number): string {
  return `${Math.round(ratio * 100)}%`
}

// ---------------------------------------------------------------------------
// Local primitives
// ---------------------------------------------------------------------------

function Th({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return <th className={cn('meta-label px-6 py-3', align === 'right' ? 'text-right' : 'text-left')}>{children}</th>
}

function StatBlock({ label, value, sub, valueClass = '' }: { label: string; value: string; sub?: string; valueClass?: string }) {
  return (
    <div className="flex flex-col">
      <span className="meta-label mb-1.5">{label}</span>
      <span className={cn('num text-[20px] text-slate-900 font-medium leading-none', valueClass)}>{value}</span>
      {sub && <span className="text-[12px] text-slate-400 mt-1.5">{sub}</span>}
    </div>
  )
}

const inputBase =
  'w-full px-3 py-2 text-[14px] rounded-lg border border-slate-200 bg-white focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500 transition-colors'

function Field({ label, helper, children }: { label: string; helper?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="meta-label block mb-1.5">{label}</span>
      {children}
      {helper && <span className="block text-[11px] text-slate-400 mt-1">{helper}</span>}
    </label>
  )
}

function PoundInput({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-[14px]">£</span>
      <NumericInput value={value} onChange={onChange} className={inputBase + ' pl-7 num'} placeholder="0" />
    </div>
  )
}

function PoundCell({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <div className="relative">
      <span className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 text-[12px]">£</span>
      <NumericInput
        value={value}
        onChange={onChange}
        className="w-full pl-6 pr-2 py-1.5 text-[13px] rounded border border-slate-300 text-right num focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500"
      />
    </div>
  )
}
