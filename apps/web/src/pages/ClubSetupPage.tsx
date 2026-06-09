import { useState, useEffect, useMemo } from 'react'
import { useTranslation, Trans } from 'react-i18next'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { motion, AnimatePresence } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { api } from '@/lib/api'
import { useClubStore } from '@/stores/club'
import { useAuthStore } from '@/stores/auth'
import { supabase } from '@/lib/supabase'
import { useSeasonStore, seasonKey, seasonLabel } from '@/stores/season'
import { SeasonSelector } from '@/components/layout/SeasonSelector'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'
import { FormPageSkeleton } from '@/components/ui/page-skeletons'
import { NumericInput } from '@/components/ui/numeric-input'
import { AnimatedNumber } from '@/components/ui/animated-number'
import { toast } from '@/components/ui/toast'

// Same format helper as the Dashboard — used by AnimatedNumber so intermediate
// frames render as symbol-prefixed integers, not raw decimals. The symbol is
// supplied by the active workspace currency (defaults to £).
function formatPenceNumber(pence: number, symbol = '£') {
  return symbol + Math.round(pence / 100).toLocaleString('en-GB')
}
import { Card } from '@/components/ui/card'
import { StatusBadge } from '@/components/ui/badge'
import { Switch } from '@/components/ui/switch'
import { Select } from '@/components/ui/select'
import { Flag } from '@/components/ui/flag'
import { EFL_CHAMPIONSHIP_CONFIG } from '@85percent/shared'
import { calculatePromotedClubRevenueUplift, PROMOTED_CLUB_DEFAULT_UPLIFT_FACTOR } from '@85percent/engine'
import { cn, formatUsd } from '@/lib/utils'
import { activeLocale } from '@/lib/locale'
import { useScrollLock } from '@/lib/useScrollLock'
import { useCan } from '@/lib/role'
import { useWorkspaceCurrency } from '@/lib/useWorkspaceCurrency'
import { SUPPORTED_LANGUAGES, LANGUAGE_LABELS, LANGUAGE_FLAGS, setLanguage, type Language } from '@/lib/i18n'
import type { TFunction } from 'i18next'
import type { ComplianceStatus, Currency } from '@85percent/shared'
import type { InviteRow, TeamMember, AuditEntry, Permissions } from '@/lib/api'

// Validation messages are built from a translate function so they localize.
function makeSetupSchema(t: TFunction) {
  return z
    .object({
      footballRelatedRevenuePounds: z
        .number({ invalid_type_error: t('settings.validation.revenueNumber') })
        .int()
        .positive(t('settings.validation.revenuePositive'))
        .max(2_000_000_000, t('settings.validation.revenueMax')),
      currentAllowanceRatio: z.number({ invalid_type_error: t('settings.validation.allowanceNumber') }).min(0).max(1),
      ownerEquityUsedCurrentSeasonPounds: z.number({ invalid_type_error: t('settings.validation.mustBeNumber') }).int().min(0).max(15_000_000, t('settings.validation.eflLimit')).optional(),
      squadCostsMode: z.enum(['derived', 'manual']),
      manualSquadCostsPounds: z
        .number({ invalid_type_error: t('settings.validation.squadNumber') })
        .int()
        .min(0)
        .max(2_000_000_000, t('settings.validation.squadMax'))
        .optional(),
    })
    .refine(
      (d) => d.squadCostsMode !== 'manual' || (d.manualSquadCostsPounds != null && d.manualSquadCostsPounds >= 0),
      { message: t('settings.validation.manualOrDerived'), path: ['manualSquadCostsPounds'] },
    )
}
type SetupData = z.infer<ReturnType<typeof makeSetupSchema>>

export function ClubSetupPage() {
  return <SettingsShell />
}

// ---------------------------------------------------------------------------
// FinancialTab — season financial configuration (CFO only). Exported and
// rendered by its own top-level page (FinancialsPage) — it lives in its own
// sidebar entry rather than under Settings, since it's club compliance config
// rather than a personal/workspace setting.
// ---------------------------------------------------------------------------

export function FinancialTab() {
  const { t } = useTranslation()
  const { financials, setFinancials, leagueId } = useClubStore()
  // Roster has financial records once any contract exists — used to gate the
  // currency-change warning (changing currency never converts those records).
  const hasFinancialRecords = (financials?.contractCount ?? 0) > 0
  const { symbol } = useWorkspaceCurrency()
  // Workspace-currency money formatter for the live threshold previews.
  const fmtMoney = (pence: number) => formatPenceNumber(pence, symbol)
  const seasonStartYear = useSeasonStore((s) => s.startYear)
  const activeSeasonKey = seasonKey(seasonStartYear)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  // Promoted-club uplift state (only relevant when on Premier League)
  const [showUplift, setShowUplift] = useState(false)
  const [championshipRevenuePounds, setChampionshipRevenuePounds] = useState(NaN)
  const [upliftFactor, setUpliftFactor] = useState(PROMOTED_CLUB_DEFAULT_UPLIFT_FACTOR)

  const form = useForm<SetupData>({
    resolver: zodResolver(useMemo(() => makeSetupSchema(t), [t])),
    defaultValues: {
      footballRelatedRevenuePounds: financials
        ? Math.round(financials.footballRelatedRevenue / 100)
        : undefined,
      currentAllowanceRatio: financials?.currentAllowanceRatio ?? 0.3,
      ownerEquityUsedCurrentSeasonPounds: financials?.ownerEquityUsed1yr
        ? Math.round(financials.ownerEquityUsed1yr / 100)
        : undefined,
      squadCostsMode: financials?.squadCostsMode ?? 'derived',
      // Seed from the persisted manual value if there is one; falling back to
      // the derived sum gives the user a sensible starting number the first
      // time they flip into manual mode.
      manualSquadCostsPounds:
        financials?.manualSquadCosts != null
          ? Math.round(financials.manualSquadCosts / 100)
          : financials
          ? Math.round(financials.derivedSquadCosts / 100)
          : undefined,
    },
  })

  const watchRevenue = form.watch('footballRelatedRevenuePounds')
  const watchAllowance = form.watch('currentAllowanceRatio')
  const watchEquity = form.watch('ownerEquityUsedCurrentSeasonPounds')
  const watchMode = form.watch('squadCostsMode')
  const watchManualSquad = form.watch('manualSquadCostsPounds')

  // The roster-derived sum is always shown so the user can sanity-check what
  // they're overriding when in manual mode. The "effective" value is whichever
  // mode is active and feeds the SCR preview below.
  const derivedSquadCostsPounds = financials
    ? Math.round(financials.derivedSquadCosts / 100)
    : null
  const effectiveSquadCostsPounds =
    watchMode === 'manual'
      ? Number.isFinite(watchManualSquad) ? (watchManualSquad as number) : null
      : derivedSquadCostsPounds

  // Live threshold preview
  let greenThreshold: number | null = null
  let redThreshold: number | null = null
  let currentPct: number | null = null
  let scrStatus: ComplianceStatus = 'green'
  let headroom: number | null = null

  if (watchRevenue && watchRevenue > 0 && watchAllowance >= 0) {
    const adjustedRevenuePounds = watchRevenue + (watchEquity ?? 0)
    const greenRatio = EFL_CHAMPIONSHIP_CONFIG.greenThresholdRatio
    greenThreshold = Math.floor(adjustedRevenuePounds * 100 * greenRatio)
    // Additive: Red = revenue × (green% + allowance%). 30% allowance → 115% of revenue.
    redThreshold = Math.floor(adjustedRevenuePounds * 100 * (greenRatio + watchAllowance))
    if (effectiveSquadCostsPounds != null && effectiveSquadCostsPounds >= 0) {
      const squadPence = effectiveSquadCostsPounds * 100
      currentPct = (squadPence / (adjustedRevenuePounds * 100)) * 100
      scrStatus = currentPct > (greenRatio + watchAllowance) * 100
        ? 'red'
        : currentPct > greenRatio * 100
        ? 'amber'
        : 'green'
      headroom = greenThreshold - squadPence
    }
  }

  const onSubmit = async (data: SetupData) => {
    setError('')
    setSaved(false)
    try {
      await api.club.updateFinancials({ season: activeSeasonKey, ...data })
      const updated = await api.club.getFinancials(activeSeasonKey)
      setFinancials(updated)
      setSaved(true)
      toast.success(t('settings.fin.savedToastTitle'), t('settings.fin.savedToastBody'))
    } catch (e) {
      const msg = e instanceof Error ? e.message : t('settings.fin.failSave')
      setError(msg)
      toast.error(t('settings.fin.saveFailed'), msg)
    }
  }

  const upliftPence = calculatePromotedClubRevenueUplift(
    Number.isFinite(championshipRevenuePounds) ? championshipRevenuePounds * 100 : 0,
    upliftFactor,
  )

  const applyUplift = () => {
    if (upliftPence <= 0) return
    form.setValue('footballRelatedRevenuePounds', Math.round(upliftPence / 100), { shouldDirty: true })
    setShowUplift(false)
  }

  const errs = form.formState.errors
  const greenPct = (EFL_CHAMPIONSHIP_CONFIG.greenThresholdRatio * 100).toFixed(0)
  const redPctVal = ((EFL_CHAMPIONSHIP_CONFIG.greenThresholdRatio + watchAllowance) * 100).toFixed(0)

  return (
    <>
      {/* League (read-only — determined by the club you selected during onboarding) */}
      <Card className="p-6 mb-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <span className="inline-block w-1 h-5 rounded-full bg-violet-600" />
              <h2 className="text-[15px] font-semibold text-slate-900">{t('settings.fin.leagueTitle')}</h2>
            </div>
            <p className="text-[13px] text-slate-500 pl-4 max-w-xl">
              {t('settings.fin.leagueBody')}
            </p>
          </div>
          <span className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg bg-violet-50 text-violet-700 text-[13px] font-semibold ring-1 ring-violet-200/60 whitespace-nowrap">
            {leagueId === 'premier-league' ? t('chrome.leaguePremier') : t('chrome.leagueChampionship')}
          </span>
        </div>

        {/* Promoted-club uplift — only when on PL */}
        {leagueId === 'premier-league' && (
          <div className="mt-5 pt-5 border-t border-slate-100">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <span className="mt-0.5 inline-flex h-7 w-7 items-center justify-center rounded-md bg-violet-100 text-violet-600 flex-shrink-0">
                  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M7 17L17 7" />
                    <path d="M8 7h9v9" />
                  </svg>
                </span>
                <div>
                  <div className="text-[13px] font-semibold text-slate-900">{t('settings.fin.promotedTitle')}</div>
                  <p className="text-[12px] text-slate-500 mt-0.5 max-w-md">
                    {t('settings.fin.promotedBody')}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowUplift((v) => !v)}
                className="text-[12px] font-medium text-violet-600 hover:text-violet-700 flex-shrink-0 whitespace-nowrap"
              >
                {showUplift ? t('settings.fin.hideEstimator') : t('settings.fin.useEstimator')}
              </button>
            </div>

            <AnimatePresence initial={false}>
              {showUplift && (
                <motion.div
                  key="uplift"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                  className="overflow-hidden"
                >
                  <div className="mt-4 rounded-xl border border-violet-200/60 bg-gradient-to-br from-violet-50/60 via-white to-violet-50/30 p-5">
                    <div className="grid items-end gap-3" style={{ gridTemplateColumns: '1fr auto 1fr auto 1.2fr' }}>
                      <label className="block">
                        <span className="meta-label block mb-1.5">{t('settings.fin.championshipRevenue')}</span>
                        <div className="relative">
                          <span className="num absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 select-none pointer-events-none">{symbol}</span>
                          <NumericInput
                            value={championshipRevenuePounds}
                            onChange={setChampionshipRevenuePounds}
                            className="w-full pl-7 pr-3 py-2.5 text-[14px] rounded-lg border border-slate-200 bg-white num focus:outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-200"
                          />
                        </div>
                      </label>

                      <div className="self-end pb-3 text-slate-300 text-[20px] font-light leading-none select-none">×</div>

                      <label className="block">
                        <span className="meta-label block mb-1.5">{t('settings.fin.upliftFactor')}</span>
                        <div className="relative">
                          <input
                            type="number"
                            step="0.1"
                            min="1"
                            max="10"
                            value={upliftFactor}
                            onChange={(e) => setUpliftFactor(parseFloat(e.target.value) || PROMOTED_CLUB_DEFAULT_UPLIFT_FACTOR)}
                            className="w-full pl-3 pr-7 py-2.5 text-[14px] rounded-lg border border-slate-200 bg-white num focus:outline-none focus:border-violet-500 focus:ring-2 focus:ring-violet-200"
                          />
                          <span className="num absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 select-none pointer-events-none">×</span>
                        </div>
                      </label>

                      <div className="self-end pb-3 text-violet-400">
                        <svg width={20} height={20} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M5 12h14" />
                          <path d="M13 6l6 6-6 6" />
                        </svg>
                      </div>

                      <div className="rounded-lg bg-white border border-violet-200/70 px-4 py-2.5 shadow-sm">
                        <div className="meta-label">{t('settings.fin.estimatedPlRevenue')}</div>
                        <div className="num text-[20px] font-semibold text-slate-900 leading-none mt-1.5 tabular-nums">
                          {upliftPence > 0 ? (
                            <AnimatedNumber value={upliftPence} format={fmtMoney} duration={0.45} />
                          ) : (
                            '—'
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 flex items-center justify-between gap-3">
                      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-violet-100/80 text-violet-700 text-[11px] font-medium">
                        <svg width={11} height={11} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M7 17L17 7" />
                          <path d="M8 7h9v9" />
                        </svg>
                        {t('settings.fin.revenueJump', { factor: upliftFactor.toFixed(1) })}
                      </span>
                      <Button
                        type="button"
                        onClick={applyUplift}
                        disabled={upliftPence <= 0}
                        size="sm"
                      >
                        {t('settings.fin.applyToRevenue')}
                      </Button>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}
      </Card>

      {/* Base workspace currency (CFO) — sets the symbol every financial figure
          is displayed with. No conversion of existing records. */}
      <BaseCurrencyCard hasFinancialRecords={hasFinancialRecords} />

      <div className="grid gap-6" style={{ gridTemplateColumns: '1fr 360px' }}>
        {/* Main form */}
        <Card className="p-6">
          <div className="flex items-center justify-between mb-1">
            <div className="flex items-center gap-3">
              <span className="inline-block w-1 h-5 rounded-full bg-violet-600" />
              <h2 className="text-[15px] font-semibold text-slate-900">{t('settings.fin.seasonFinancials')}</h2>
            </div>
            <span className="meta-label">{seasonLabel(seasonStartYear)}</span>
          </div>
          <p className="text-[13px] text-slate-500 mb-6 pl-4">{t('settings.fin.seasonFinancialsSub')}</p>

          <form onSubmit={form.handleSubmit(onSubmit)}>
            <div className="grid grid-cols-2 gap-5">
              <FieldWrapper
                label={t('settings.fin.footballRevenue', { symbol })}
                helper={t('settings.fin.footballRevenueHelper')}
                error={errs.footballRelatedRevenuePounds?.message}
              >
                <div className="relative">
                  <span className="num absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 select-none pointer-events-none">{symbol}</span>
                  <Controller
                    control={form.control}
                    name="footballRelatedRevenuePounds"
                    render={({ field }) => (
                      <NumericInput
                        value={field.value ?? NaN}
                        onChange={field.onChange}
                        onBlur={field.onBlur}
                        ref={field.ref}
                        max={2_000_000_000}
                        className={inputCls(!!errs.footballRelatedRevenuePounds, 'pl-7')}
                      />
                    )}
                  />
                </div>
              </FieldWrapper>

              <FieldWrapper
                label={t('settings.fin.squadCosts')}
                helper={
                  watchMode === 'manual'
                    ? t('settings.fin.squadCostsManualHelper')
                    : t('settings.fin.squadCostsDerivedHelper')
                }
                error={errs.manualSquadCostsPounds?.message}
              >
                <div className="space-y-2">
                  <Controller
                    control={form.control}
                    name="squadCostsMode"
                    render={({ field }) => (
                      <SquadCostsModeToggle value={field.value} onChange={field.onChange} />
                    )}
                  />
                  {watchMode === 'manual' ? (
                    <div className="relative">
                      <span className="num absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 select-none pointer-events-none">{symbol}</span>
                      <Controller
                        control={form.control}
                        name="manualSquadCostsPounds"
                        render={({ field }) => (
                          <NumericInput
                            value={field.value ?? NaN}
                            onChange={(n) => field.onChange(isNaN(n) ? undefined : n)}
                            onBlur={field.onBlur}
                            ref={field.ref}
                            max={2_000_000_000}
                            className={inputCls(!!errs.manualSquadCostsPounds, 'pl-7')}
                          />
                        )}
                      />
                    </div>
                  ) : (
                    <div className="relative">
                      <span className="num absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 select-none pointer-events-none">{symbol}</span>
                      <input
                        type="text"
                        value={derivedSquadCostsPounds != null ? derivedSquadCostsPounds.toLocaleString('en-GB') : '—'}
                        disabled
                        className={inputCls(false, 'pl-7') + ' text-slate-500 bg-slate-50 cursor-not-allowed'}
                      />
                    </div>
                  )}
                </div>
              </FieldWrapper>

              <FieldWrapper
                label={t('settings.fin.currentAllowance')}
                helper={t('settings.fin.currentAllowanceHelper')}
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

              {/* Owner equity top-up — Championship only. PL clubs do not have this allowance. */}
              {leagueId !== 'premier-league' && (
                <FieldWrapper
                  label={t('settings.fin.ownerEquity', { symbol })}
                  helper={t('settings.fin.ownerEquityHelper')}
                  error={errs.ownerEquityUsedCurrentSeasonPounds?.message}
                >
                  <div className="relative">
                    <span className="num absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 select-none pointer-events-none">{symbol}</span>
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
              )}
            </div>

            <div className="mt-7 pt-6 border-t border-slate-100 flex items-center justify-between">
              <div className="text-[12px] text-slate-400">
                {saved ? (
                  <span className="text-green-700">{t('settings.fin.savedShort')}</span>
                ) : (
                  t('settings.fin.previewHint')
                )}
                {error && <span className="text-red-600 ml-2">{error}</span>}
              </div>
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting && <Spinner size={14} />}
                {form.formState.isSubmitting ? t('common.saving') : t('settings.fin.saveSettings')}
              </Button>
            </div>
          </form>
        </Card>

        {/* Live threshold preview panel — aligns to the top of the shared grid
            row in both leagues. Previously sticky/top-20, which interacted
            badly with grid `self-start` once the page got tall in PL mode
            (the Promoted-club uplift block above adds height) and shifted the
            card down out of alignment with Season Financials. */}
        <Card className="p-6 self-start relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-1 bg-violet-600" />
          <h3 className="text-[13px] font-semibold tracking-wider text-violet-700 uppercase mt-1" style={{ letterSpacing: '0.08em' }}>
            {t('settings.fin.calculatedThresholds')}
          </h3>
          <p className="text-[12px] text-slate-500 mt-1.5">{t('settings.fin.calculatedThresholdsSub')}</p>

          <div className="mt-6 space-y-5">
            <div>
              <div className="meta-label">{t('settings.fin.greenThreshold', { pct: greenPct })}</div>
              <div className="mt-1.5">
                {greenThreshold !== null ? (
                  <AnimatedNumber
                    value={greenThreshold}
                    format={fmtMoney}
                    className="num text-[28px] font-semibold text-green-700 leading-none"
                  />
                ) : (
                  <span className="num text-[28px] font-semibold text-green-700 leading-none">—</span>
                )}
              </div>
              <div className="text-[11px] text-slate-400 mt-1">{t('settings.fin.greenThresholdSub')}</div>
            </div>
            <div>
              <div className="meta-label">{t('settings.fin.redThreshold', { pct: redPctVal })}</div>
              <div className="mt-1.5">
                {redThreshold !== null ? (
                  <AnimatedNumber
                    value={redThreshold}
                    format={fmtMoney}
                    className="num text-[28px] font-semibold text-red-600 leading-none"
                  />
                ) : (
                  <span className="num text-[28px] font-semibold text-red-600 leading-none">—</span>
                )}
              </div>
              <div className="text-[11px] text-slate-400 mt-1">{t('settings.fin.redThresholdSub')}</div>
            </div>

            {currentPct !== null && (
              <div className="pt-5 border-t border-slate-100">
                <div className="meta-label mb-2">{t('settings.fin.currentScrPosition')}</div>
                <div className="flex items-baseline gap-3">
                  <AnimatedNumber
                    value={currentPct}
                    decimals={1}
                    suffix="%"
                    className="num text-[24px] font-medium text-slate-900"
                  />
                  <StatusBadge status={scrStatus} />
                </div>
                {headroom !== null && (
                  <div className="mt-3 flex items-center justify-between text-[12px]">
                    <span className="text-slate-500">{t('settings.fin.headroomToGreen')}</span>
                    <AnimatedNumber
                      value={headroom}
                      format={(n) => (n < 0 ? '−' + fmtMoney(Math.abs(n)) : '+' + fmtMoney(n))}
                      className={`num font-medium ${headroom < 0 ? 'text-red-600' : 'text-slate-900'}`}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        </Card>
      </div>
    </>
  )
}

// ---------------------------------------------------------------------------
// BaseCurrencyCard — CFO-only control for the workspace base currency. Every
// monetary figure across the app is displayed in this currency. Changing it
// NEVER converts existing records — the same numbers are simply re-labelled —
// so we warn the user when a roster already has financial records.
// ---------------------------------------------------------------------------

const CURRENCY_OPTIONS: { value: Currency; symbol: string; labelKey: string }[] = [
  { value: 'GBP', symbol: '£', labelKey: 'settings.currency.gbp' },
  { value: 'EUR', symbol: '€', labelKey: 'settings.currency.eur' },
  { value: 'USD', symbol: '$', labelKey: 'settings.currency.usd' },
]

function BaseCurrencyCard({ hasFinancialRecords }: { hasFinancialRecords: boolean }) {
  const { t } = useTranslation()
  const can = useCan()
  const isCfo = can.isWorkspaceAdmin
  const baseCurrency = useClubStore((s) => s.baseCurrency)
  const setBaseCurrency = useClubStore((s) => s.setBaseCurrency)

  const [selected, setSelected] = useState<Currency>(baseCurrency)
  const [saving, setSaving] = useState(false)

  // Keep the dropdown in sync if the store currency changes elsewhere.
  useEffect(() => {
    setSelected(baseCurrency)
  }, [baseCurrency])

  const dirty = selected !== baseCurrency
  // The warning only matters when an actual change is pending against an
  // already-populated roster — exactly the case the directive calls out.
  const showWarning = dirty && hasFinancialRecords

  const save = async () => {
    if (!dirty) return
    setSaving(true)
    try {
      const res = await api.club.setCurrency(selected)
      setBaseCurrency(res.baseCurrency)
      toast.success(t('settings.currency.updatedTitle'), t('settings.currency.updatedBody', { currency: res.baseCurrency }))
    } catch (e) {
      const msg = e instanceof Error ? e.message : t('settings.currency.failUpdate')
      toast.error(t('settings.currency.updateFailed'), msg)
      setSelected(baseCurrency)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card className="p-6 mb-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <span className="inline-block w-1 h-5 rounded-full bg-violet-600" />
            <h2 className="text-[15px] font-semibold text-slate-900">{t('settings.currency.title')}</h2>
          </div>
          <p className="text-[13px] text-slate-500 pl-4 max-w-xl">
            {t('settings.currency.body')}
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Select<Currency>
            value={selected}
            onChange={(v) => setSelected(v)}
            disabled={!isCfo || saving}
            ariaLabel={t('settings.currency.aria')}
            className="w-[240px]"
            options={CURRENCY_OPTIONS.map((o) => ({
              value: o.value,
              label: t(o.labelKey),
              leading: <span className="num w-4 text-center text-slate-500 flex-shrink-0">{o.symbol}</span>,
            }))}
          />
          {isCfo && (
            <Button type="button" onClick={save} disabled={!dirty || saving}>
              {saving && <Spinner size={14} />}
              {saving ? t('common.saving') : t('common.save')}
            </Button>
          )}
        </div>
      </div>

      {showWarning && (
        <div className="mt-4 ml-4 flex items-start gap-2.5 border border-amber-200 bg-amber-50 rounded-lg px-4 py-3">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-amber-500 mt-0.5 flex-shrink-0"
            aria-hidden="true"
          >
            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
            <path d="M12 9v4" />
            <path d="M12 17h.01" />
          </svg>
          <p className="text-[13px] text-amber-800 leading-relaxed">
            <Trans i18nKey="settings.currency.warning" components={{ b: <span className="font-semibold" /> }} />
          </p>
        </div>
      )}
    </Card>
  )
}

// ---------------------------------------------------------------------------
// SettingsShell — page header + tab nav. Hosts the Settings tabs:
//   Profile & Security (all users) · Team & Access (admin) · Financial (admin) ·
//   Activity Log (admin) · Danger Zone (admin).
// The admin-only tabs are both hidden from the nav AND guarded server-side by
// requirePermission('isWorkspaceAdmin'); the predicates here only drive UI.
// ---------------------------------------------------------------------------

type SettingsTab = 'profile' | 'team' | 'activity' | 'danger'

function SettingsShell() {
  const { t } = useTranslation()
  const can = useCan()
  const isCfo = can.isWorkspaceAdmin

  const [tab, setTab] = useState<SettingsTab>(() => {
    const h = window.location.hash.replace('#', '') as SettingsTab
    return (['profile', 'team', 'activity', 'danger'] as const).includes(h) ? h : 'profile'
  })

  useEffect(() => {
    window.location.hash = tab === 'profile' ? '' : tab
  }, [tab])

  // If a non-CFO somehow lands on a CFO-only tab (e.g. a stale hash), fall back
  // to the profile tab they're always allowed to see.
  useEffect(() => {
    if (!isCfo && tab !== 'profile') setTab('profile')
  }, [isCfo, tab])

  return (
    <div>
      <div className="mb-6 flex items-center gap-3">
        <span className="inline-block w-1.5 h-7 rounded-full bg-violet-600" />
        <div>
          <h1 className="text-[24px] font-bold text-slate-900 tracking-tight leading-none">{t('settings.shell.title')}</h1>
          <p className="text-[13px] text-slate-400 mt-1.5">{t('settings.shell.subtitle')}</p>
        </div>
      </div>

      <div className="flex items-center gap-6 border-b border-slate-200 mb-5">
        <TabButton active={tab === 'profile'} onClick={() => setTab('profile')}>{t('settings.shell.tabProfile')}</TabButton>
        {isCfo && <TabButton active={tab === 'team'} onClick={() => setTab('team')}>{t('settings.shell.tabTeam')}</TabButton>}
        {isCfo && <TabButton active={tab === 'activity'} onClick={() => setTab('activity')}>{t('settings.shell.tabActivity')}</TabButton>}
        {isCfo && <TabButton active={tab === 'danger'} onClick={() => setTab('danger')}>{t('settings.shell.tabDanger')}</TabButton>}
      </div>

      {tab === 'profile'   && <ProfileSecurityTab />}
      {tab === 'team'      && isCfo && <TeamTab />}
      {tab === 'activity'  && isCfo && <ActivityTab />}
      {tab === 'danger'    && isCfo && <DangerZoneTab />}
    </div>
  )
}

// Shared password policy check — mirrors the backend PasswordSchema. Returns
// the first unmet requirement, or null when the password is strong enough.
function passwordIssue(pw: string, t: TFunction): string | null {
  if (pw.length < 8) return t('auth.reset.issue.min8')
  if (!/[A-Z]/.test(pw)) return t('auth.reset.issue.upper')
  if (!/[a-z]/.test(pw)) return t('auth.reset.issue.lower')
  if (!/[0-9]/.test(pw)) return t('auth.reset.issue.number')
  if (!/[^A-Za-z0-9]/.test(pw)) return t('auth.reset.issue.special')
  return null
}

// ---------------------------------------------------------------------------
// ProfileSecurityTab — available to every authenticated user. Edit display
// name + email, change password, and manage the Authenticator App (TOTP).
// ---------------------------------------------------------------------------

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-5">
      <div className="flex items-center gap-3">
        <span className="inline-block w-1 h-5 rounded-full bg-violet-600" />
        <h2 className="text-[15px] font-semibold text-slate-900">{title}</h2>
      </div>
      {subtitle && <p className="text-[13px] text-slate-500 mt-1 pl-4 max-w-xl">{subtitle}</p>}
    </div>
  )
}

// InterfaceLanguageCard — lets the user pick the UI language (English, Español,
// Français, Italiano). The choice drives i18next and is persisted to
// localStorage by setLanguage(), so it survives reloads. This affects menus,
// buttons, and labels only — monetary data stays in the workspace currency.
function InterfaceLanguageCard() {
  const { t, i18n } = useTranslation()
  const current = (SUPPORTED_LANGUAGES as readonly string[]).includes(i18n.language)
    ? (i18n.language as Language)
    : 'en'

  return (
    <Card className="p-6">
      <SectionHeader title={t('settings.interfaceLanguage')} subtitle={t('settings.interfaceLanguageHint')} />
      <Select<Language>
        value={current}
        onChange={(lng) => setLanguage(lng)}
        ariaLabel={t('settings.interfaceLanguage')}
        className="w-[260px]"
        options={SUPPORTED_LANGUAGES.map((lng) => ({
          value: lng,
          label: LANGUAGE_LABELS[lng],
          leading: <Flag code={LANGUAGE_FLAGS[lng]} title={LANGUAGE_LABELS[lng]} width={20} />,
        }))}
      />
    </Card>
  )
}

function ProfileSecurityTab() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)

  // Profile fields
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [savingProfile, setSavingProfile] = useState(false)
  const [profileErr, setProfileErr] = useState('')

  // AI credit balance (USD) — null until /me resolves so the card can show a
  // loading state rather than a misleading "$0.00".
  const [aiBalanceUsd, setAiBalanceUsd] = useState<number | null>(null)

  // Password fields
  const [currentPw, setCurrentPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [confirmPw, setConfirmPw] = useState('')
  const [savingPw, setSavingPw] = useState(false)
  const [pwErr, setPwErr] = useState('')

  // TOTP state
  const [totpEnabled, setTotpEnabled] = useState(false)
  const [setupData, setSetupData] = useState<{ qrDataUrl: string; secret: string } | null>(null)
  const [totpCode, setTotpCode] = useState('')
  const [totpBusy, setTotpBusy] = useState(false)
  const [totpErr, setTotpErr] = useState('')
  const [disarming, setDisarming] = useState(false)
  const [disableCode, setDisableCode] = useState('')

  useEffect(() => {
    api.me.get()
      .then((me) => {
        const parts = me.fullName.trim().split(/\s+/)
        setFirstName(parts[0] ?? '')
        setLastName(parts.slice(1).join(' '))
        setEmail(me.email)
        setTotpEnabled(me.isTotpEnabled)
        setAiBalanceUsd(me.aiBalanceUsd)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const saveProfile = async (e: React.FormEvent) => {
    e.preventDefault()
    setProfileErr('')
    const fullName = `${firstName.trim()} ${lastName.trim()}`.trim()
    if (!fullName) { setProfileErr(t('settings.profile.nameEmpty')); return }
    setSavingProfile(true)
    try {
      await api.me.update({ fullName, email: email.trim() })
      toast.success(t('settings.profile.updatedTitle'), t('settings.profile.updatedBody'))
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('settings.profile.failUpdate')
      setProfileErr(msg)
      toast.error(t('settings.profile.updateFailed'), msg)
    } finally {
      setSavingProfile(false)
    }
  }

  const changePassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setPwErr('')
    const issue = passwordIssue(newPw, t)
    if (issue) { setPwErr(t('settings.profile.newPasswordIssue', { issue: issue.toLowerCase() })); return }
    if (newPw !== confirmPw) { setPwErr(t('settings.profile.passwordsNoMatch')); return }
    setSavingPw(true)
    try {
      await api.auth.changePassword(currentPw, newPw)
      // The server changes the password via the admin API, which revokes the
      // user's existing refresh tokens — our current session's token would fail
      // on its next refresh and silently 401 the whole app. Immediately mint a
      // fresh session with the new password so the user stays signed in with a
      // valid token (no forced re-login). onAuthStateChange picks up the new
      // session and updates the auth store.
      const { error: reauthErr } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password: newPw,
      })
      setCurrentPw(''); setNewPw(''); setConfirmPw('')
      if (reauthErr) {
        // Couldn't silently re-auth (e.g. transient network) — send them to a
        // clean sign-in rather than leaving a stale token behind.
        toast.success(t('settings.profile.changedTitle'), t('settings.profile.changedReauth'))
        await useAuthStore.getState().signOut()
        navigate('/login')
        return
      }
      toast.success(t('settings.profile.changedTitle'), t('settings.profile.changedActive'))
    } catch (err) {
      const msg = err instanceof Error ? err.message : t('settings.profile.failChangePw')
      setPwErr(msg)
    } finally {
      setSavingPw(false)
    }
  }

  const startTotpSetup = async () => {
    setTotpErr('')
    setTotpBusy(true)
    try {
      const d = await api.auth.totpSetup()
      setSetupData({ qrDataUrl: d.qrDataUrl, secret: d.secret })
      setTotpCode('')
    } catch (err) {
      setTotpErr(err instanceof Error ? err.message : t('settings.profile.totpFailStart'))
    } finally {
      setTotpBusy(false)
    }
  }

  const verifyTotp = async (e: React.FormEvent) => {
    e.preventDefault()
    setTotpErr('')
    setTotpBusy(true)
    try {
      await api.auth.totpVerify(totpCode)
      setTotpEnabled(true)
      setSetupData(null)
      setTotpCode('')
      toast.success(t('settings.profile.totpEnabledTitle'), t('settings.profile.totpEnabledBody'))
    } catch (err) {
      setTotpErr(err instanceof Error ? err.message : t('settings.profile.totpInvalidCode'))
    } finally {
      setTotpBusy(false)
    }
  }

  const disableTotp = async (e: React.FormEvent) => {
    e.preventDefault()
    setTotpErr('')
    setTotpBusy(true)
    try {
      await api.auth.totpDisable(disableCode)
      setTotpEnabled(false)
      setDisarming(false)
      setDisableCode('')
      toast.success(t('settings.profile.totpDisabledTitle'), t('settings.profile.totpDisabledBody'))
    } catch (err) {
      setTotpErr(err instanceof Error ? err.message : t('settings.profile.totpInvalidCode'))
    } finally {
      setTotpBusy(false)
    }
  }

  if (loading) return <FormPageSkeleton />

  return (
    <div className="space-y-5 max-w-3xl">
      {/* Active season */}
      <Card className="p-6">
        <SectionHeader
          title={t('settings.profile.activeSeason')}
          subtitle={t('settings.profile.activeSeasonSub')}
        />
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-[14px] text-slate-900 font-medium">{t('settings.profile.planningSeason')}</div>
            <div className="text-[12.5px] text-slate-500 mt-0.5">{t('settings.profile.planningSeasonSub')}</div>
          </div>
          <SeasonSelector />
        </div>
      </Card>

      {/* Profile */}
      <Card className="p-6">
        <SectionHeader title={t('settings.profile.title')} subtitle={t('settings.profile.sub')} />
        <form onSubmit={saveProfile}>
          <div className="grid grid-cols-2 gap-5">
            <label className="block">
              <span className="meta-label block mb-2">{t('settings.profile.firstName')}</span>
              <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="Jane" />
            </label>
            <label className="block">
              <span className="meta-label block mb-2">{t('settings.profile.lastName')}</span>
              <Input value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Doe" />
            </label>
            <label className="block col-span-2">
              <span className="meta-label block mb-2">{t('settings.profile.email')}</span>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@club.com" />
            </label>
          </div>
          <div className="mt-6 pt-5 border-t border-slate-100 flex items-center justify-between">
            <span className="text-[12px] text-red-600">{profileErr}</span>
            <Button type="submit" disabled={savingProfile}>
              {savingProfile && <Spinner size={14} />}
              {savingProfile ? t('common.saving') : t('settings.profile.saveProfile')}
            </Button>
          </div>
        </form>
      </Card>

      {/* Interface language */}
      <InterfaceLanguageCard />

      {/* AI usage — prepaid Compliance Analyst credit balance */}
      <Card className="p-6">
        <SectionHeader
          title={t('settings.profile.aiTitle')}
          subtitle={t('settings.profile.aiSub')}
        />
        <div className="flex items-end justify-between gap-4 flex-wrap">
          <div>
            <div className="meta-label">{t('settings.profile.currentBalance')}</div>
            {aiBalanceUsd === null ? (
              <div className="mt-2 h-8 w-28 rounded-md bg-slate-100 animate-pulse" />
            ) : (
              <div
                className={cn(
                  'num text-[28px] font-semibold leading-none mt-2',
                  aiBalanceUsd <= 0.01 ? 'text-red-600' : 'text-slate-900',
                )}
              >
                {formatUsd(aiBalanceUsd)}
              </div>
            )}
            <p className="text-[12px] text-slate-400 mt-2">
              {t('settings.profile.topUpHint')}
            </p>
          </div>
          {aiBalanceUsd !== null && aiBalanceUsd <= 0.01 && (
            <StatusBadge status="red">{t('settings.profile.depleted')}</StatusBadge>
          )}
        </div>
      </Card>

      {/* Change password */}
      <Card className="p-6">
        <SectionHeader title={t('settings.profile.passwordTitle')} subtitle={t('settings.profile.passwordSub')} />
        <form onSubmit={changePassword}>
          <div className="grid grid-cols-2 gap-5">
            <label className="block col-span-2">
              <span className="meta-label block mb-2">{t('settings.profile.currentPassword')}</span>
              <Input type="password" value={currentPw} onChange={(e) => setCurrentPw(e.target.value)} placeholder="••••••••" autoComplete="current-password" />
            </label>
            <label className="block">
              <span className="meta-label block mb-2">{t('settings.profile.newPasswordLabel')}</span>
              <Input type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} placeholder="••••••••" autoComplete="new-password" />
            </label>
            <label className="block">
              <span className="meta-label block mb-2">{t('settings.profile.confirmNewPassword')}</span>
              <Input type="password" value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} placeholder="••••••••" autoComplete="new-password" />
            </label>
          </div>
          <div className="mt-6 pt-5 border-t border-slate-100 flex items-center justify-between">
            <span className="text-[12px] text-red-600">{pwErr}</span>
            <Button type="submit" disabled={savingPw || !currentPw || !newPw || !confirmPw}>
              {savingPw && <Spinner size={14} />}
              {savingPw ? t('settings.profile.updating') : t('settings.profile.changePassword')}
            </Button>
          </div>
        </form>
      </Card>

      {/* Two-factor authentication */}
      <Card className="p-6">
        <SectionHeader
          title={t('settings.profile.twoFactorTitle')}
          subtitle={t('settings.profile.twoFactorSub')}
        />

        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <span
              className={cn(
                'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[12px] font-medium',
                totpEnabled ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-600',
              )}
            >
              <span className={cn('w-1.5 h-1.5 rounded-full', totpEnabled ? 'bg-green-600' : 'bg-slate-400')} />
              {totpEnabled ? t('settings.profile.enabled') : t('settings.profile.notEnabled')}
            </span>
          </div>

          {!totpEnabled && !setupData && (
            <Button type="button" onClick={startTotpSetup} disabled={totpBusy}>
              {totpBusy && <Spinner size={14} />}
              {t('settings.profile.setupAuthenticator')}
            </Button>
          )}
          {totpEnabled && !disarming && (
            <Button type="button" variant="secondary" onClick={() => { setDisarming(true); setTotpErr('') }}>
              {t('settings.profile.turnOff')}
            </Button>
          )}
        </div>

        {/* Setup: QR + verify */}
        {setupData && (
          <div className="mt-5 pt-5 border-t border-slate-100">
            <div className="flex flex-col sm:flex-row gap-6">
              <div className="flex-shrink-0">
                <img src={setupData.qrDataUrl} alt={t('settings.profile.qrAlt')} width={176} height={176} className="rounded-lg border border-slate-200" />
              </div>
              <div className="flex-1">
                <p className="text-[13px] text-slate-700 font-medium mb-1">{t('settings.profile.step1')}</p>
                <p className="text-[12px] text-slate-500 mb-3">
                  {t('settings.profile.enterKeyManually')}&nbsp;
                  <code className="num text-[12px] bg-slate-100 px-1.5 py-0.5 rounded text-slate-700 break-all">{setupData.secret}</code>
                </p>
                <p className="text-[13px] text-slate-700 font-medium mb-2">{t('settings.profile.step2')}</p>
                <form onSubmit={verifyTotp} className="flex items-center gap-2">
                  <Input
                    value={totpCode}
                    onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    inputMode="numeric"
                    placeholder="123456"
                    className="w-32 num tracking-[0.3em] text-center"
                  />
                  <Button type="submit" disabled={totpBusy || totpCode.length !== 6}>
                    {totpBusy && <Spinner size={14} />}
                    {t('settings.profile.verifyEnable')}
                  </Button>
                  <Button type="button" variant="ghost" onClick={() => { setSetupData(null); setTotpErr('') }}>
                    {t('common.cancel')}
                  </Button>
                </form>
                {totpErr && <p className="text-[12px] text-red-600 mt-2">{totpErr}</p>}
              </div>
            </div>
          </div>
        )}

        {/* Disable: confirm with a current code */}
        {totpEnabled && disarming && (
          <div className="mt-5 pt-5 border-t border-slate-100">
            <p className="text-[13px] text-slate-700 mb-2">{t('settings.profile.disablePrompt')}</p>
            <form onSubmit={disableTotp} className="flex items-center gap-2">
              <Input
                value={disableCode}
                onChange={(e) => setDisableCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                inputMode="numeric"
                placeholder="123456"
                className="w-32 num tracking-[0.3em] text-center"
              />
              <Button type="submit" variant="destructive" disabled={totpBusy || disableCode.length !== 6}>
                {totpBusy && <Spinner size={14} />}
                {t('settings.profile.turnOff2fa')}
              </Button>
              <Button type="button" variant="ghost" onClick={() => { setDisarming(false); setDisableCode(''); setTotpErr('') }}>
                {t('common.cancel')}
              </Button>
            </form>
            {totpErr && <p className="text-[12px] text-red-600 mt-2">{totpErr}</p>}
          </div>
        )}
      </Card>
    </div>
  )
}

// ---------------------------------------------------------------------------
// DangerZoneTab — CFO-only. Permanently delete the entire tenant workspace.
// High friction: the CFO must type the club's exact name to arm the button.
// ---------------------------------------------------------------------------

function DangerZoneTab() {
  const { t } = useTranslation()
  const { clubName } = useClubStore()
  const { signOut } = useAuthStore()
  const navigate = useNavigate()
  const [confirmName, setConfirmName] = useState('')
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState('')

  // Case-insensitive match — the club name is shown for reference, but the user
  // shouldn't be blocked from deleting just because their capitalisation differs
  // (e.g. typing "manchester city" against "Manchester City").
  const armed =
    clubName != null && confirmName.trim().toLowerCase() === clubName.trim().toLowerCase()

  const handleDelete = async () => {
    if (!armed) return
    setDeleting(true)
    setError('')
    try {
      await api.club.deleteOrganization(confirmName.trim())
      toast.success(t('settings.danger.deletedTitle'), t('settings.danger.deletedBody'))
      await signOut()
      navigate('/login')
    } catch (err) {
      setError(err instanceof Error ? err.message : t('settings.danger.failDelete'))
      setDeleting(false)
    }
  }

  return (
    <div className="max-w-3xl">
      <Card className="p-6 border-red-200">
        <div className="flex items-center gap-3 mb-1">
          <span className="inline-block w-1 h-5 rounded-full bg-red-600" />
          <h2 className="text-[15px] font-semibold text-red-700">{t('settings.danger.title')}</h2>
        </div>
        <p className="text-[13px] text-slate-600 mt-1 pl-4 max-w-xl">
          <Trans
            i18nKey="settings.danger.body"
            values={{ name: clubName ?? t('settings.danger.thisOrg') }}
            components={{ b: <span className="font-semibold text-slate-900" /> }}
          />
        </p>

        <div className="mt-5 pl-4 border-l-2 border-red-100">
          <label className="block max-w-md">
            <span className="meta-label block mb-2">
              <Trans
                i18nKey="settings.danger.typeToConfirm"
                values={{ name: clubName ?? t('settings.danger.theOrgName') }}
                components={{ b: <span className="text-slate-900 font-semibold" /> }}
              />
            </span>
            <Input
              value={confirmName}
              onChange={(e) => setConfirmName(e.target.value)}
              placeholder={clubName ?? ''}
              className="border-red-200 focus-visible:ring-red-400"
            />
          </label>
          {error && <p className="text-[12px] text-red-600 mt-2">{error}</p>}
          <div className="mt-4">
            <Button type="button" variant="destructive" disabled={!armed || deleting} onClick={handleDelete}>
              {deleting && <Spinner size={14} />}
              {deleting ? t('settings.danger.deleting') : t('settings.danger.deleteBtn')}
            </Button>
          </div>
        </div>
      </Card>
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
// TeamTab — invite + member list
// ---------------------------------------------------------------------------

const INVITE_LINK_BASE = () =>
  typeof window !== 'undefined' ? `${window.location.origin}/login?invite=` : '/login?invite='

const NO_GRANTS: Permissions = {
  canEditRoster: false,
  canEditScenarios: false,
  isWorkspaceAdmin: false,
}

// Small permission tag chip — violet for Admin, slate for an explicit grant,
// muted for a member with no edit access.
function PermTag({ tone, children }: { tone: 'violet' | 'slate' | 'muted'; children: React.ReactNode }) {
  const cls =
    tone === 'violet' ? 'bg-violet-100 text-violet-700'
    : tone === 'slate' ? 'bg-slate-100 text-slate-700'
    : 'bg-slate-50 text-slate-400'
  return (
    <span className={cn('inline-block text-[11px] font-medium px-2 py-0.5 rounded-md', cls)}>
      {children}
    </span>
  )
}

// Compact summary of a member/invite's access, rendered as UI Kit tags. A
// workspace admin collapses to a single [Admin] tag (it implies everything).
function PermissionTags({ perms }: { perms: Permissions }) {
  const { t } = useTranslation()
  if (perms.isWorkspaceAdmin) return <PermTag tone="violet">{t('settings.perms.admin')}</PermTag>
  const tags: React.ReactNode[] = []
  if (perms.canEditRoster) tags.push(<PermTag key="r" tone="slate">{t('settings.perms.editRoster')}</PermTag>)
  if (perms.canEditScenarios) tags.push(<PermTag key="s" tone="slate">{t('settings.perms.editScenarios')}</PermTag>)
  if (tags.length === 0) return <PermTag tone="muted">{t('settings.perms.readOnly')}</PermTag>
  return <span className="inline-flex flex-wrap gap-1.5">{tags}</span>
}

// The three permission toggles, shared by the invite form and the Manage Access
// modal. Turning on "Workspace Admin" implies the other two, so they render
// locked-on while admin is active (mirrors the backend, where admin overrides).
function PermissionToggles({
  value,
  onChange,
  disabled,
}: {
  value: Permissions
  onChange: (next: Permissions) => void
  disabled?: boolean
}) {
  const { t } = useTranslation()
  const rows: { key: keyof Permissions; label: string; hint: string }[] = [
    { key: 'canEditRoster',    label: t('settings.perms.editRoster'),    hint: t('settings.perms.editRosterHint') },
    { key: 'canEditScenarios', label: t('settings.perms.editScenarios'), hint: t('settings.perms.editScenariosHint') },
    { key: 'isWorkspaceAdmin', label: t('settings.perms.adminLabel'), hint: t('settings.perms.adminHint') },
  ]
  return (
    <div className="rounded-lg border border-slate-200 divide-y divide-slate-100">
      {rows.map((row) => {
        const isAdminRow = row.key === 'isWorkspaceAdmin'
        // Roster/Scenarios show as on + locked while admin is active.
        const impliedOn = !isAdminRow && value.isWorkspaceAdmin
        const checked = isAdminRow ? value.isWorkspaceAdmin : (impliedOn || value[row.key])
        return (
          <label
            key={row.key}
            className="flex items-center justify-between gap-4 px-4 py-3 cursor-pointer"
          >
            <span>
              <span className="block text-[13px] font-medium text-slate-900">{row.label}</span>
              <span className="block text-[12px] text-slate-500">{row.hint}</span>
            </span>
            <Switch
              checked={checked}
              disabled={disabled || impliedOn}
              onChange={(next) => onChange({ ...value, [row.key]: next })}
            />
          </label>
        )
      })}
    </div>
  )
}

function TeamTab() {
  const { t } = useTranslation()
  const [members, setMembers] = useState<TeamMember[]>([])
  const [invites, setInvites] = useState<InviteRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Invite form state
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteTitle, setInviteTitle] = useState('')
  const [invitePerms, setInvitePerms] = useState<Permissions>({ ...NO_GRANTS })
  const [creating, setCreating] = useState(false)
  const [justCreated, setJustCreated] = useState<{ token: string; email: string } | null>(null)
  const [copied, setCopied] = useState(false)
  // Per-row state for the pending-invites table — mirrors the archived-roster
  // pattern: copy gives transient feedback; revoke uses a two-step inline
  // confirm so a single misclick can't kill a pending invite.
  const [copiedInviteId, setCopiedInviteId] = useState<string | null>(null)
  const [confirmRevokeId, setConfirmRevokeId] = useState<string | null>(null)
  const [revokingId, setRevokingId] = useState<string | null>(null)

  // Active-member management (distinct from pending invites).
  const [meId, setMeId] = useState<string | null>(null)
  const [managing, setManaging] = useState<TeamMember | null>(null)
  const [confirmRevokeMemberId, setConfirmRevokeMemberId] = useState<string | null>(null)
  const [revokingMemberId, setRevokingMemberId] = useState<string | null>(null)

  const refresh = async () => {
    setLoading(true)
    setError('')
    try {
      const [m, i] = await Promise.all([api.team.list(), api.invites.list()])
      setMembers(m.members)
      setInvites(i.invites)
    } catch (e) {
      setError(e instanceof Error ? e.message : t('settings.team.failLoad'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { refresh() }, [])
  useEffect(() => { api.me.get().then((me) => setMeId(me.id)).catch(() => {}) }, [])

  const handleManageSaved = (id: string, next: { title: string | null } & Permissions) => {
    setMembers((prev) => prev.map((m) => (m.id === id ? { ...m, ...next } : m)))
    setManaging(null)
    toast.success(t('settings.team.accessUpdated'), t('settings.team.accessUpdatedBody'))
  }

  const handleRevokeMember = async (id: string) => {
    setRevokingMemberId(id)
    setError('')
    try {
      await api.team.revoke(id)
      setConfirmRevokeMemberId(null)
      await refresh()
      toast.success(t('settings.team.accessRevoked'), t('settings.team.accessRevokedBody'))
    } catch (err) {
      setError(err instanceof Error ? err.message : t('settings.team.failRevokeAccess'))
    } finally {
      setRevokingMemberId(null)
    }
  }

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault()
    setCreating(true)
    setError('')
    setJustCreated(null)
    try {
      const result = await api.invites.create({
        email: inviteEmail.trim(),
        title: inviteTitle.trim() || null,
        ...invitePerms,
      })
      setJustCreated({ token: result.token, email: result.email })
      setInviteEmail('')
      setInviteTitle('')
      setInvitePerms({ ...NO_GRANTS })
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('settings.team.failSendInvite'))
    } finally {
      setCreating(false)
    }
  }

  const handleRevoke = async (id: string) => {
    setRevokingId(id)
    try {
      await api.invites.revoke(id)
      setConfirmRevokeId(null)
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('settings.team.failRevokeInvite'))
    } finally {
      setRevokingId(null)
    }
  }

  const copyLink = async (token: string, inviteId?: string) => {
    try {
      await navigator.clipboard.writeText(INVITE_LINK_BASE() + token)
      if (inviteId) {
        setCopiedInviteId(inviteId)
        setTimeout(() => setCopiedInviteId((curr) => (curr === inviteId ? null : curr)), 2000)
      } else {
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      }
    } catch { /* ignore */ }
  }

  if (loading) return <FormPageSkeleton />

  return (
    <div className="space-y-5">
      {/* Invite form */}
      <Card className="p-6">
        <div className="flex items-center gap-3 mb-1">
          <span className="inline-block w-1 h-5 rounded-full bg-violet-600" />
          <h2 className="text-[15px] font-semibold text-slate-900">{t('settings.team.inviteTitle')}</h2>
        </div>
        <p className="text-[13px] text-slate-500 mb-5 pl-4">
          {t('settings.team.inviteSub')}
        </p>

        <form onSubmit={handleInvite} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="meta-label block mb-1.5">{t('settings.team.email')}</span>
              <input
                type="email"
                required
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder={t('settings.team.emailPlaceholder')}
                className="w-full px-3 py-2 text-[14px] rounded-lg border border-slate-200 bg-white focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500"
              />
            </label>
            <label className="block">
              <span className="meta-label block mb-1.5">{t('settings.team.jobTitle')}</span>
              <input
                type="text"
                value={inviteTitle}
                onChange={(e) => setInviteTitle(e.target.value)}
                placeholder={t('settings.team.jobTitlePlaceholder')}
                className="w-full px-3 py-2 text-[14px] rounded-lg border border-slate-200 bg-white focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500"
              />
            </label>
          </div>

          <div>
            <span className="meta-label block mb-1.5">{t('settings.team.permissions')}</span>
            <PermissionToggles value={invitePerms} onChange={setInvitePerms} />
          </div>

          <div className="flex justify-end">
            <Button type="submit" disabled={creating || !inviteEmail.trim()}>
              {creating && <Spinner size={14} />}
              {creating ? t('settings.team.sending') : t('settings.team.sendInvite')}
            </Button>
          </div>
        </form>

        {error && (
          <div className="mt-4 border border-red-200 bg-red-50 rounded-lg px-4 py-3 text-[13px] text-red-700">
            {error}
          </div>
        )}

        {justCreated && (
          <div className="mt-4 border border-violet-100 bg-violet-50/60 rounded-lg p-4">
            <div className="meta-label text-violet-700 mb-2">{t('settings.team.inviteCreated', { email: justCreated.email })}</div>
            <p className="text-[12px] text-slate-600 mb-3">
              {t('settings.team.shareLink')}
            </p>
            <div className="flex items-center gap-2">
              <input
                readOnly
                value={INVITE_LINK_BASE() + justCreated.token}
                className="flex-1 num text-[12px] px-3 py-2 rounded-lg border border-slate-200 bg-white text-slate-700"
                onFocus={(e) => e.currentTarget.select()}
              />
              <Button variant="outline" type="button" onClick={() => copyLink(justCreated.token)}>
                {copied ? t('settings.team.copied') : t('settings.team.copyLink')}
              </Button>
            </div>
          </div>
        )}
      </Card>

      {/* Members table — active users with permission summary + manage/revoke */}
      <Card className="overflow-hidden">
        <div className="px-6 py-5 border-b border-slate-100 flex items-center gap-3">
          <span className="inline-block w-1 h-5 rounded-full bg-violet-600" />
          <h2 className="text-[15px] font-semibold text-slate-900">{t('settings.team.activeUsers', { count: members.length })}</h2>
        </div>
        <div className="overflow-x-auto">
        <table className="w-full min-w-[640px]">
          <thead className="bg-slate-50/40 border-b border-slate-100">
            <tr>
              <Th>{t('settings.team.thName')}</Th>
              <Th>{t('settings.team.thEmail')}</Th>
              <Th>{t('settings.team.thPermissions')}</Th>
              <Th>{t('settings.team.thJoined')}</Th>
              <Th align="right">{''}</Th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => {
              const isSelf = m.id === meId
              const confirming = confirmRevokeMemberId === m.id
              const revoking = revokingMemberId === m.id
              return (
                <tr key={m.id} className="border-b border-slate-100 last:border-0">
                  <td className="px-6 py-3.5 text-[14px] text-slate-900 font-medium">
                    {m.fullName}
                    {isSelf && <span className="ml-1.5 text-[11px] text-slate-400 font-normal">{t('settings.team.you')}</span>}
                    {m.title && <span className="block text-[12px] text-slate-400 font-normal">{m.title}</span>}
                  </td>
                  <td className="px-6 py-3.5 text-[13px] text-slate-500 num">{m.email}</td>
                  <td className="px-6 py-3.5">
                    <PermissionTags perms={m} />
                  </td>
                  <td className="px-6 py-3.5 text-[12px] text-slate-500 num">
                    {new Date(m.createdAt).toLocaleDateString(activeLocale(), { day: '2-digit', month: 'short', year: 'numeric' })}
                  </td>
                  <td className="px-6 py-3.5 text-right">
                    {isSelf ? (
                      <span className="text-[12px] text-slate-300">—</span>
                    ) : confirming ? (
                      <span className="inline-flex items-center gap-2 justify-end">
                        <span className="text-[11px] text-slate-600 whitespace-nowrap">{t('settings.team.revokeAccessPrompt')}</span>
                        <SettingsIconButton
                          label={revoking ? t('settings.team.revoking') : t('settings.team.confirmRevoke')}
                          tone="danger"
                          disabled={revoking}
                          onClick={() => handleRevokeMember(m.id)}
                        >
                          {revoking ? <Spinner size={14} /> : <CheckIcon />}
                        </SettingsIconButton>
                        <SettingsIconButton
                          label={t('common.cancel')}
                          tone="neutral"
                          disabled={revoking}
                          onClick={() => setConfirmRevokeMemberId(null)}
                        >
                          <CloseIcon />
                        </SettingsIconButton>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 justify-end">
                        <SettingsIconButton
                          label={t('settings.team.manageAccess')}
                          tone="violet"
                          onClick={() => setManaging(m)}
                        >
                          <SlidersIcon />
                        </SettingsIconButton>
                        <SettingsIconButton
                          label={t('settings.team.revokeAccess')}
                          tone="danger"
                          onClick={() => setConfirmRevokeMemberId(m.id)}
                        >
                          <TrashIcon />
                        </SettingsIconButton>
                      </span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        </div>
      </Card>

      <AnimatePresence>
        {managing && (
          <ManageAccessModal
            member={managing}
            onClose={() => setManaging(null)}
            onSaved={handleManageSaved}
          />
        )}
      </AnimatePresence>

      {/* Pending invites */}
      {invites.filter((i) => i.status === 'pending').length > 0 && (
        <Card className="overflow-hidden">
          <div className="px-6 py-5 border-b border-slate-100 flex items-center gap-3">
            <span className="inline-block w-1 h-5 rounded-full bg-violet-600" />
            <h2 className="text-[15px] font-semibold text-slate-900">{t('settings.team.pendingInvites')}</h2>
          </div>
          <div className="overflow-x-auto">
          <table className="w-full min-w-[560px]">
            <thead className="bg-slate-50/40 border-b border-slate-100">
              <tr>
                <Th>{t('settings.team.thEmail')}</Th>
                <Th>{t('settings.team.thPermissions')}</Th>
                <Th>{t('settings.team.thExpires')}</Th>
                <Th align="right">{''}</Th>
              </tr>
            </thead>
            <tbody>
              {invites.filter((i) => i.status === 'pending').map((inv) => (
                <tr key={inv.id} className="border-b border-slate-100 last:border-0">
                  <td className="px-6 py-3.5 text-[13px] text-slate-700 num">
                    {inv.email}
                    {inv.title && <span className="block text-[12px] text-slate-400">{inv.title}</span>}
                  </td>
                  <td className="px-6 py-3.5">
                    <PermissionTags perms={inv} />
                  </td>
                  <td className="px-6 py-3.5 text-[12px] text-slate-500 num">
                    {new Date(inv.expiresAt).toLocaleDateString(activeLocale(), { day: '2-digit', month: 'short', year: 'numeric' })}
                  </td>
                  <td className="px-6 py-3.5 text-right">
                    <InviteRowActions
                      invite={inv}
                      copiedInviteId={copiedInviteId}
                      confirmRevokeId={confirmRevokeId}
                      revokingId={revokingId}
                      onCopy={(token, id) => copyLink(token, id)}
                      onRequestRevoke={(id) => setConfirmRevokeId(id)}
                      onConfirmRevoke={handleRevoke}
                      onCancelRevoke={() => setConfirmRevokeId(null)}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </Card>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// ActivityTab — paginated audit log viewer
// ---------------------------------------------------------------------------

const ACTION_COLOR: Record<string, string> = {
  create: 'bg-green-100 text-green-700',
  update: 'bg-violet-100 text-violet-700',
  delete: 'bg-red-100 text-red-700',
}

const TABLE_LABEL: Record<string, string> = {
  clubs:               'Club',
  club_financials:     'Financials',
  players:             'Player',
  contracts:           'Contract',
  scenarios:           'Scenario',
  scenario_actions:    'Scenario action',
  ssr_working_capital: 'Working Capital',
  ssr_liquidity:       'Liquidity',
  ssr_equity:          'Equity',
  invites:             'Invite',
}

// Icon-button actions for a pending-invite row — Copy link + Revoke, mirroring
// the archived-roster row UX. Copy flips to a check glyph for 2s after success.
// Revoke is two-step (icon → inline Confirm/Cancel) to avoid accidental loss.
function InviteRowActions({
  invite,
  copiedInviteId,
  confirmRevokeId,
  revokingId,
  onCopy,
  onRequestRevoke,
  onConfirmRevoke,
  onCancelRevoke,
}: {
  invite: InviteRow
  copiedInviteId: string | null
  confirmRevokeId: string | null
  revokingId: string | null
  onCopy: (token: string, inviteId: string) => void
  onRequestRevoke: (id: string) => void
  onConfirmRevoke: (id: string) => void
  onCancelRevoke: () => void
}) {
  const { t } = useTranslation()
  const confirming = confirmRevokeId === invite.id
  const revoking = revokingId === invite.id
  const justCopied = copiedInviteId === invite.id

  if (confirming) {
    return (
      <span className="inline-flex items-center gap-2 justify-end">
        <span className="text-[11px] text-slate-600 whitespace-nowrap">{t('settings.team.revokeInvitePrompt', { email: invite.email })}</span>
        <SettingsIconButton
          label={revoking ? t('settings.team.revoking') : t('settings.team.confirmRevoke')}
          tone="danger"
          disabled={revoking}
          onClick={() => onConfirmRevoke(invite.id)}
        >
          {revoking ? <Spinner size={14} /> : <CheckIcon />}
        </SettingsIconButton>
        <SettingsIconButton
          label={t('common.cancel')}
          tone="neutral"
          disabled={revoking}
          onClick={onCancelRevoke}
        >
          <CloseIcon />
        </SettingsIconButton>
      </span>
    )
  }

  return (
    <span className="inline-flex items-center gap-1.5 justify-end">
      {invite.token && (
        <SettingsIconButton
          label={justCopied ? t('settings.team.copied') : t('settings.team.copyInviteLink')}
          tone={justCopied ? 'success' : 'violet'}
          onClick={() => onCopy(invite.token!, invite.id)}
        >
          {justCopied ? <CheckIcon /> : <CopyIcon />}
        </SettingsIconButton>
      )}
      <SettingsIconButton
        label={t('settings.team.revokeInvite')}
        tone="danger"
        onClick={() => onRequestRevoke(invite.id)}
      >
        <TrashIcon />
      </SettingsIconButton>
    </span>
  )
}

// Local 28×28 icon button — matches the archived-roster IconButton visually.
// Kept inline so the Team tab stays self-contained; tone covers the four
// states we need (violet for primary affordances, danger for destructive,
// success for transient confirmation, neutral for cancel).
function SettingsIconButton({
  label,
  tone,
  disabled,
  onClick,
  children,
}: {
  label: string
  tone: 'violet' | 'danger' | 'neutral' | 'success'
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  const toneClass =
    tone === 'violet'
      ? 'text-violet-600 hover:bg-violet-50 hover:border-violet-200'
      : tone === 'danger'
      ? 'text-red-600 hover:bg-red-50 hover:border-red-200'
      : tone === 'success'
      ? 'text-green-600 border-green-200 bg-green-50'
      : 'text-slate-500 hover:bg-slate-50 hover:border-slate-300'
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'inline-flex items-center justify-center w-7 h-7 rounded-md border border-slate-200 bg-white transition-colors disabled:opacity-60 disabled:cursor-not-allowed',
        toneClass
      )}
    >
      {children}
    </button>
  )
}

function CopyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="9" width="11" height="11" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  )
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 6h18" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M18 6 6 18" />
      <path d="M6 6l12 12" />
    </svg>
  )
}

function SlidersIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="4" y1="21" x2="4" y2="14" />
      <line x1="4" y1="10" x2="4" y2="3" />
      <line x1="12" y1="21" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12" y2="3" />
      <line x1="20" y1="21" x2="20" y2="16" />
      <line x1="20" y1="12" x2="20" y2="3" />
      <line x1="1" y1="14" x2="7" y2="14" />
      <line x1="9" y1="8" x2="15" y2="8" />
      <line x1="17" y1="16" x2="23" y2="16" />
    </svg>
  )
}

// ---------------------------------------------------------------------------
// ManageAccessModal — admin edits a single member's title + permission grants.
// Uses the shared PermissionToggles + a pure-fade modal (matching CompareModal).
// ---------------------------------------------------------------------------
function ManageAccessModal({
  member,
  onClose,
  onSaved,
}: {
  member: TeamMember
  onClose: () => void
  onSaved: (id: string, next: { title: string | null } & Permissions) => void
}) {
  const { t } = useTranslation()
  useScrollLock()
  const [title, setTitle] = useState(member.title ?? '')
  const [perms, setPerms] = useState<Permissions>({
    canEditRoster: member.canEditRoster,
    canEditScenarios: member.canEditScenarios,
    isWorkspaceAdmin: member.isWorkspaceAdmin,
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const handleSave = async () => {
    setSaving(true)
    setError('')
    try {
      const nextTitle = title.trim() || null
      const res = await api.team.update(member.id, { title: nextTitle, ...perms })
      onSaved(member.id, {
        title: res.title,
        canEditRoster: res.canEditRoster,
        canEditScenarios: res.canEditScenarios,
        isWorkspaceAdmin: res.isWorkspaceAdmin,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : t('settings.team.failUpdateAccess'))
      setSaving(false)
    }
  }

  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-[2px] overscroll-contain"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0, transition: { duration: 0.12 } }}
        transition={{ duration: 0.16, ease: 'easeOut' }}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-md border border-slate-200 overflow-hidden"
      >
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h2 className="text-[16px] font-semibold text-slate-900">{t('settings.team.manageTitle')}</h2>
            <p className="text-[12px] text-slate-500 mt-0.5">{member.fullName} · <span className="num">{member.email}</span></p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 p-1 -m-1" aria-label={t('roster.form.close')}>
            <CloseIcon />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <label className="block">
            <span className="meta-label block mb-1.5">{t('settings.team.jobTitle')}</span>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t('settings.team.jobTitlePlaceholder')}
              className="w-full px-3 py-2 text-[14px] rounded-lg border border-slate-200 bg-white focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500"
            />
          </label>
          <div>
            <span className="meta-label block mb-1.5">{t('settings.team.permissions')}</span>
            <PermissionToggles value={perms} onChange={setPerms} disabled={saving} />
          </div>
          {error && (
            <div className="border border-red-200 bg-red-50 rounded-lg px-4 py-3 text-[13px] text-red-700">
              {error}
            </div>
          )}
        </div>
        <div className="px-5 py-4 border-t border-slate-100 flex justify-end gap-2">
          <Button variant="outline" type="button" onClick={onClose} disabled={saving}>{t('common.cancel')}</Button>
          <Button type="button" onClick={handleSave} disabled={saving}>
            {saving && <Spinner size={14} />}
            {saving ? t('common.saving') : t('common.save')}
          </Button>
        </div>
      </motion.div>
    </motion.div>
  )
}

function ActivityTab() {
  const { t } = useTranslation()
  const [entries, setEntries] = useState<AuditEntry[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const limit = 50

  const totalPages = Math.max(1, Math.ceil(total / limit))

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    api.audit.list({ page, limit })
      .then((data) => {
        if (cancelled) return
        setEntries(data.entries)
        setTotal(data.total)
      })
      .catch((e: Error) => { if (!cancelled) setError(e.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [page])

  if (loading) return <FormPageSkeleton />

  return (
    <div className="space-y-4">
      {error && (
        <Card className="p-4 border-red-200 bg-red-50">
          <p className="text-[13px] text-red-700">{error}</p>
        </Card>
      )}

      <Card className="overflow-hidden">
        <div className="px-6 py-5 border-b border-slate-100 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="inline-block w-1 h-5 rounded-full bg-violet-600" />
            <div>
              <h2 className="text-[15px] font-semibold text-slate-900">{t('settings.activity.title')}</h2>
              <p className="text-[12px] text-slate-500 mt-0.5">
                {t('settings.activity.sub')}
              </p>
            </div>
          </div>
          <span className="text-[12px] text-slate-400 num">{t('settings.activity.entries', { count: total })}</span>
        </div>

        {entries.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-[14px] text-slate-500">{t('settings.activity.empty')}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
          <table className="w-full min-w-[720px]">
            <thead className="bg-slate-50/40 border-b border-slate-100">
              <tr>
                <Th>{t('settings.activity.thWhen')}</Th>
                <Th>{t('settings.activity.thUser')}</Th>
                <Th>{t('settings.activity.thAction')}</Th>
                <Th>{t('settings.activity.thResource')}</Th>
                <Th>{t('settings.activity.thRecordId')}</Th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id} className="border-b border-slate-100 last:border-0 hover:bg-violet-50/40">
                  <td className="px-6 py-3 text-[12px] text-slate-500 num whitespace-nowrap">
                    {new Date(entry.createdAt).toLocaleString(activeLocale(), {
                      day: '2-digit', month: 'short', year: 'numeric',
                      hour: '2-digit', minute: '2-digit',
                    })}
                  </td>
                  <td className="px-6 py-3 text-[13px] text-slate-700">
                    {entry.user?.fullName ?? <span className="text-slate-400">—</span>}
                  </td>
                  <td className="px-6 py-3">
                    <span className={cn('inline-block text-[11px] font-medium px-2 py-0.5 rounded-md uppercase tracking-wider', ACTION_COLOR[entry.action] ?? 'bg-slate-100 text-slate-700')}>
                      {t(`settings.activity.action.${entry.action}`, { defaultValue: entry.action })}
                    </span>
                  </td>
                  <td className="px-6 py-3 text-[13px] text-slate-700">
                    {t(`settings.activity.table.${entry.tableName}`, { defaultValue: TABLE_LABEL[entry.tableName] ?? entry.tableName })}
                  </td>
                  <td className="px-6 py-3 text-[11px] text-slate-400 num truncate max-w-[180px]">
                    {entry.recordId.slice(0, 8)}…
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="px-6 py-3 border-t border-slate-100 flex items-center justify-between text-[12px]">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="text-violet-600 hover:text-violet-700 disabled:opacity-40 disabled:cursor-not-allowed font-medium"
            >
              ← {t('settings.activity.previous')}
            </button>
            <span className="text-slate-500 num">{t('settings.activity.pageOf', { page, total: totalPages })}</span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="text-violet-600 hover:text-violet-700 disabled:opacity-40 disabled:cursor-not-allowed font-medium"
            >
              {t('settings.activity.next')} →
            </button>
          </div>
        )}
      </Card>
    </div>
  )
}

function Th({ children, align = 'left' }: { children: React.ReactNode; align?: 'left' | 'right' | 'center' }) {
  return (
    <th className={cn(
      'meta-label px-6 py-3 whitespace-nowrap',
      align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left'
    )}>
      {children}
    </th>
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

// Segmented control matching the league switch in this same page — keeps the
// settings surface visually consistent. Mirrors the pill style used elsewhere.
function SquadCostsModeToggle({
  value,
  onChange,
}: {
  value: 'derived' | 'manual'
  onChange: (v: 'derived' | 'manual') => void
}) {
  const { t } = useTranslation()
  return (
    <div className="inline-flex bg-slate-100 rounded-lg p-1 w-full">
      <SegmentButton active={value === 'derived'} onClick={() => onChange('derived')}>
        {t('settings.squadMode.derived')}
      </SegmentButton>
      <SegmentButton active={value === 'manual'} onClick={() => onChange('manual')}>
        {t('settings.squadMode.manual')}
      </SegmentButton>
    </div>
  )
}

function SegmentButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex-1 px-3 py-1.5 text-[12.5px] font-medium rounded-md transition-colors',
        active
          ? 'bg-white text-slate-900 shadow-sm'
          : 'text-slate-500 hover:text-slate-700'
      )}
    >
      {children}
    </button>
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
