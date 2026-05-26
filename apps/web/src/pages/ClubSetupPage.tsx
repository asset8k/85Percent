import { useState, useEffect } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { api } from '@/lib/api'
import { useClubStore } from '@/stores/club'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { NumericInput } from '@/components/ui/numeric-input'
import { Card } from '@/components/ui/card'
import { StatusBadge } from '@/components/ui/badge'
import { formatPence } from '@headroom/shared'
import { EFL_CHAMPIONSHIP_CONFIG } from '@headroom/shared'
import type { ComplianceStatus } from '@headroom/shared'

const SetupSchema = z.object({
  footballRelatedRevenuePounds: z
    .number({ invalid_type_error: 'Revenue must be a number' })
    .int()
    .positive('Revenue must be positive')
    .max(500_000_000, 'Revenue cannot exceed £500M'),
  currentSquadCostsPounds: z
    .number({ invalid_type_error: 'Squad costs must be a number' })
    .int()
    .min(0, 'Squad costs cannot be negative')
    .max(500_000_000, 'Squad costs cannot exceed £500M'),
  currentAllowanceRatio: z.number({ invalid_type_error: 'Allowance must be a number' }).min(0).max(1),
  ownerEquityUsedCurrentSeasonPounds: z.number({ invalid_type_error: 'Must be a number' }).int().min(0).max(15_000_000, 'EFL limit is £15M per season').optional(),
})
type SetupData = z.infer<typeof SetupSchema>

export function ClubSetupPage() {
  const { financials, setFinancials } = useClubStore()
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  const form = useForm<SetupData>({
    resolver: zodResolver(SetupSchema),
    defaultValues: {
      footballRelatedRevenuePounds: financials
        ? Math.round(financials.footballRelatedRevenue / 100)
        : undefined,
      currentSquadCostsPounds: financials
        ? Math.round(financials.currentSquadCosts / 100)
        : undefined,
      currentAllowanceRatio: financials?.currentAllowanceRatio ?? 0.3,
      ownerEquityUsedCurrentSeasonPounds: financials?.ownerEquityUsed1yr
        ? Math.round(financials.ownerEquityUsed1yr / 100)
        : undefined,
    },
  })

  const watchRevenue = form.watch('footballRelatedRevenuePounds')
  const watchSquad = form.watch('currentSquadCostsPounds')
  const watchAllowance = form.watch('currentAllowanceRatio')
  const watchEquity = form.watch('ownerEquityUsedCurrentSeasonPounds')

  // Live threshold preview
  let greenThreshold: number | null = null
  let redThreshold: number | null = null
  let currentPct: number | null = null
  let scrStatus: ComplianceStatus = 'green'
  let headroom: number | null = null

  if (watchRevenue && watchRevenue > 0 && watchAllowance >= 0) {
    const adjustedRevenuePounds = watchRevenue + (watchEquity ?? 0)
    greenThreshold = Math.floor(adjustedRevenuePounds * 100 * EFL_CHAMPIONSHIP_CONFIG.greenThresholdRatio)
    redThreshold = Math.floor(greenThreshold * (1 + watchAllowance))
    if (watchSquad != null && watchSquad >= 0) {
      const squadPence = watchSquad * 100
      currentPct = (squadPence / (adjustedRevenuePounds * 100)) * 100
      scrStatus = currentPct > (watchAllowance + EFL_CHAMPIONSHIP_CONFIG.greenThresholdRatio) * 100
        ? 'red'
        : currentPct > EFL_CHAMPIONSHIP_CONFIG.greenThresholdRatio * 100
        ? 'amber'
        : 'green'
      headroom = greenThreshold - squadPence
    }
  }

  const onSubmit = async (data: SetupData) => {
    setError('')
    setSaved(false)
    try {
      await api.club.updateFinancials({ season: '2026-27', ...data })
      const updated = await api.club.getFinancials('2026-27')
      setFinancials(updated)
      setSaved(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save club financials')
    }
  }

  const errs = form.formState.errors
  const greenPct = (EFL_CHAMPIONSHIP_CONFIG.greenThresholdRatio * 100).toFixed(0)
  const redPctVal = ((EFL_CHAMPIONSHIP_CONFIG.greenThresholdRatio + watchAllowance) * 100).toFixed(0)

  return (
    <div>
      <div className="mb-6 flex items-center gap-3">
        <span className="inline-block w-1.5 h-7 rounded-full bg-violet-600" />
        <div>
          <h1 className="text-[24px] font-bold text-slate-900 tracking-tight leading-none">Club Financial Settings</h1>
          <p className="text-[13px] text-slate-400 mt-1.5">2026/27 Season</p>
        </div>
      </div>

      <div className="grid gap-6" style={{ gridTemplateColumns: '1fr 360px' }}>
        {/* Main form */}
        <Card className="p-6">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-3">
              <span className="inline-block w-1 h-5 rounded-full bg-violet-600" />
              <h2 className="text-[15px] font-semibold text-slate-900">Season Financials</h2>
            </div>
            <span className="meta-label">2026/27</span>
          </div>
          <p className="text-[13px] text-slate-500 mb-6 pl-4">These figures define the Green and Red Thresholds used in every simulation.</p>

          <form onSubmit={form.handleSubmit(onSubmit)}>
            <div className="grid grid-cols-2 gap-5">
              <FieldWrapper
                label="Football-Related Revenue (£)"
                helper="Broadcast, matchday, commercial — excludes player trading."
                error={errs.footballRelatedRevenuePounds?.message}
              >
                <div className="relative">
                  <span className="num absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 select-none pointer-events-none">£</span>
                  <Controller
                    control={form.control}
                    name="footballRelatedRevenuePounds"
                    render={({ field }) => (
                      <NumericInput
                        value={field.value ?? NaN}
                        onChange={field.onChange}
                        onBlur={field.onBlur}
                        ref={field.ref}
                        max={500_000_000}
                        className={inputCls(!!errs.footballRelatedRevenuePounds, 'pl-7')}
                      />
                    )}
                  />
                </div>
              </FieldWrapper>

              <FieldWrapper
                label="Current Squad Costs (£)"
                helper="Wages + amortisation + agent fees for the current squad."
                error={errs.currentSquadCostsPounds?.message}
              >
                <div className="relative">
                  <span className="num absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 select-none pointer-events-none">£</span>
                  <Controller
                    control={form.control}
                    name="currentSquadCostsPounds"
                    render={({ field }) => (
                      <NumericInput
                        value={field.value ?? NaN}
                        onChange={field.onChange}
                        onBlur={field.onBlur}
                        ref={field.ref}
                        max={500_000_000}
                        className={inputCls(!!errs.currentSquadCostsPounds, 'pl-7')}
                      />
                    )}
                  />
                </div>
              </FieldWrapper>

              <FieldWrapper
                label="Current Allowance"
                helper="Starts at 30% for all clubs. Reduces if you breached 85% last season."
                error={errs.currentAllowanceRatio?.message}
              >
                <Controller
                  control={form.control}
                  name="currentAllowanceRatio"
                  render={({ field }) => (
                    <AllowanceInput
                      value={field.value}
                      onChange={field.onChange}
                      onBlur={field.onBlur}
                      inputRef={field.ref}
                      hasError={!!errs.currentAllowanceRatio}
                    />
                  )}
                />
              </FieldWrapper>

              <FieldWrapper
                label="Owner Equity Top-Up (£)"
                helper="Counts as revenue under EFL SCR rules — increases your Green Threshold. Max £15M/season."
                error={errs.ownerEquityUsedCurrentSeasonPounds?.message}
              >
                <div className="relative">
                  <span className="num absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 select-none pointer-events-none">£</span>
                  <Controller
                    control={form.control}
                    name="ownerEquityUsedCurrentSeasonPounds"
                    render={({ field }) => (
                      <NumericInput
                        value={field.value ?? NaN}
                        onChange={(n) => field.onChange(isNaN(n) ? undefined : n)}
                        onBlur={field.onBlur}
                        ref={field.ref}
                        max={15_000_000}
                        className={inputCls(!!errs.ownerEquityUsedCurrentSeasonPounds, 'pl-7')}
                      />
                    )}
                  />
                </div>
              </FieldWrapper>
            </div>

            <div className="mt-7 pt-6 border-t border-slate-100 flex items-center justify-between">
              <div className="text-[12px] text-slate-400">
                {saved ? (
                  <span className="text-green-700">Settings saved.</span>
                ) : (
                  'Changes preview live in the panel on the right.'
                )}
                {error && <span className="text-red-600 ml-2">{error}</span>}
              </div>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting && <Spinner size={14} />}
                {form.formState.isSubmitting ? 'Saving…' : 'Save Settings'}
              </Button>
            </div>
          </form>
        </Card>

        {/* Live threshold preview panel */}
        <Card className="p-6 self-start sticky top-20 relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-1 bg-violet-600" />
          <h3 className="text-[13px] font-semibold tracking-wider text-violet-700 uppercase mt-1" style={{ letterSpacing: '0.08em' }}>
            Calculated Thresholds
          </h3>
          <p className="text-[12px] text-slate-500 mt-1.5">Updates as you type. Save to apply across the app.</p>

          <div className="mt-6 space-y-5">
            <div>
              <div className="meta-label">Green Threshold ({greenPct}%)</div>
              <div className="num text-[28px] font-semibold text-green-700 leading-none mt-1.5">
                {greenThreshold !== null ? formatPence(greenThreshold) : '—'}
              </div>
              <div className="text-[11px] text-slate-400 mt-1">Maximum squad costs — no levy</div>
            </div>
            <div>
              <div className="meta-label">Red Threshold ({redPctVal}%)</div>
              <div className="num text-[28px] font-semibold text-red-600 leading-none mt-1.5">
                {redThreshold !== null ? formatPence(redThreshold) : '—'}
              </div>
              <div className="text-[11px] text-slate-400 mt-1">Points deduction above this line</div>
            </div>

            {currentPct !== null && (
              <div className="pt-5 border-t border-slate-100">
                <div className="meta-label mb-2">Current SCR Position</div>
                <div className="flex items-baseline gap-3">
                  <span className="num text-[24px] font-medium text-slate-900">{currentPct.toFixed(1)}%</span>
                  <StatusBadge status={scrStatus} />
                </div>
                {headroom !== null && (
                  <div className="mt-3 flex items-center justify-between text-[12px]">
                    <span className="text-slate-500">Headroom to Green</span>
                    <span className={`num font-medium ${headroom < 0 ? 'text-red-600' : 'text-slate-900'}`}>
                      {headroom < 0 ? '−' : '+'}{formatPence(Math.abs(headroom))}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
  )
}

function AllowanceInput({
  value,
  onChange,
  onBlur,
  inputRef,
  hasError,
}: {
  value: number
  onChange: (n: number) => void
  onBlur: () => void
  inputRef: React.Ref<HTMLInputElement>
  hasError: boolean
}) {
  const [display, setDisplay] = useState(() =>
    value != null && !isNaN(value) ? String(Math.round(value * 100)) : ''
  )
  const [focused, setFocused] = useState(false)

  useEffect(() => {
    if (!focused) {
      setDisplay(value != null && !isNaN(value) ? String(Math.round(value * 100)) : '')
    }
  }, [value, focused])

  return (
    <div className="relative">
      <input
        ref={inputRef}
        type="text"
        inputMode="numeric"
        value={display}
        onChange={(e) => {
          const raw = e.target.value.replace(/[^\d]/g, '')
          setDisplay(raw)
          const n = parseInt(raw, 10)
          onChange(isNaN(n) ? NaN : Math.min(100, n) / 100)
        }}
        onFocus={(e) => {
          setFocused(true)
          e.target.select()
        }}
        onBlur={() => {
          setFocused(false)
          const n = parseInt(display, 10)
          if (!isNaN(n)) {
            const clamped = Math.min(100, Math.max(0, n))
            setDisplay(String(clamped))
            onChange(clamped / 100)
          } else {
            setDisplay('')
            onChange(NaN)
          }
          onBlur()
        }}
        className={inputCls(hasError, 'pr-8')}
      />
      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400 select-none pointer-events-none">%</span>
    </div>
  )
}

function inputCls(hasError: boolean, extra = '') {
  return `num w-full pl-3 pr-3 py-2.5 text-sm text-slate-900 rounded-lg border bg-white focus:outline-none focus:ring-2 ${
    hasError
      ? 'border-red-300 focus:ring-red-400'
      : 'border-slate-200 focus:ring-violet-500 focus:border-transparent'
  } ${extra}`
}

function FieldWrapper({
  label,
  helper,
  error,
  children,
}: {
  label: string
  helper?: string
  error?: string
  children: React.ReactNode
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
