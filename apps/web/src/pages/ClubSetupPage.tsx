import { useState, useEffect, useMemo } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { api } from '@/lib/api'
import { useClubStore } from '@/stores/club'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { FormPageSkeleton } from '@/components/ui/page-skeletons'
import { NumericInput } from '@/components/ui/numeric-input'
import { AnimatedNumber } from '@/components/ui/animated-number'
import { toast } from '@/components/ui/toast'

// Same format helper as the Dashboard — used by AnimatedNumber so intermediate
// frames render as £-prefixed integers, not raw decimals.
function formatPenceNumber(pence: number) {
  return '£' + Math.round(pence / 100).toLocaleString('en-GB')
}
import { Card } from '@/components/ui/card'
import { StatusBadge } from '@/components/ui/badge'
import { formatPence } from '@headroom/shared'
import { EFL_CHAMPIONSHIP_CONFIG } from '@headroom/shared'
import { calculatePromotedClubRevenueUplift, PROMOTED_CLUB_DEFAULT_UPLIFT_FACTOR } from '@headroom/engine'
import { cn } from '@/lib/utils'
import { useCan } from '@/lib/role'
import type { ComplianceStatus } from '@headroom/shared'
import type { InviteRow, TeamMember, AuditEntry, InviteRole } from '@/lib/api'

const SetupSchema = z
  .object({
    footballRelatedRevenuePounds: z
      .number({ invalid_type_error: 'Revenue must be a number' })
      .int()
      .positive('Revenue must be positive')
      .max(2_000_000_000, 'Revenue cannot exceed £2B'),
    currentAllowanceRatio: z.number({ invalid_type_error: 'Allowance must be a number' }).min(0).max(1),
    ownerEquityUsedCurrentSeasonPounds: z.number({ invalid_type_error: 'Must be a number' }).int().min(0).max(15_000_000, 'EFL limit is £15M per season').optional(),
    squadCostsMode: z.enum(['derived', 'manual']),
    manualSquadCostsPounds: z
      .number({ invalid_type_error: 'Squad costs must be a number' })
      .int()
      .min(0)
      .max(2_000_000_000, 'Squad costs cannot exceed £2B')
      .optional(),
  })
  .refine(
    (d) => d.squadCostsMode !== 'manual' || (d.manualSquadCostsPounds != null && d.manualSquadCostsPounds >= 0),
    { message: 'Enter a manual value or switch back to derived', path: ['manualSquadCostsPounds'] },
  )
type SetupData = z.infer<typeof SetupSchema>

export function ClubSetupPage() {
  const { financials, setFinancials, leagueId, setClub, clubId, clubName } = useClubStore()
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  // League switch state
  const [leagueSaving, setLeagueSaving] = useState(false)

  // Promoted-club uplift state (only relevant when on Premier League)
  const [showUplift, setShowUplift] = useState(false)
  const [championshipRevenuePounds, setChampionshipRevenuePounds] = useState(NaN)
  const [upliftFactor, setUpliftFactor] = useState(PROMOTED_CLUB_DEFAULT_UPLIFT_FACTOR)

  const form = useForm<SetupData>({
    resolver: zodResolver(SetupSchema),
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
    greenThreshold = Math.floor(adjustedRevenuePounds * 100 * EFL_CHAMPIONSHIP_CONFIG.greenThresholdRatio)
    redThreshold = Math.floor(greenThreshold * (1 + watchAllowance))
    if (effectiveSquadCostsPounds != null && effectiveSquadCostsPounds >= 0) {
      const squadPence = effectiveSquadCostsPounds * 100
      currentPct = (squadPence / (adjustedRevenuePounds * 100)) * 100
      scrStatus = currentPct > EFL_CHAMPIONSHIP_CONFIG.greenThresholdRatio * (1 + watchAllowance) * 100
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
      toast.success('Settings saved', 'Thresholds updated across the app.')
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to save club financials'
      setError(msg)
      toast.error('Save failed', msg)
    }
  }

  const switchLeague = async (next: 'efl-championship' | 'premier-league') => {
    if (leagueId === next || leagueSaving) return
    setLeagueSaving(true)
    setError('')
    try {
      await api.club.setLeague(next)
      if (clubId) setClub(clubId, clubName ?? 'Your Club', next)
      toast.success('League switched', next === 'premier-league' ? 'Premier League rules now apply.' : 'Championship rules now apply.')
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to change league'
      setError(msg)
      toast.error('League change failed', msg)
    } finally {
      setLeagueSaving(false)
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
    <SettingsShell>
      {/* League switch (single card spanning the page width) */}
      <Card className="p-6 mb-6">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <span className="inline-block w-1 h-5 rounded-full bg-violet-600" />
              <h2 className="text-[15px] font-semibold text-slate-900">League</h2>
            </div>
            <p className="text-[13px] text-slate-500 pl-4 max-w-xl">
              Switches the regulatory framework. Premier League adds the three SSR solvency tests; Championship adds the £33M owner-equity top-up allowance.
            </p>
          </div>
          <div className="inline-flex bg-slate-100 rounded-lg p-1">
            <button
              onClick={() => switchLeague('efl-championship')}
              disabled={leagueSaving}
              className={cn(
                'px-4 py-1.5 text-[13px] font-medium rounded-md transition-colors',
                leagueId === 'efl-championship'
                  ? 'bg-white text-violet-700 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900',
              )}
            >
              EFL Championship
            </button>
            <button
              onClick={() => switchLeague('premier-league')}
              disabled={leagueSaving}
              className={cn(
                'px-4 py-1.5 text-[13px] font-medium rounded-md transition-colors',
                leagueId === 'premier-league'
                  ? 'bg-white text-violet-700 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900',
              )}
            >
              Premier League
              {leagueSaving && leagueId !== 'premier-league' && <Spinner size={11} />}
            </button>
          </div>
        </div>

        {/* Promoted-club uplift — only when on PL */}
        {leagueId === 'premier-league' && (
          <div className="mt-5 pt-5 border-t border-slate-100">
            <div className="flex items-center justify-between">
              <div>
                <div className="meta-label">Just promoted from the Championship?</div>
                <p className="text-[12px] text-slate-500 mt-1 max-w-md">
                  Estimate Year-1 PL revenue from your last Championship season. Editable assumption.
                </p>
              </div>
              <button
                onClick={() => setShowUplift((v) => !v)}
                className="text-[12px] font-medium text-violet-600 hover:text-violet-700"
              >
                {showUplift ? 'Hide' : 'Use uplift estimator'}
              </button>
            </div>

            {showUplift && (
              <div className="mt-4 rounded-lg border border-violet-100 bg-violet-50/40 p-4 grid grid-cols-3 gap-4 items-end">
                <label className="block">
                  <span className="meta-label block mb-1.5">Last Championship revenue (£)</span>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-[14px]">£</span>
                    <NumericInput
                      value={championshipRevenuePounds}
                      onChange={setChampionshipRevenuePounds}
                      className="w-full pl-7 pr-3 py-2 text-[14px] rounded-lg border border-slate-200 bg-white num focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500"
                    />
                  </div>
                </label>
                <label className="block">
                  <span className="meta-label block mb-1.5">Uplift factor (×)</span>
                  <input
                    type="number"
                    step="0.1"
                    min="1"
                    max="10"
                    value={upliftFactor}
                    onChange={(e) => setUpliftFactor(parseFloat(e.target.value) || PROMOTED_CLUB_DEFAULT_UPLIFT_FACTOR)}
                    className="w-full px-3 py-2 text-[14px] rounded-lg border border-slate-200 bg-white num focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500"
                  />
                </label>
                <div>
                  <div className="meta-label mb-1.5">Estimated PL revenue</div>
                  <div className="num text-[20px] font-medium text-slate-900 leading-none mb-2">
                    {upliftPence > 0 ? formatPence(upliftPence) : '—'}
                  </div>
                  <button
                    onClick={applyUplift}
                    disabled={upliftPence <= 0}
                    className="text-[12px] font-medium text-violet-600 hover:text-violet-700 disabled:opacity-50"
                  >
                    Apply to revenue field →
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </Card>

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
                        max={2_000_000_000}
                        className={inputCls(!!errs.footballRelatedRevenuePounds, 'pl-7')}
                      />
                    )}
                  />
                </div>
              </FieldWrapper>

              <FieldWrapper
                label="Squad Costs"
                helper={
                  watchMode === 'manual'
                    ? 'Manual override — your roster sum is ignored everywhere SCR is computed.'
                    : 'Derived live from your active roster. Switch to manual to enter a value directly.'
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
                      <span className="num absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 select-none pointer-events-none">£</span>
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
                      <span className="num absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 select-none pointer-events-none">£</span>
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

              {/* Owner equity top-up — Championship only. PL clubs do not have this allowance. */}
              {leagueId !== 'premier-league' && (
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
              )}
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

        {/* Live threshold preview panel — aligns to the top of the shared grid
            row in both leagues. Previously sticky/top-20, which interacted
            badly with grid `self-start` once the page got tall in PL mode
            (the Promoted-club uplift block above adds height) and shifted the
            card down out of alignment with Season Financials. */}
        <Card className="p-6 self-start relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-1 bg-violet-600" />
          <h3 className="text-[13px] font-semibold tracking-wider text-violet-700 uppercase mt-1" style={{ letterSpacing: '0.08em' }}>
            Calculated Thresholds
          </h3>
          <p className="text-[12px] text-slate-500 mt-1.5">Updates as you type. Save to apply across the app.</p>

          <div className="mt-6 space-y-5">
            <div>
              <div className="meta-label">Green Threshold ({greenPct}%)</div>
              <div className="mt-1.5">
                {greenThreshold !== null ? (
                  <AnimatedNumber
                    value={greenThreshold}
                    format={formatPenceNumber}
                    className="num text-[28px] font-semibold text-green-700 leading-none"
                  />
                ) : (
                  <span className="num text-[28px] font-semibold text-green-700 leading-none">—</span>
                )}
              </div>
              <div className="text-[11px] text-slate-400 mt-1">Maximum squad costs — no levy</div>
            </div>
            <div>
              <div className="meta-label">Red Threshold ({redPctVal}%)</div>
              <div className="mt-1.5">
                {redThreshold !== null ? (
                  <AnimatedNumber
                    value={redThreshold}
                    format={formatPenceNumber}
                    className="num text-[28px] font-semibold text-red-600 leading-none"
                  />
                ) : (
                  <span className="num text-[28px] font-semibold text-red-600 leading-none">—</span>
                )}
              </div>
              <div className="text-[11px] text-slate-400 mt-1">Points deduction above this line</div>
            </div>

            {currentPct !== null && (
              <div className="pt-5 border-t border-slate-100">
                <div className="meta-label mb-2">Current SCR Position</div>
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
                    <span className="text-slate-500">Headroom to Green</span>
                    <AnimatedNumber
                      value={headroom}
                      format={(n) => (n < 0 ? '−' + formatPenceNumber(Math.abs(n)) : '+' + formatPenceNumber(n))}
                      className={`num font-medium ${headroom < 0 ? 'text-red-600' : 'text-slate-900'}`}
                    />
                  </div>
                )}
              </div>
            )}
          </div>
        </Card>
      </div>
    </SettingsShell>
  )
}

// ---------------------------------------------------------------------------
// SettingsShell — page header + tab nav. Hosts Financials (this page) +
// Team + Activity tab content based on the `tab` URL hash.
// ---------------------------------------------------------------------------

function SettingsShell({ children }: { children: React.ReactNode }) {
  const [tab, setTab] = useState<'financials' | 'team' | 'activity'>(() => {
    const h = window.location.hash.replace('#', '')
    return h === 'team' || h === 'activity' ? h : 'financials'
  })
  const can = useCan()

  useEffect(() => {
    window.location.hash = tab === 'financials' ? '' : tab
  }, [tab])

  return (
    <div>
      <div className="mb-6 flex items-center gap-3">
        <span className="inline-block w-1.5 h-7 rounded-full bg-violet-600" />
        <div>
          <h1 className="text-[24px] font-bold text-slate-900 tracking-tight leading-none">Settings</h1>
          <p className="text-[13px] text-slate-400 mt-1.5">Club configuration, team members, and activity log</p>
        </div>
      </div>

      <div className="flex items-center gap-6 border-b border-slate-200 mb-5">
        <TabButton active={tab === 'financials'} onClick={() => setTab('financials')}>Financials</TabButton>
        {can.inviteMembers && (
          <TabButton active={tab === 'team'} onClick={() => setTab('team')}>Team</TabButton>
        )}
        {can.viewAuditLog && (
          <TabButton active={tab === 'activity'} onClick={() => setTab('activity')}>Activity Log</TabButton>
        )}
      </div>

      {tab === 'financials' && children}
      {tab === 'team'       && can.inviteMembers && <TeamTab />}
      {tab === 'activity'   && can.viewAuditLog   && <ActivityTab />}
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

const ROLE_LABEL: Record<string, string> = {
  cfo: 'CFO',
  sporting_director: 'Sporting Director',
  finance_analyst: 'Finance Analyst',
  admin: 'Admin',
}

function TeamTab() {
  const [members, setMembers] = useState<TeamMember[]>([])
  const [invites, setInvites] = useState<InviteRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Invite form state
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<InviteRole>('finance_analyst')
  const [creating, setCreating] = useState(false)
  const [justCreated, setJustCreated] = useState<{ token: string; email: string } | null>(null)
  const [copied, setCopied] = useState(false)
  // Per-row state for the pending-invites table — mirrors the archived-roster
  // pattern: copy gives transient feedback; revoke uses a two-step inline
  // confirm so a single misclick can't kill a pending invite.
  const [copiedInviteId, setCopiedInviteId] = useState<string | null>(null)
  const [confirmRevokeId, setConfirmRevokeId] = useState<string | null>(null)
  const [revokingId, setRevokingId] = useState<string | null>(null)

  const refresh = async () => {
    setLoading(true)
    setError('')
    try {
      const [m, i] = await Promise.all([api.team.list(), api.invites.list()])
      setMembers(m.members)
      setInvites(i.invites)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load team')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { refresh() }, [])

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault()
    setCreating(true)
    setError('')
    setJustCreated(null)
    try {
      const result = await api.invites.create({ email: inviteEmail.trim(), role: inviteRole })
      setJustCreated({ token: result.token, email: result.email })
      setInviteEmail('')
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send invite')
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
      setError(err instanceof Error ? err.message : 'Failed to revoke invite')
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
          <h2 className="text-[15px] font-semibold text-slate-900">Invite a team member</h2>
        </div>
        <p className="text-[13px] text-slate-500 mb-5 pl-4">
          Invitees complete the same 8-digit OTP signup as the CFO. The invite link expires in 7 days.
        </p>

        <form onSubmit={handleInvite} className="grid grid-cols-[1fr_220px_auto] gap-3 items-end">
          <label className="block">
            <span className="meta-label block mb-1.5">Email</span>
            <input
              type="email"
              required
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              placeholder="colleague@yourclub.com"
              className="w-full px-3 py-2 text-[14px] rounded-lg border border-slate-200 bg-white focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500"
            />
          </label>
          <label className="block">
            <span className="meta-label block mb-1.5">Role</span>
            <select
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as InviteRole)}
              className="w-full px-3 py-2 text-[14px] rounded-lg border border-slate-200 bg-white focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500"
            >
              <option value="finance_analyst">Finance Analyst</option>
              <option value="sporting_director">Sporting Director</option>
              <option value="cfo">CFO</option>
            </select>
          </label>
          <Button type="submit" disabled={creating || !inviteEmail.trim()}>
            {creating && <Spinner size={14} />}
            {creating ? 'Sending…' : 'Send invite'}
          </Button>
        </form>

        {error && (
          <div className="mt-4 border border-red-200 bg-red-50 rounded-lg px-4 py-3 text-[13px] text-red-700">
            {error}
          </div>
        )}

        {justCreated && (
          <div className="mt-4 border border-violet-100 bg-violet-50/60 rounded-lg p-4">
            <div className="meta-label text-violet-700 mb-2">Invite created for {justCreated.email}</div>
            <p className="text-[12px] text-slate-600 mb-3">
              Share this link directly with them. The CFO is responsible for verifying the recipient's identity.
            </p>
            <div className="flex items-center gap-2">
              <input
                readOnly
                value={INVITE_LINK_BASE() + justCreated.token}
                className="flex-1 num text-[12px] px-3 py-2 rounded-lg border border-slate-200 bg-white text-slate-700"
                onFocus={(e) => e.currentTarget.select()}
              />
              <Button variant="outline" type="button" onClick={() => copyLink(justCreated.token)}>
                {copied ? 'Copied' : 'Copy link'}
              </Button>
            </div>
          </div>
        )}
      </Card>

      {/* Members table */}
      <Card className="overflow-hidden">
        <div className="px-6 py-5 border-b border-slate-100 flex items-center gap-3">
          <span className="inline-block w-1 h-5 rounded-full bg-violet-600" />
          <h2 className="text-[15px] font-semibold text-slate-900">Members ({members.length})</h2>
        </div>
        <table className="w-full">
          <thead className="bg-slate-50/40 border-b border-slate-100">
            <tr>
              <Th>Name</Th>
              <Th>Email</Th>
              <Th>Role</Th>
              <Th align="right">Joined</Th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id} className="border-b border-slate-100 last:border-0">
                <td className="px-6 py-3.5 text-[14px] text-slate-900 font-medium">{m.fullName}</td>
                <td className="px-6 py-3.5 text-[13px] text-slate-500 num">{m.email}</td>
                <td className="px-6 py-3.5">
                  <span className="inline-block text-[11px] font-medium px-2 py-0.5 rounded-md bg-slate-100 text-slate-700">
                    {ROLE_LABEL[m.role] ?? m.role}
                  </span>
                </td>
                <td className="px-6 py-3.5 text-right text-[12px] text-slate-500 num">
                  {new Date(m.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {/* Pending invites */}
      {invites.filter((i) => i.status === 'pending').length > 0 && (
        <Card className="overflow-hidden">
          <div className="px-6 py-5 border-b border-slate-100 flex items-center gap-3">
            <span className="inline-block w-1 h-5 rounded-full bg-violet-600" />
            <h2 className="text-[15px] font-semibold text-slate-900">Pending invitations</h2>
          </div>
          <table className="w-full">
            <thead className="bg-slate-50/40 border-b border-slate-100">
              <tr>
                <Th>Email</Th>
                <Th>Role</Th>
                <Th>Expires</Th>
                <Th align="right">{''}</Th>
              </tr>
            </thead>
            <tbody>
              {invites.filter((i) => i.status === 'pending').map((inv) => (
                <tr key={inv.id} className="border-b border-slate-100 last:border-0">
                  <td className="px-6 py-3.5 text-[13px] text-slate-700 num">{inv.email}</td>
                  <td className="px-6 py-3.5">
                    <span className="inline-block text-[11px] font-medium px-2 py-0.5 rounded-md bg-slate-100 text-slate-700">
                      {ROLE_LABEL[inv.role] ?? inv.role}
                    </span>
                  </td>
                  <td className="px-6 py-3.5 text-[12px] text-slate-500 num">
                    {new Date(inv.expiresAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}
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
  const confirming = confirmRevokeId === invite.id
  const revoking = revokingId === invite.id
  const justCopied = copiedInviteId === invite.id

  if (confirming) {
    return (
      <span className="inline-flex items-center gap-2 justify-end">
        <span className="text-[11px] text-slate-600 whitespace-nowrap">Revoke {invite.email}?</span>
        <SettingsIconButton
          label={revoking ? 'Revoking…' : 'Confirm revoke'}
          tone="danger"
          disabled={revoking}
          onClick={() => onConfirmRevoke(invite.id)}
        >
          {revoking ? <Spinner size={14} /> : <CheckIcon />}
        </SettingsIconButton>
        <SettingsIconButton
          label="Cancel"
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
          label={justCopied ? 'Copied' : 'Copy invite link'}
          tone={justCopied ? 'success' : 'violet'}
          onClick={() => onCopy(invite.token!, invite.id)}
        >
          {justCopied ? <CheckIcon /> : <CopyIcon />}
        </SettingsIconButton>
      )}
      <SettingsIconButton
        label="Revoke invite"
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

function ActivityTab() {
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
              <h2 className="text-[15px] font-semibold text-slate-900">Activity Log</h2>
              <p className="text-[12px] text-slate-500 mt-0.5">
                Every mutation is captured here. Append-only — entries cannot be deleted.
              </p>
            </div>
          </div>
          <span className="text-[12px] text-slate-400 num">{total} entries</span>
        </div>

        {entries.length === 0 ? (
          <div className="p-12 text-center">
            <p className="text-[14px] text-slate-500">No activity recorded yet.</p>
          </div>
        ) : (
          <table className="w-full">
            <thead className="bg-slate-50/40 border-b border-slate-100">
              <tr>
                <Th>When</Th>
                <Th>User</Th>
                <Th>Action</Th>
                <Th>Resource</Th>
                <Th>Record ID</Th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id} className="border-b border-slate-100 last:border-0 hover:bg-violet-50/40">
                  <td className="px-6 py-3 text-[12px] text-slate-500 num whitespace-nowrap">
                    {new Date(entry.createdAt).toLocaleString('en-GB', {
                      day: '2-digit', month: 'short', year: 'numeric',
                      hour: '2-digit', minute: '2-digit',
                    })}
                  </td>
                  <td className="px-6 py-3 text-[13px] text-slate-700">
                    {entry.user?.fullName ?? <span className="text-slate-400">—</span>}
                  </td>
                  <td className="px-6 py-3">
                    <span className={cn('inline-block text-[11px] font-medium px-2 py-0.5 rounded-md uppercase tracking-wider', ACTION_COLOR[entry.action] ?? 'bg-slate-100 text-slate-700')}>
                      {entry.action}
                    </span>
                  </td>
                  <td className="px-6 py-3 text-[13px] text-slate-700">
                    {TABLE_LABEL[entry.tableName] ?? entry.tableName}
                  </td>
                  <td className="px-6 py-3 text-[11px] text-slate-400 num truncate max-w-[180px]">
                    {entry.recordId.slice(0, 8)}…
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="px-6 py-3 border-t border-slate-100 flex items-center justify-between text-[12px]">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="text-violet-600 hover:text-violet-700 disabled:opacity-40 disabled:cursor-not-allowed font-medium"
            >
              ← Previous
            </button>
            <span className="text-slate-500 num">Page {page} of {totalPages}</span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="text-violet-600 hover:text-violet-700 disabled:opacity-40 disabled:cursor-not-allowed font-medium"
            >
              Next →
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
  return (
    <div className="inline-flex bg-slate-100 rounded-lg p-1 w-full">
      <SegmentButton active={value === 'derived'} onClick={() => onChange('derived')}>
        Derived from roster
      </SegmentButton>
      <SegmentButton active={value === 'manual'} onClick={() => onChange('manual')}>
        Manual input
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
