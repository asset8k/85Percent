import type { SCRResult, TransactionType } from '@headroom/shared'
import { formatPence } from '@headroom/shared'
import { Card } from '@/components/ui/card'
import { StatusBadge } from '@/components/ui/badge'
import { ComplianceGauge } from './ComplianceGauge'
import { AmortisationTable } from './AmortisationTable'

interface SCRResultPanelProps {
  result: SCRResult
  transactionType?: TransactionType
}

function fmtPct(ratio: number) {
  return (ratio * 100).toFixed(1) + '%'
}

function fmtGBP(pence: number, opts?: { signed?: boolean; compact?: boolean }) {
  if (pence === null || pence === undefined) return '—'
  const abs = Math.abs(pence)
  const pounds = abs / 100
  let body: string
  if (opts?.compact && pounds >= 1_000_000) {
    body = '£' + (pence / 100 / 1_000_000).toFixed(pounds >= 10_000_000 ? 1 : 2).replace(/\.0$/, '') + 'M'
  } else if (opts?.compact && pounds >= 1_000) {
    body = '£' + Math.round(pence / 100 / 1_000) + 'k'
  } else {
    body = formatPence(Math.round(Math.abs(pence)))
  }
  if (opts?.signed && pence > 0) return '+' + body
  if (pence < 0) return '−£' + body.replace(/^£/, '').replace('-', '')
  return body
}

export function EmptyResults() {
  return (
    <div className="border-2 border-dashed border-slate-200 rounded-xl flex items-center justify-center p-16 min-h-[520px]">
      <div className="text-center max-w-sm">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-violet-50 border border-violet-100 mb-4">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#7c3aed" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 18V8" /><path d="M10 18V4" /><path d="M16 18V11" /><path d="M3 21h18" />
          </svg>
        </div>
        <p className="text-sm text-slate-500">Run a simulation to see your compliance position.</p>
        <p className="text-[12px] text-slate-400 mt-1.5">Results appear here in seconds.</p>
      </div>
    </div>
  )
}

const TX_NOUN: Record<string, string> = {
  buy:      'transfer',
  sell:     'sale',
  loan_in:  'loan',
  loan_out: 'loan out',
}

function StatusBanner({ result, transactionType }: { result: SCRResult; transactionType?: TransactionType }) {
  const s = result.projectedStatus
  const noun = TX_NOUN[transactionType ?? 'buy']
  const map = {
    green: { bg: 'bg-green-50', bd: 'border-green-600', text: 'text-green-700', dot: '#16a34a', label: 'COMPLIANT' },
    amber: { bg: 'bg-amber-50', bd: 'border-amber-500', text: 'text-amber-700', dot: '#f59e0b', label: 'LEVY ZONE' },
    red:   { bg: 'bg-red-50',   bd: 'border-red-600',   text: 'text-red-700',   dot: '#dc2626', label: 'POINTS RISK' },
  }
  const c = map[s]
  const blurb = {
    green: `This ${noun} keeps squad costs within the Green Threshold. No sanctions apply.`,
    amber: `Squad costs would exceed the 85% Green Threshold after this ${noun} — a financial levy applies.`,
    red: `Squad costs would exceed the Red Threshold after this ${noun} — points deduction risk.`,
  }

  return (
    <div className={`rounded-xl border border-slate-200 border-l-4 ${c.bd} ${c.bg} px-6 py-5 flex items-center justify-between gap-6`}>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="inline-block w-1.5 h-1.5 rounded-full" style={{ background: c.dot }} />
          <span className={`meta-label ${c.text}`} style={{ letterSpacing: '0.1em' }}>{c.label}</span>
        </div>
        <div className="text-[14px] text-slate-700 mt-2 leading-relaxed">{blurb[s]}</div>
      </div>
      <div className="text-right flex-shrink-0">
        <div className="meta-label text-slate-500">Projected SCR</div>
        <div className={`num text-[34px] font-semibold leading-none mt-1.5 ${c.text}`}>{fmtPct(result.projectedSCRRatio)}</div>
      </div>
    </div>
  )
}

function ComparisonCards({ result }: { result: SCRResult }) {
  const greenThreshold = result.currentGreenThreshold
  const revenue = greenThreshold / 0.85
  const currentSquadCosts = Math.round(result.currentSCRRatio * revenue)
  const currentHeadroom = greenThreshold - currentSquadCosts
  const projectedGreenThreshold = result.projectedSquadCosts + result.headroomRemaining

  const beforeStatus = result.currentStatus
  const afterStatus = result.projectedStatus

  const statusShort = (s: string) => s === 'green' ? 'Compliant' : s === 'amber' ? 'Levy' : 'Risk'
  const statusHeadline = {
    green: 'text-slate-900',
    amber: 'text-amber-700',
    red: 'text-red-700',
  }

  return (
    <div className="grid grid-cols-2 gap-4">
      {/* Before */}
      <div className="rounded-xl border border-slate-200 bg-white p-6 flex flex-col">
        <div className="flex items-center justify-between mb-5">
          <span className="meta-label">Before Transfer</span>
          <StatusBadge status={beforeStatus as 'green' | 'amber' | 'red'}>{statusShort(beforeStatus)}</StatusBadge>
        </div>
        <div className="flex items-baseline gap-2.5">
          <span className="num text-[36px] font-semibold leading-none text-slate-900">{fmtPct(result.currentSCRRatio)}</span>
          <span className="text-[12px] text-slate-400">SCR</span>
        </div>
        <div className="mt-6 pt-5 border-t border-slate-100 space-y-3 text-[13px]">
          <div className="flex items-center justify-between">
            <span className="text-slate-500">Squad Costs</span>
            <span className="num text-slate-900">{fmtGBP(currentSquadCosts)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-slate-500">Green Threshold</span>
            <span className="num text-slate-500">{fmtGBP(greenThreshold)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-slate-500">Headroom to limit</span>
            <span className={`num font-medium ${currentHeadroom < 0 ? 'text-red-600' : 'text-slate-900'}`}>
              {fmtGBP(currentHeadroom, { signed: true })}
            </span>
          </div>
        </div>
      </div>

      {/* After */}
      <div className={`rounded-xl border bg-white p-6 flex flex-col ${
        afterStatus === 'amber' ? 'border-amber-200' : afterStatus === 'red' ? 'border-red-200' : 'border-slate-200'
      }`}>
        <div className="flex items-center justify-between mb-5">
          <span className="meta-label">After Transfer</span>
          <StatusBadge status={afterStatus as 'green' | 'amber' | 'red'}>{statusShort(afterStatus)}</StatusBadge>
        </div>
        <div className="flex items-baseline gap-2.5">
          <span className={`num text-[36px] font-semibold leading-none ${statusHeadline[afterStatus]}`}>{fmtPct(result.projectedSCRRatio)}</span>
          <span className="text-[12px] text-slate-400">SCR</span>
        </div>
        <div className="mt-6 pt-5 border-t border-slate-100 space-y-3 text-[13px]">
          <div className="flex items-center justify-between">
            <span className="text-slate-500">Squad Costs</span>
            <span className="num text-slate-900">{fmtGBP(result.projectedSquadCosts)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-slate-500">Green Threshold</span>
            <span className="num text-slate-500">{fmtGBP(projectedGreenThreshold)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-slate-500">Headroom to limit</span>
            <span className={`num font-medium ${result.headroomRemaining < 0 ? 'text-red-600' : 'text-slate-900'}`}>
              {fmtGBP(result.headroomRemaining, { signed: true })}
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}

function ImpactFooter({ result }: { result: SCRResult }) {
  const isRelief = result.totalAnnualCostImpact < 0
  return (
    <div className="mt-6 -mx-6 -mb-6 px-6 py-5 bg-slate-50/70 border-t border-slate-100 rounded-b-xl flex items-center justify-between">
      <div>
        <div className="meta-label">Total Annual SCR Impact</div>
        <div className="text-[12px] text-slate-500 mt-1">
          {isRelief ? 'Reduction to squad costs in the projection' : 'Added to current squad costs in the projection'}
        </div>
      </div>
      <div className={`num text-[28px] font-semibold ${isRelief ? 'text-green-700' : 'text-slate-900'}`}>
        {fmtGBP(result.totalAnnualCostImpact, { signed: true })}
      </div>
    </div>
  )
}

function CostBreakdown({ result, transactionType }: { result: SCRResult; transactionType?: TransactionType }) {
  const type = transactionType ?? 'buy'

  if (type === 'sell') {
    return (
      <Card className="p-6">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <span className="inline-block w-1 h-5 rounded-full bg-green-600" />
            <h3 className="text-[15px] font-semibold text-slate-900">Cost Relief Breakdown</h3>
          </div>
          <span className="text-[12px] text-slate-400">Annualised for SCR</span>
        </div>
        <div className="grid grid-cols-3 gap-5">
          <StatBlock
            label="Annual Cost Relief"
            value={result.totalAnnualCostImpact < 0 ? fmtGBP(result.totalAnnualCostImpact) : '—'}
            valueClass="text-green-700"
            sub="Wage + amortisation saved"
          />
          <StatBlock
            label="Revenue Uplift"
            value={result.netPlayerSaleImpact > 0 ? fmtGBP(result.netPlayerSaleImpact, { signed: true }) : '—'}
            valueClass={result.netPlayerSaleImpact > 0 ? 'text-green-700' : ''}
            sub="Sale profit above book value"
          />
          <div />
        </div>
        <ImpactFooter result={result} />
      </Card>
    )
  }

  if (type === 'loan_in') {
    const annualWage = result.totalAnnualCostImpact - result.annualAmortisation
    return (
      <Card className="p-6">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <span className="inline-block w-1 h-5 rounded-full bg-violet-600" />
            <h3 className="text-[15px] font-semibold text-slate-900">Loan Cost Breakdown</h3>
          </div>
          <span className="text-[12px] text-slate-400">Annualised for SCR</span>
        </div>
        <div className="grid grid-cols-3 gap-5">
          <StatBlock label="Annual Loan Fee Spread" value={fmtGBP(result.annualAmortisation)} />
          <StatBlock label="Annual Wage Contribution" value={fmtGBP(annualWage)} />
          <div />
        </div>
        <ImpactFooter result={result} />
      </Card>
    )
  }

  if (type === 'loan_out') {
    return (
      <Card className="p-6">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <span className="inline-block w-1 h-5 rounded-full bg-green-600" />
            <h3 className="text-[15px] font-semibold text-slate-900">Loan Out Breakdown</h3>
          </div>
          <span className="text-[12px] text-slate-400">Annualised for SCR</span>
        </div>
        <div className="grid grid-cols-3 gap-5">
          <StatBlock
            label="Annual Wage Covered"
            value={result.totalAnnualCostImpact < 0 ? fmtGBP(result.totalAnnualCostImpact) : '—'}
            valueClass="text-green-700"
            sub="Cost relief from loan"
          />
          <StatBlock
            label="Annual Loan Fee Income"
            value={result.netPlayerSaleImpact > 0 ? fmtGBP(result.netPlayerSaleImpact, { signed: true }) : '—'}
            valueClass={result.netPlayerSaleImpact > 0 ? 'text-green-700' : ''}
            sub="Revenue from receiving club"
          />
          <div />
        </div>
        <ImpactFooter result={result} />
      </Card>
    )
  }

  // buy or legacy
  const annualWage = result.totalAnnualCostImpact - result.annualAmortisation - result.annualAgentFeeImpact
  return (
    <Card className="p-6">
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <span className="inline-block w-1 h-5 rounded-full bg-violet-600" />
          <h3 className="text-[15px] font-semibold text-slate-900">Transfer Cost Breakdown</h3>
        </div>
        <span className="text-[12px] text-slate-400">Annualised for SCR</span>
      </div>
      <div className="grid grid-cols-3 gap-5">
        <StatBlock label="Annual Amortisation" value={fmtGBP(result.annualAmortisation)} />
        <StatBlock label="Annual Wage Cost" value={fmtGBP(annualWage)} />
        <StatBlock label="Agent Fee (per year)" value={fmtGBP(result.annualAgentFeeImpact)} />
      </div>
      {result.netPlayerSaleImpact > 0 && (
        <div className="mt-5 pt-5 border-t border-slate-100 grid grid-cols-3 gap-5">
          <StatBlock label="Sale Relief" value={`−${fmtGBP(result.netPlayerSaleImpact)}`} valueClass="text-green-700" sub="Offset from outgoing player" />
          <div /><div />
        </div>
      )}
      <ImpactFooter result={result} />
    </Card>
  )
}

function StatBlock({ label, value, sub, valueClass = '' }: { label: string; value: string; sub?: string; valueClass?: string }) {
  return (
    <div className="flex flex-col">
      <span className="meta-label mb-1.5">{label}</span>
      <span className={`num text-[20px] text-slate-900 font-medium leading-none ${valueClass}`}>{value}</span>
      {sub && <span className="text-[12px] text-slate-400 mt-1.5">{sub}</span>}
    </div>
  )
}

function SanctionsPanel({ result }: { result: SCRResult }) {
  const s = result.projectedStatus
  if (s === 'green') return null

  if (s === 'amber' && result.projectedLevy !== undefined) {
    const overspend = result.projectedSquadCosts - result.currentGreenThreshold
    return (
      <div className="rounded-xl border border-slate-200 border-l-4 border-amber-500 bg-amber-50 p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="meta-label text-amber-700">Estimated Financial Levy</div>
            <p className="text-[13px] text-slate-700 mt-2 max-w-xl">
              Based on <span className="num text-amber-700">{fmtGBP(overspend)}</span> overspend above the Green Threshold.
            </p>
          </div>
          <div className="num text-[32px] font-semibold text-amber-700 leading-none">{fmtGBP(result.projectedLevy)}</div>
        </div>
      </div>
    )
  }

  if (s === 'red' && result.projectedPointsDeduction !== undefined) {
    return (
      <div className="rounded-xl border border-slate-200 border-l-4 border-red-600 bg-red-50 p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="meta-label text-red-700">Estimated Points Deduction</div>
            <p className="text-[13px] text-slate-700 mt-2 max-w-xl">
              Squad costs exceed the Red Threshold. Points deductions are imposed in the same season the breach occurs.
            </p>
            <p className="text-[12px] text-red-700 mt-3 font-medium">Seek independent legal advice before proceeding.</p>
          </div>
          <div className="num text-[32px] font-semibold text-red-700 leading-none whitespace-nowrap">
            {result.projectedPointsDeduction} pts
          </div>
        </div>
      </div>
    )
  }

  return null
}

export function SCRResultPanel({ result, transactionType }: SCRResultPanelProps) {
  const greenPct = 85
  const revenue = result.currentGreenThreshold / 0.85
  const redPct = (result.currentRedThreshold / revenue) * 100
  const currentPct = result.currentSCRRatio * 100
  const projectedPct = result.projectedSCRRatio * 100
  const isLoanIn = transactionType === 'loan_in'
  const showSchedule = result.amortisationSchedule.length > 0

  return (
    <div className="flex flex-col gap-5">
      <StatusBanner result={result} transactionType={transactionType} />
      <ComparisonCards result={result} />
      <CostBreakdown result={result} transactionType={transactionType} />
      <Card className="p-6">
        <ComplianceGauge
          currentPct={currentPct}
          projectedPct={projectedPct}
          greenPct={greenPct}
          redPct={redPct}
        />
      </Card>
      <SanctionsPanel result={result} />
      {showSchedule && (
        <Card className="p-6">
          <div className="flex items-center gap-3 mb-4">
            <span className="inline-block w-1 h-5 rounded-full bg-violet-600" />
            <div>
              <h3 className="text-[15px] font-semibold text-slate-900 leading-tight">
                {isLoanIn ? 'Loan Fee Schedule' : 'Amortisation Schedule'}
              </h3>
              <p className="text-[12px] text-slate-500 mt-0.5">
                {isLoanIn ? 'Year-by-year spread of the loan fee' : 'Year-by-year breakdown of the transfer fee'}
              </p>
            </div>
          </div>
          <AmortisationTable schedule={result.amortisationSchedule} />
        </Card>
      )}
    </div>
  )
}
