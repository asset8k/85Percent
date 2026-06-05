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
import { useTranslation, Trans } from 'react-i18next'
import { Link } from 'react-router-dom'
import { api } from '@/lib/api'
import { useClubStore } from '@/stores/club'
import { useSeasonStore, seasonKey } from '@/stores/season'
import { activeLocale, formatNumber } from '@/lib/locale'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { FormPageSkeleton } from '@/components/ui/page-skeletons'
import { NumericInput } from '@/components/ui/numeric-input'
import { useWorkspaceCurrency } from '@/lib/useWorkspaceCurrency'
import { cn } from '@/lib/utils'
import type {
  WorkingCapitalResponse,
  LiquidityResponse,
  EquityResponse,
} from '@/lib/api'

type Tab = 'working-capital' | 'liquidity' | 'equity'

const TABS: Array<{ id: Tab; labelKey: string; testNo: number }> = [
  { id: 'working-capital', labelKey: 'ssr.tabs.workingCapital', testNo: 1 },
  { id: 'liquidity', labelKey: 'ssr.tabs.liquidity', testNo: 2 },
  { id: 'equity', labelKey: 'ssr.tabs.equity', testNo: 3 },
]

export function SSRPage() {
  const { t } = useTranslation()
  const { leagueId } = useClubStore()
  const [tab, setTab] = useState<Tab>('working-capital')

  // Gate the page client-side too — even though the API enforces it
  if (leagueId && leagueId !== 'premier-league') {
    return (
      <div>
        <PageHeader />
        <Card className="p-12 text-center">
          <p className="text-[15px] font-medium text-slate-900">{t('ssr.plOnly.title')}</p>
          <p className="text-[13px] text-slate-500 mt-2 max-w-md mx-auto">
            {t('ssr.plOnly.body')}
          </p>
          <Link to="/financials" className="inline-block mt-5">
            <Button>{t('dashboard.setup.cta')}</Button>
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
        {TABS.map((tb) => (
          <TabButton key={tb.id} active={tab === tb.id} onClick={() => setTab(tb.id)} testNo={tb.testNo}>
            {t(tb.labelKey)}
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
  const { t } = useTranslation()
  return (
    <div className="mb-6 flex items-center gap-3">
      <span className="inline-block w-1.5 h-7 rounded-full bg-violet-600" />
      <div>
        <h1 className="text-[24px] font-bold text-slate-900 tracking-tight leading-none">{t('nav.ssrTests')}</h1>
        <p className="text-[13px] text-slate-500 mt-1.5">
          {t('ssr.subtitle')}
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
// derived from the active season so the grid follows the TopBar selector. Month
// names are localized via the active interface locale (e.g. "jul 2026" in es).
function monthsOfSeason(startYear: number): Array<{ key: string; label: string; short: string }> {
  const fmt = new Intl.DateTimeFormat(activeLocale(), { month: 'short' })
  const out: Array<{ key: string; label: string; short: string }> = []
  for (let i = 6; i < 18; i++) {
    const year = startYear + Math.floor(i / 12)
    const month = i % 12 // 0-indexed
    const short = fmt.format(new Date(Date.UTC(year, month, 1)))
    out.push({
      key: `${year}-${String(month + 1).padStart(2, '0')}`,
      label: `${short} ${year}`,
      short,
    })
  }
  return out
}

function WorkingCapitalTab() {
  const { t, i18n } = useTranslation()
  const { format: fmtMoney, symbol } = useWorkspaceCurrency()
  const seasonStartYear = useSeasonStore((s) => s.startYear)
  const SEASON = seasonKey(seasonStartYear)
  const MONTHS_OF_SEASON = useMemo(() => monthsOfSeason(seasonStartYear), [seasonStartYear, i18n.language])
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
      setError(e instanceof Error ? e.message : t('ssr.wc.failLoad'))
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
      setError(e instanceof Error ? e.message : t('ssr.wc.failSave'))
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
        statusText={status === 'fail' ? t('ssr.wc.statusFail', { count: failingCount }) : undefined}
        title={t('ssr.tabs.workingCapital')}
        description={
          <Trans i18nKey="ssr.wc.desc" values={{ amount: `${symbol}${formatNumber(12_500_000)}` }} components={{ n: <Num /> }} />
        }
        metricLabel={t('ssr.wc.metricLabel')}
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
          title={t('ssr.wc.glanceTitle')}
          sub={t('ssr.wc.glanceSub')}
        />
        <div className="mt-5 grid grid-cols-12 gap-1.5">
          {MONTHS_OF_SEASON.map((m) => {
            const hr = rowsByMonth.get(m.key)
            const state = hr === undefined ? 'empty' : hr < 0 ? 'fail' : 'pass'
            return (
              <div key={m.key} className="flex flex-col items-center gap-1.5" title={
                hr === undefined
                  ? t('ssr.wc.tipNoData', { label: m.label })
                  : t('ssr.wc.tipHeadroom', { label: m.label, headroom: (hr < 0 ? '−' : '') + fmtMoney(Math.abs(hr)) })
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
            <LegendDot className="bg-green-400" label={t('ssr.wc.legendPassing', { count: passingCount })} />
            <LegendDot className="bg-red-400" label={t('ssr.wc.legendFailing', { count: failingCount })} />
            <LegendDot className="bg-slate-200" label={t('ssr.wc.legendNoData', { count: MONTHS_OF_SEASON.length - monthsWithData })} />
          </div>
        )}
      </Card>

      {/* 12-month editable grid */}
      <Card className="overflow-hidden">
        <div className="px-6 pt-5 pb-4 border-b border-slate-100">
          <SectionHeader title={t('ssr.wc.inputsTitle')} sub={t('ssr.wc.inputsSub')} />
        </div>
        <table className="w-full">
          <thead className="border-b border-slate-100 bg-slate-50/60">
            <tr>
              <Th>{t('ssr.wc.thMonth')}</Th>
              <Th align="right">{t('ssr.wc.thCashflow', { symbol })}</Th>
              <Th align="right">{t('ssr.wc.thFunds', { symbol })}</Th>
              <Th align="right">{t('ssr.wc.thHeadroom')}</Th>
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
                    {headroom === undefined ? '—' : (headroom < 0 ? '−' : '') + fmtMoney(Math.abs(headroom))}
                  </td>
                  <td className="px-6 py-3 text-right w-px">
                    {edit?.dirty && (
                      <button
                        onClick={() => saveRow(m.key)}
                        disabled={edit.saving || !Number.isFinite(cashflow) || !Number.isFinite(funds)}
                        className="text-[12px] font-medium text-violet-600 hover:text-violet-700 disabled:opacity-60 inline-flex items-center gap-1"
                      >
                        {edit.saving && <Spinner size={11} />}
                        {edit.saving ? t('ssr.wc.saving') : t('ssr.wc.save')}
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
  const { t } = useTranslation()
  const { format: fmtMoney, symbol } = useWorkspaceCurrency()
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
      setError(e instanceof Error ? e.message : t('ssr.liquidity.failLoad'))
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
      setError(e instanceof Error ? e.message : t('ssr.liquidity.failSave'))
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
        title={t('ssr.tabs.liquidity')}
        description={
          <Trans i18nKey="ssr.liquidity.desc" values={{ amount: `${symbol}${formatNumber(85_000_000)}` }} components={{ n: <Num /> }} />
        }
        metricLabel={t('ssr.liquidity.metricLabel')}
        metric={preview ? <SignedPence pence={preview.headroom} /> : <span className="text-slate-300">—</span>}
      />

      <Card className="p-6">
        <SectionHeader title={t('ssr.liquidity.inputsTitle')} sub={t('ssr.liquidity.inputsSub')} />
        <div className="mt-5 grid grid-cols-3 gap-5">
          <Field label={t('ssr.liquidity.fAssets')} helper={t('ssr.liquidity.fAssetsHelper')}>
            <PoundInput value={assets} onChange={setAssets} />
          </Field>
          <Field label={t('ssr.liquidity.fLiab')} helper={t('ssr.liquidity.fLiabHelper')}>
            <PoundInput value={liabilities} onChange={setLiabilities} />
          </Field>
          <Field label={t('ssr.liquidity.fMv')} helper={t('ssr.liquidity.fMvHelper')}>
            <PoundInput value={marketValue} onChange={setMarketValue} />
          </Field>
        </div>

        {preview && (
          <>
            <div className="mt-6 pt-5 border-t border-slate-100">
              <div className="flex items-center justify-between mb-3">
                <span className="meta-label">{t('ssr.liquidity.netVsFloor')}</span>
                <span className={cn('num text-[12px] font-medium', preview.headroom < 0 ? 'text-red-600' : 'text-green-700')}>
                  {preview.headroom < 0 ? t('ssr.liquidity.belowFloor') : t('ssr.liquidity.aboveFloor')}
                </span>
              </div>
              <ZoneBar
                value={preview.net}
                threshold={LIQUIDITY_THRESHOLD_PENCE}
                goodSide="above"
                thresholdLabel={t('ssr.liquidity.floorLabel', { symbol })}
                formatTick={(n) => fmtCompactPence(n, symbol)}
                valueLabel={fmtCompactPence(preview.net, symbol)}
              />
            </div>

            <div className="mt-6 pt-5 border-t border-slate-100 grid grid-cols-3 gap-5">
              <StatBlock
                label={t('ssr.liquidity.sbEffective')}
                value={fmtMoney(preview.effective)}
                sub={t('ssr.liquidity.sbEffectiveSub')}
              />
              <StatBlock
                label={t('ssr.liquidity.sbThreshold')}
                value={fmtMoney(LIQUIDITY_THRESHOLD_PENCE)}
                sub={t('ssr.liquidity.sbThresholdSub')}
              />
              <StatBlock
                label={t('ssr.liquidity.sbHeadroom')}
                value={`${preview.headroom < 0 ? '−' : ''}${fmtMoney(Math.abs(preview.headroom))}`}
                valueClass={preview.headroom < 0 ? 'text-red-700' : 'text-green-700'}
                sub={preview.headroom < 0 ? t('ssr.liquidity.sbHeadroomShort') : t('ssr.liquidity.sbHeadroomAbove')}
              />
            </div>
          </>
        )}

        <div className="mt-6 pt-5 border-t border-slate-100 flex items-center justify-end">
          <Button onClick={save} disabled={saving || ![assets, liabilities, marketValue].every(Number.isFinite)}>
            {saving && <Spinner size={14} />}
            {saving ? t('ssr.liquidity.saving') : t('ssr.liquidity.save')}
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
  const { t } = useTranslation()
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
      setError(e instanceof Error ? e.message : t('ssr.equity.failLoad'))
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
      setError(e instanceof Error ? e.message : t('ssr.equity.failSave'))
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
        title={t('ssr.tabs.equity')}
        description={
          <Trans i18nKey="ssr.equity.desc" values={{ pct: `${(threshold * 100).toFixed(0)}%`, season: SEASON }} components={{ n: <Num /> }} />
        }
        metricLabel={t('ssr.equity.metricLabel')}
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
        <SectionHeader title={t('ssr.equity.inputsTitle')} sub={t('ssr.equity.inputsSub')} />
        <div className="mt-5 grid grid-cols-2 gap-5">
          <Field label={t('ssr.equity.fLiab')} helper={t('ssr.equity.fLiabHelper')}>
            <PoundInput value={liabilities} onChange={setLiabilities} />
          </Field>
          <Field label={t('ssr.equity.fAssets')} helper={t('ssr.equity.fAssetsHelper')}>
            <PoundInput value={adjustedAssets} onChange={setAdjustedAssets} />
          </Field>
        </div>

        {preview && (
          <>
            <div className="mt-6 pt-5 border-t border-slate-100">
              <div className="flex items-center justify-between mb-3">
                <span className="meta-label">{t('ssr.equity.ratioVsCap', { season: SEASON })}</span>
                <span className={cn('num text-[12px] font-medium', preview.passing ? 'text-green-700' : 'text-red-600')}>
                  {preview.passing ? t('ssr.equity.withinCap') : t('ssr.equity.overCap')}
                </span>
              </div>
              <ZoneBar
                value={preview.ratio}
                threshold={threshold}
                goodSide="below"
                domainMax={Math.max(1, preview.ratio * 1.1)}
                thresholdLabel={t('ssr.equity.capLabel', { pct: `${(threshold * 100).toFixed(0)}%` })}
                formatTick={fmtPctTick}
                valueLabel={`${(preview.ratio * 100).toFixed(1)}%`}
              />
            </div>

            <div className="mt-6 pt-5 border-t border-slate-100 grid grid-cols-3 gap-5">
              <StatBlock
                label={t('ssr.equity.sbRatio')}
                value={(preview.ratio * 100).toFixed(1) + '%'}
                valueClass={preview.passing ? 'text-slate-900' : 'text-red-700'}
                sub={t('ssr.equity.sbRatioSub', { season: SEASON, pct: `${(threshold * 100).toFixed(0)}%` })}
              />
              <StatBlock
                label={t('ssr.equity.sbMargin')}
                value={`${preview.marginPp >= 0 ? '+' : ''}${preview.marginPp.toFixed(2)} pp`}
                valueClass={preview.marginPp >= 0 ? 'text-green-700' : 'text-red-700'}
                sub={t('ssr.equity.sbMarginSub')}
              />
              <StatBlock
                label={t('ssr.equity.sbTier')}
                value={t('ssr.equity.capLabel', { pct: SEASON === '2026-27' ? '90%' : SEASON === '2027-28' ? '85%' : '80%' })}
                sub={t('ssr.equity.sbTierSub')}
              />
            </div>
          </>
        )}

        <div className="mt-6 pt-5 border-t border-slate-100 flex items-center justify-end">
          <Button onClick={save} disabled={saving || !Number.isFinite(liabilities) || !Number.isFinite(adjustedAssets)}>
            {saving && <Spinner size={14} />}
            {saving ? t('ssr.equity.saving') : t('ssr.equity.save')}
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

const STATUS_STYLE: Record<TestStatus, { bd: string; bg: string; dot: string; text: string; labelKey: string }> = {
  pass:   { bd: 'border-l-green-600', bg: 'bg-green-50/50', dot: '#16a34a', text: 'text-green-700', labelKey: 'ssr.status.pass' },
  fail:   { bd: 'border-l-red-600',   bg: 'bg-red-50/50',   dot: '#dc2626', text: 'text-red-700',   labelKey: 'ssr.status.fail' },
  nodata: { bd: 'border-l-slate-300', bg: 'bg-white',       dot: '#cbd5e1', text: 'text-slate-400', labelKey: 'ssr.status.nodata' },
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
  const { t } = useTranslation()
  const c = STATUS_STYLE[status]
  return (
    <Card className={cn('p-6 border-l-4 flex items-center justify-between gap-6', c.bd, c.bg)}>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: c.dot }} />
          <span className={cn('meta-label', c.text)} style={{ letterSpacing: '0.1em' }}>
            {statusText ?? t(c.labelKey)}
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
  const { t } = useTranslation()
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
        <Trans i18nKey="ssr.zoneBar.youAreAt" values={{ value: valueLabel }} components={{ v: <span className="num text-slate-600 font-medium" /> }} />
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
  const { format } = useWorkspaceCurrency()
  return <>{(pence < 0 ? '−' : '') + format(Math.abs(pence))}</>
}

function Num({ children }: { children?: React.ReactNode }) {
  return <span className="num text-slate-900">{children}</span>
}

// Compact pence → "£85M" / "€250k" for axis ticks. Symbol from the active
// workspace currency (defaults to £).
function fmtCompactPence(pence: number, symbol = '£'): string {
  const sign = pence < 0 ? '−' : ''
  const abs = Math.abs(pence) / 100
  if (abs >= 1_000_000) return `${sign}${symbol}${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1).replace(/\.0$/, '')}M`
  if (abs >= 1_000) return `${sign}${symbol}${Math.round(abs / 1_000)}k`
  return `${sign}${symbol}${Math.round(abs)}`
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
  // String labels carry a "(£)" money hint; swap it for the workspace symbol so
  // every field re-labels instantly when the currency changes.
  const { symbol } = useWorkspaceCurrency()
  const rendered = symbol !== '£' ? label.replaceAll('£', symbol) : label
  return (
    <label className="block">
      <span className="meta-label block mb-1.5">{rendered}</span>
      {children}
      {helper && <span className="block text-[11px] text-slate-400 mt-1">{helper}</span>}
    </label>
  )
}

function PoundInput({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const { symbol } = useWorkspaceCurrency()
  return (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-[14px]">{symbol}</span>
      <NumericInput value={value} onChange={onChange} className={inputBase + ' pl-7 num'} placeholder="0" />
    </div>
  )
}

function PoundCell({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const { symbol } = useWorkspaceCurrency()
  return (
    <div className="relative">
      <span className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 text-[12px]">{symbol}</span>
      <NumericInput
        value={value}
        onChange={onChange}
        className="w-full pl-6 pr-2 py-1.5 text-[13px] rounded border border-slate-300 text-right num focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500"
      />
    </div>
  )
}
