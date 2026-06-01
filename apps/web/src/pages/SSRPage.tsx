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
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/components/ui/badge'
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
      <div className="flex items-center gap-6 border-b border-slate-200 mb-5">
        <TabButton active={tab === 'working-capital'} onClick={() => setTab('working-capital')}>
          Working Capital
        </TabButton>
        <TabButton active={tab === 'liquidity'} onClick={() => setTab('liquidity')}>
          Liquidity
        </TabButton>
        <TabButton active={tab === 'equity'} onClick={() => setTab('equity')}>
          Positive Equity
        </TabButton>
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

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'relative pb-3 text-[14px] font-medium transition-colors',
        active ? 'text-violet-700' : 'text-slate-500 hover:text-slate-900',
      )}
    >
      {children}
      {active && <span className="absolute left-0 right-0 bottom-[-1px] h-0.5 bg-violet-600 rounded-full" />}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Working Capital — 12-month grid
// ---------------------------------------------------------------------------

const MONTHS_OF_SEASON: Array<{ key: string; label: string }> = [
  { key: '2026-07', label: 'Jul 2026' }, { key: '2026-08', label: 'Aug 2026' },
  { key: '2026-09', label: 'Sep 2026' }, { key: '2026-10', label: 'Oct 2026' },
  { key: '2026-11', label: 'Nov 2026' }, { key: '2026-12', label: 'Dec 2026' },
  { key: '2027-01', label: 'Jan 2027' }, { key: '2027-02', label: 'Feb 2027' },
  { key: '2027-03', label: 'Mar 2027' }, { key: '2027-04', label: 'Apr 2027' },
  { key: '2027-05', label: 'May 2027' }, { key: '2027-06', label: 'Jun 2027' },
]
const SEASON = '2026-27'

function WorkingCapitalTab() {
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

  useEffect(() => { refresh() }, [])

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
  const rowsByMonth = new Map<string, ReturnType<typeof Number>>()
  for (const m of evaluation?.months ?? []) {
    if (m.yearMonth) rowsByMonth.set(m.yearMonth, m.monthlyHeadroomPence)
  }

  return (
    <div className="space-y-5">
      {error && (
        <Card className="p-4 border-red-200 bg-red-50">
          <p className="text-[13px] text-red-700">{error}</p>
        </Card>
      )}

      {/* Headline */}
      <Card className={cn('p-6 border-l-4', evaluation?.passing ? 'border-l-green-600' : 'border-l-red-600')}>
        <div className="flex items-start justify-between">
          <div>
            <div className="meta-label">Working Capital Test (Test 1)</div>
            <p className="text-[13px] text-slate-600 mt-1.5 max-w-xl">
              Each month must clear <span className="num text-slate-900">£12,500,000</span> of adjusted cashflow + qualifying funds.
            </p>
          </div>
          <div className="text-right">
            <StatusBadge status={evaluation?.passing ? 'green' : 'red'}>
              {evaluation?.passing ? 'PASS' : evaluation && evaluation.failingMonthCount > 0 ? `${evaluation.failingMonthCount} FAIL` : 'NO DATA'}
            </StatusBadge>
            {evaluation && evaluation.months.length > 0 && (
              <div className="text-[11px] text-slate-500 mt-2 num">
                Worst headroom: <span className={evaluation.worstHeadroomPence < 0 ? 'text-red-700' : 'text-slate-700'}>
                  {evaluation.worstHeadroomPence < 0 ? '−' : ''}{formatPence(Math.abs(evaluation.worstHeadroomPence))}
                </span>
              </div>
            )}
          </div>
        </div>
      </Card>

      {/* 12-month grid */}
      <Card className="overflow-hidden">
        <table className="w-full">
          <thead className="border-b border-slate-100 bg-slate-50/40">
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
              return (
                <tr key={m.key} className="border-b border-slate-100 last:border-0">
                  <td className="px-5 py-3 text-[13px] text-slate-700 num">{m.label}</td>
                  <td className="px-2 py-2">
                    <PoundCell value={cashflow} onChange={(n) => setField(m.key, 'cashflowPounds', n)} />
                  </td>
                  <td className="px-2 py-2">
                    <PoundCell value={funds} onChange={(n) => setField(m.key, 'fundsPounds', n)} />
                  </td>
                  <td className={cn(
                    'px-5 py-3 text-[13px] num text-right',
                    headroom === undefined ? 'text-slate-300' : headroom < 0 ? 'text-red-700 font-medium' : 'text-green-700'
                  )}>
                    {headroom === undefined ? '—' : (headroom < 0 ? '−' : '') + formatPence(Math.abs(headroom))}
                  </td>
                  <td className="px-5 py-3 text-right">
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

function LiquidityTab() {
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

  useEffect(() => { load() }, [])

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
    const headroom = effective - liabP - 85_000_000_00
    return { effective, headroom, passing: headroom >= 0 }
  }, [assets, liabilities, marketValue])

  if (loading) return <FormPageSkeleton />

  const evalServer = data?.evaluation ?? null
  const passing = evalServer?.passing ?? preview?.passing ?? null

  return (
    <div className="space-y-5">
      {error && (
        <Card className="p-4 border-red-200 bg-red-50">
          <p className="text-[13px] text-red-700">{error}</p>
        </Card>
      )}

      <Card className={cn(
        'p-6 border-l-4',
        passing === null ? 'border-l-slate-300' : passing ? 'border-l-green-600' : 'border-l-red-600'
      )}>
        <div className="flex items-start justify-between">
          <div>
            <div className="meta-label">Liquidity Test (Test 2)</div>
            <p className="text-[13px] text-slate-600 mt-1.5 max-w-xl">
              Liquid Assets + 40% × squad market value − Liquid Liabilities ≥ <span className="num text-slate-900">£85,000,000</span> stress test.
            </p>
          </div>
          <div className="text-right">
            <StatusBadge status={passing === null ? 'green' : passing ? 'green' : 'red'}>
              {passing === null ? 'NO DATA' : passing ? 'PASS' : 'FAIL'}
            </StatusBadge>
            {preview && (
              <div className="text-[11px] text-slate-500 mt-2 num">
                Headroom: <span className={preview.headroom < 0 ? 'text-red-700' : 'text-green-700'}>
                  {preview.headroom < 0 ? '−' : ''}{formatPence(Math.abs(preview.headroom))}
                </span>
              </div>
            )}
          </div>
        </div>
      </Card>

      <Card className="p-6">
        <div className="grid grid-cols-3 gap-5">
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
              sub={preview.headroom < 0 ? 'Above stress threshold needed' : 'Above the required floor'}
            />
          </div>
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

  useEffect(() => { load() }, [])

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

  return (
    <div className="space-y-5">
      {error && (
        <Card className="p-4 border-red-200 bg-red-50">
          <p className="text-[13px] text-red-700">{error}</p>
        </Card>
      )}

      <Card className={cn(
        'p-6 border-l-4',
        passing === null ? 'border-l-slate-300' : passing ? 'border-l-green-600' : 'border-l-red-600'
      )}>
        <div className="flex items-start justify-between">
          <div>
            <div className="meta-label">Positive Equity Test (Test 3)</div>
            <p className="text-[13px] text-slate-600 mt-1.5 max-w-xl">
              Total Liabilities ÷ Adjusted Assets ≤ <span className="num text-slate-900">{(threshold * 100).toFixed(0)}%</span> for {SEASON}.
            </p>
          </div>
          <div className="text-right">
            <StatusBadge status={passing === null ? 'green' : passing ? 'green' : 'red'}>
              {passing === null ? 'NO DATA' : passing ? 'PASS' : 'FAIL'}
            </StatusBadge>
          </div>
        </div>
      </Card>

      <Card className="p-6">
        <div className="grid grid-cols-2 gap-5">
          <Field label="Total Liabilities (£)" helper="All balance-sheet liabilities incl. shareholder loans">
            <PoundInput value={liabilities} onChange={setLiabilities} />
          </Field>
          <Field label="Adjusted Assets (£)" helper="Net book value of players + assets (whichever is higher)">
            <PoundInput value={adjustedAssets} onChange={setAdjustedAssets} />
          </Field>
        </div>

        {preview && (
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
// Local primitives
// ---------------------------------------------------------------------------

function Th({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' }) {
  return <th className={cn('meta-label px-5 py-3', align === 'right' ? 'text-right' : 'text-left')}>{children}</th>
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
