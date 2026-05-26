import { useState } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { api } from '@/lib/api'
import type { ClubFinancialsResponse } from '@/lib/api'
import { useClubStore } from '@/stores/club'
import { Button } from '@/components/ui/button'
import { NumericInput } from '@/components/ui/numeric-input'
import { Card } from '@/components/ui/card'
import { SCRResultPanel, EmptyResults } from '@/components/simulator/SCRResultPanel'
import type { SCRResult } from '@headroom/shared'
import type { TransactionType } from '@headroom/shared'
import { weeklyWageToAnnualPence } from '@headroom/shared'
import { Link } from 'react-router-dom'

// ─── Zod schema ──────────────────────────────────────────────────────────────

const SimulatorSchema = z.object({
  transactionType: z.enum(['buy', 'sell', 'loan_in', 'loan_out']),
  label: z.string().max(100).optional(),

  // BUY & LOAN_IN
  transferFeePounds: z.number({ invalid_type_error: 'Enter a number' }).int().min(0).max(200_000_000, 'Cannot exceed £200M').optional(),
  contractLengthYears: z.number({ invalid_type_error: 'Enter a number' }).min(0.5).max(10).optional(),
  weeklyWagePounds: z.number({ invalid_type_error: 'Enter a number' }).int().min(0).max(500_000, 'Cannot exceed £500K/week').optional(),
  agentFeePounds: z.number({ invalid_type_error: 'Enter a number' }).int().min(0).max(20_000_000, 'Cannot exceed £20M').optional(),

  // SELL
  saleProceedsPounds: z.number({ invalid_type_error: 'Enter a number' }).int().min(0).max(200_000_000, 'Cannot exceed £200M').optional(),
  playerBookValuePounds: z.number({ invalid_type_error: 'Enter a number' }).int().min(0).max(200_000_000, 'Cannot exceed £200M').optional(),
  weeklyWageReleasedPounds: z.number({ invalid_type_error: 'Enter a number' }).int().min(0).max(500_000, 'Cannot exceed £500K/week').optional(),
  annualAmortisationReliefPounds: z.number({ invalid_type_error: 'Enter a number' }).int().min(0).max(50_000_000, 'Cannot exceed £50M/year').optional(),

  // LOAN_OUT
  loanFeeReceivedPounds: z.number({ invalid_type_error: 'Enter a number' }).int().min(0).max(20_000_000, 'Cannot exceed £20M').optional(),
  loanLengthYears: z.number({ invalid_type_error: 'Enter a number' }).min(0.5).max(5).optional(),
  weeklyWageCoveredPounds: z.number({ invalid_type_error: 'Enter a number' }).int().min(0).max(500_000, 'Cannot exceed £500K/week').optional(),
})
type SimulatorData = z.infer<typeof SimulatorSchema>

// ─── Transaction type config ─────────────────────────────────────────────────

const TX_TYPES: { type: TransactionType; label: string }[] = [
  { type: 'buy',      label: 'Buy'      },
  { type: 'sell',     label: 'Sell'     },
  { type: 'loan_in',  label: 'Loan In'  },
  { type: 'loan_out', label: 'Loan Out' },
]

// ─── Component ───────────────────────────────────────────────────────────────

export function SimulatorPage() {
  const { financials, scrInfluence, simulationCount, totalStackedCostImpact, setStackedHistory } = useClubStore()
  const [result, setResult] = useState<SCRResult | null>(null)
  const [resultType, setResultType] = useState<TransactionType>('buy')
  const [simulationId, setSimulationId] = useState<string | null>(null)
  const [serverError, setServerError] = useState('')
  const [loading, setLoading] = useState(false)

  const form = useForm<SimulatorData>({
    resolver: zodResolver(SimulatorSchema),
    defaultValues: {
      transactionType: 'buy',
      transferFeePounds: 8_000_000,
      contractLengthYears: 4,
      weeklyWagePounds: 28_000,
      agentFeePounds: 400_000,
    },
  })

  const txType = form.watch('transactionType')

  const onSubmit = async (data: SimulatorData) => {
    if (!financials) return
    setLoading(true)
    setServerError('')
    setResult(null)

    try {
      const payload = buildPayload(data, financials, scrInfluence, simulationCount, totalStackedCostImpact)
      const response = await api.simulations.create(payload)
      setResult(response.scrResult)
      setResultType(data.transactionType)
      setSimulationId(response.id)
      setStackedHistory(
        simulationCount + 1,
        totalStackedCostImpact + response.scrResult.totalAnnualCostImpact
      )
    } catch (e) {
      setServerError(e instanceof Error ? e.message : 'Simulation failed')
    } finally {
      setLoading(false)
    }
  }

  if (!financials) {
    return (
      <div className="flex flex-col items-center justify-center py-20 gap-4">
        <div className="flex items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-5 py-4">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" /><path d="M12 8v4" /><path d="M12 16h.01" />
          </svg>
          <div>
            <p className="text-sm font-medium text-amber-700">Club setup required</p>
            <p className="text-xs text-slate-500 mt-0.5">Before running simulations, please complete your club's financial setup.</p>
          </div>
        </div>
        <Link to="/setup"><Button>Go to Settings</Button></Link>
      </div>
    )
  }

  const errs = form.formState.errors

  return (
    <div>
      <div className="mb-6 flex items-end justify-between">
        <div className="flex items-center gap-3">
          <span className="inline-block w-1.5 h-7 rounded-full bg-violet-600" />
          <div>
            <h1 className="text-[24px] font-bold text-slate-900 tracking-tight leading-none">Simulator</h1>
            <p className="text-[13px] text-slate-500 mt-1.5">Test a proposed transaction against the Squad Cost Ratio rule before you commit.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="meta-label">Season</span>
          <span className="num text-sm text-slate-700">2026/27</span>
        </div>
      </div>

      <div className="grid gap-6" style={{ gridTemplateColumns: '480px 1fr' }}>
        {/* Form */}
        <div className="self-start sticky top-20">
          <Card className="p-6">
            {/* Header */}
            <div className="flex items-center gap-3 mb-5">
              <span className="inline-block w-1 h-5 rounded-full bg-violet-600" />
              <div>
                <h2 className="text-[18px] font-semibold text-slate-900 tracking-tight leading-tight">New Simulation</h2>
                <p className="text-[13px] text-slate-500 mt-0.5">Select transaction type, then enter the terms.</p>
              </div>
            </div>

            {/* Stacked baseline badge */}
            {scrInfluence && simulationCount > 0 && (
              <div className="mb-5 flex items-center gap-2 px-3 py-2 rounded-lg bg-violet-50 border border-violet-200">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#7c3aed" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
                </svg>
                <span className="text-[12px] text-violet-700 font-medium">
                  Baseline: Base + {simulationCount} stacked simulation{simulationCount !== 1 ? 's' : ''}
                </span>
              </div>
            )}

            <form onSubmit={form.handleSubmit(onSubmit)}>
              {/* Transaction type selector */}
              <div className="grid grid-cols-4 gap-1.5 mb-5 p-1 bg-slate-100 rounded-lg">
                {TX_TYPES.map(({ type, label }) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => form.setValue('transactionType', type)}
                    className={`py-2.5 px-1 rounded-md text-center transition-all ${
                      txType === type
                        ? 'bg-white shadow-sm border border-slate-200'
                        : 'hover:bg-white/60'
                    }`}
                  >
                    <span className={`text-[13px] font-semibold ${txType === type ? 'text-violet-700' : 'text-slate-600'}`}>{label}</span>
                  </button>
                ))}
              </div>

              {/* BUY fields */}
              {(txType === 'buy') && (
                <div className="grid grid-cols-2 gap-4">
                  <FieldWrapper label="Transfer Fee" helper="0 for free transfer" error={errs.transferFeePounds?.message}>
                    <PoundInput name="transferFeePounds" control={form.control} max={200_000_000} hasError={!!errs.transferFeePounds} />
                  </FieldWrapper>
                  <ContractLengthField form={form} error={errs.contractLengthYears?.message} label="Contract Length" helper="Years (0.5 steps)" />
                  <FieldWrapper label="Weekly Wage" helper="Annual equivalent shown in results" error={errs.weeklyWagePounds?.message}>
                    <PoundInput name="weeklyWagePounds" control={form.control} max={500_000} hasError={!!errs.weeklyWagePounds} />
                  </FieldWrapper>
                  <FieldWrapper label="Agent Fee (one-off)" helper="Spread across contract years" error={errs.agentFeePounds?.message}>
                    <PoundInput name="agentFeePounds" control={form.control} max={20_000_000} hasError={!!errs.agentFeePounds} />
                  </FieldWrapper>
                </div>
              )}

              {/* SELL fields */}
              {txType === 'sell' && (
                <div className="grid grid-cols-2 gap-4">
                  <FieldWrapper label="Sale Proceeds" error={errs.saleProceedsPounds?.message}>
                    <PoundInput name="saleProceedsPounds" control={form.control} max={200_000_000} hasError={!!errs.saleProceedsPounds} />
                  </FieldWrapper>
                  <FieldWrapper label="Player Book Value" helper="Remaining amortised value" error={errs.playerBookValuePounds?.message}>
                    <PoundInput name="playerBookValuePounds" control={form.control} max={200_000_000} hasError={!!errs.playerBookValuePounds} />
                  </FieldWrapper>
                  <FieldWrapper label="Weekly Wage Released" helper="Player's current weekly wage" error={errs.weeklyWageReleasedPounds?.message}>
                    <PoundInput name="weeklyWageReleasedPounds" control={form.control} max={500_000} hasError={!!errs.weeklyWageReleasedPounds} />
                  </FieldWrapper>
                  <FieldWrapper label="Annual Amortisation Relief" helper="Current annual amort charge" error={errs.annualAmortisationReliefPounds?.message}>
                    <PoundInput name="annualAmortisationReliefPounds" control={form.control} max={50_000_000} hasError={!!errs.annualAmortisationReliefPounds} />
                  </FieldWrapper>
                </div>
              )}

              {/* LOAN IN fields */}
              {txType === 'loan_in' && (
                <div className="grid grid-cols-2 gap-4">
                  <FieldWrapper label="Loan Fee Paid" helper="0 for free loan" error={errs.transferFeePounds?.message}>
                    <PoundInput name="transferFeePounds" control={form.control} max={20_000_000} hasError={!!errs.transferFeePounds} />
                  </FieldWrapper>
                  <ContractLengthField form={form} error={errs.contractLengthYears?.message} label="Loan Duration" helper="Years (0.5 steps)" />
                  <FieldWrapper label="Weekly Wage Contribution" helper="Portion your club covers" error={errs.weeklyWagePounds?.message}>
                    <PoundInput name="weeklyWagePounds" control={form.control} max={500_000} hasError={!!errs.weeklyWagePounds} />
                  </FieldWrapper>
                </div>
              )}

              {/* LOAN OUT fields */}
              {txType === 'loan_out' && (
                <div className="grid grid-cols-2 gap-4">
                  <FieldWrapper label="Loan Fee Received" helper="0 for free loan" error={errs.loanFeeReceivedPounds?.message}>
                    <PoundInput name="loanFeeReceivedPounds" control={form.control} max={20_000_000} hasError={!!errs.loanFeeReceivedPounds} />
                  </FieldWrapper>
                  <FieldWrapper label="Loan Duration" helper="Years (0.5 steps)" error={errs.loanLengthYears?.message}>
                    <div className="relative">
                      <Controller
                        control={form.control}
                        name="loanLengthYears"
                        render={({ field }) => (
                          <input
                            type="number" min={0.5} max={5} step={0.5}
                            value={field.value ?? ''}
                            onChange={(e) => field.onChange(parseFloat(e.target.value))}
                            onBlur={(e) => {
                              const v = parseFloat(e.target.value)
                              if (!isNaN(v)) form.setValue('loanLengthYears', Math.min(5, Math.max(0.5, v)), { shouldValidate: true })
                              field.onBlur()
                            }}
                            ref={field.ref}
                            className={inputCls(!!errs.loanLengthYears, 'pr-14')}
                          />
                        )}
                      />
                      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 select-none pointer-events-none">years</span>
                    </div>
                  </FieldWrapper>
                  <FieldWrapper label="Weekly Wage Covered" helper="Portion paid by borrowing club" error={errs.weeklyWageCoveredPounds?.message}>
                    <PoundInput name="weeklyWageCoveredPounds" control={form.control} max={500_000} hasError={!!errs.weeklyWageCoveredPounds} />
                  </FieldWrapper>
                </div>
              )}

              {/* Label */}
              <div className="mt-5">
                <FieldWrapper label="Scenario Label (optional)">
                  <input
                    type="text"
                    placeholder="e.g. Striker option A — January window"
                    {...form.register('label')}
                    className={inputCls(false)}
                  />
                </FieldWrapper>
              </div>

              {serverError && (
                <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2">
                  <p className="text-xs text-red-600">{serverError}</p>
                </div>
              )}

              <div className="mt-6">
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? (
                    <>
                      <svg className="spin" width="14" height="14" viewBox="0 0 24 24" fill="none">
                        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
                        <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                      </svg>
                      Calculating…
                    </>
                  ) : 'Run Compliance Check'}
                </Button>
              </div>
            </form>

            {simulationId && (
              <p className="mt-3 text-xs text-slate-400 text-center">
                Saved to{' '}
                <Link to={`/history/${simulationId}`} className="text-violet-600 hover:text-violet-700">history</Link>
              </p>
            )}
          </Card>
        </div>

        {/* Results */}
        <div className="min-w-0">
          {result ? <SCRResultPanel result={result} transactionType={resultType} /> : <EmptyResults />}
        </div>
      </div>
    </div>
  )
}

// ─── Payload builder ─────────────────────────────────────────────────────────

function buildPayload(
  data: SimulatorData,
  financials: ClubFinancialsResponse,
  scrInfluence: boolean,
  simulationCount: number,
  totalStackedCostImpact: number
) {
  const baselineSquadCostsPence = scrInfluence && simulationCount > 0
    ? financials.currentSquadCosts + totalStackedCostImpact
    : undefined

  const base = { transactionType: data.transactionType, label: data.label, season: '2026-27', baselineSquadCostsPence }

  if (data.transactionType === 'buy' || data.transactionType === 'loan_in') {
    return {
      ...base,
      transferFee: (data.transferFeePounds ?? 0) * 100,
      contractLengthYears: data.contractLengthYears ?? 1,
      annualWage: weeklyWageToAnnualPence(data.weeklyWagePounds ?? 0),
      agentFee: data.transactionType === 'buy' ? (data.agentFeePounds ?? 0) * 100 : 0,
    }
  }

  if (data.transactionType === 'sell') {
    return {
      ...base,
      transferFee: 0, contractLengthYears: 1, annualWage: 0, agentFee: 0,
      saleProceeds: (data.saleProceedsPounds ?? 0) * 100,
      playerBookValue: (data.playerBookValuePounds ?? 0) * 100,
      annualWageRelief: weeklyWageToAnnualPence(data.weeklyWageReleasedPounds ?? 0),
      annualAmortisationRelief: (data.annualAmortisationReliefPounds ?? 0) * 100,
    }
  }

  // loan_out
  return {
    ...base,
    transferFee: 0, contractLengthYears: 1, annualWage: 0, agentFee: 0,
    loanFeeReceived: (data.loanFeeReceivedPounds ?? 0) * 100,
    loanLengthYears: data.loanLengthYears ?? 1,
    annualWageCovered: weeklyWageToAnnualPence(data.weeklyWageCoveredPounds ?? 0),
  }
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function PoundInput({ name, control, max, hasError }: {
  name: keyof SimulatorData
  control: ReturnType<typeof useForm<SimulatorData>>['control']
  max: number
  hasError: boolean
}) {
  return (
    <div className="relative">
      <span className="num absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 select-none pointer-events-none">£</span>
      <Controller
        control={control}
        name={name}
        render={({ field }) => (
          <NumericInput
            value={(field.value as number) ?? NaN}
            onChange={(n) => field.onChange(isNaN(n) ? undefined : n)}
            onBlur={field.onBlur}
            ref={field.ref}
            max={max}
            className={inputCls(hasError, 'pl-7')}
          />
        )}
      />
    </div>
  )
}

function ContractLengthField({ form, error, label, helper }: {
  form: ReturnType<typeof useForm<SimulatorData>>
  error?: string
  label: string
  helper: string
}) {
  const errs = form.formState.errors
  return (
    <FieldWrapper label={label} helper={helper} error={error}>
      <div className="relative">
        <Controller
          control={form.control}
          name="contractLengthYears"
          render={({ field }) => (
            <input
              type="number" min={0.5} max={10} step={0.5}
              value={field.value ?? ''}
              onChange={(e) => field.onChange(parseFloat(e.target.value))}
              onBlur={(e) => {
                const v = parseFloat(parseFloat(e.target.value).toFixed(2))
                if (!isNaN(v)) form.setValue('contractLengthYears', Math.min(10, Math.max(0.5, v)), { shouldValidate: true })
                field.onBlur()
              }}
              ref={field.ref}
              className={inputCls(!!errs.contractLengthYears, 'pr-14')}
            />
          )}
        />
        <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 select-none pointer-events-none">years</span>
      </div>
    </FieldWrapper>
  )
}

function inputCls(hasError: boolean, extra = '') {
  return `num w-full pl-3 pr-3 py-2.5 text-sm text-slate-900 rounded-lg border bg-white focus:outline-none focus:ring-2 ${
    hasError
      ? 'border-red-300 focus:ring-red-400'
      : 'border-slate-200 focus:ring-violet-500 focus:border-transparent'
  } ${extra}`
}

function FieldWrapper({ label, helper, error, children }: {
  label: string; helper?: string; error?: string; children: React.ReactNode
}) {
  return (
    <label className="block">
      <span className="meta-label block mb-2">{label}</span>
      {children}
      {error ? (
        <span className="block mt-1.5 text-xs text-red-600">{error}</span>
      ) : helper ? (
        <span className="block mt-1.5 text-xs text-slate-400">{helper}</span>
      ) : null}
    </label>
  )
}
