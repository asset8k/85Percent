/**
 * OnboardingPage — friction-free identity selection (MVP 2.0).
 *
 * Two-step wizard:
 *   1. League — pick Premier League or EFL Championship.
 *   2. Club   — searchable grid pulled from our LOCAL template cache
 *               (GET /onboarding/clubs). Selecting one and confirming clones
 *               the cached squad into the tenant's active roster
 *               (POST /onboarding/complete) and adopts the club identity.
 *
 * Wages are intentionally absent from templates, so the Roster page surfaces
 * the zero-wage rows as validation errors right after landing.
 *
 * This file is presentation-only over that flow — the state machine, the
 * `replacing` logic and the API calls are unchanged.
 */

import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence, LayoutGroup } from 'framer-motion'
import { api, type OnboardingClub } from '@/lib/api'
import { useClubStore } from '@/stores/club'
import { useCan } from '@/lib/role'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { toast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'

type LeagueId = 'premier-league' | 'efl-championship'
// Teaser leagues on the European-expansion roadmap — non-selectable for now.
type TeaserLeagueId = 'la-liga' | 'serie-a'

interface LeagueMeta {
  id: LeagueId | TeaserLeagueId
  name: string
  tagline: string
  count: number
  logo: string // bundled crest in /public/leagues
  grad: string // accent-bar gradient
  // Roadmap teaser: rendered muted + non-clickable with a "Coming Soon" badge.
  comingSoon?: boolean
}

const LEAGUES: LeagueMeta[] = [
  {
    id: 'premier-league',
    name: 'Premier League',
    tagline: 'Top flight · SCR + the three SSR tests',
    count: 20,
    logo: '/leagues/premier-league.png',
    grad: 'from-violet-600 to-fuchsia-600',
  },
  {
    id: 'efl-championship',
    name: 'EFL Championship',
    tagline: 'Second tier · SCR + owner-equity allowance',
    count: 24,
    logo: '/leagues/championship.png',
    grad: 'from-sky-600 to-blue-700',
  },
  // ── European expansion roadmap (teasers — not yet selectable) ──────────────
  {
    id: 'la-liga',
    name: 'La Liga',
    tagline: 'Top flight · LCPD cost controls & squad caps',
    count: 20,
    logo: '/leagues/la-liga.png',
    grad: 'from-orange-500 to-red-600',
    comingSoon: true,
  },
  {
    id: 'serie-a',
    name: 'Serie A',
    tagline: 'Top flight · FIGC liquidity & sustainability checks',
    count: 20,
    logo: '/leagues/serie-a.png',
    grad: 'from-green-600 to-emerald-700',
    comingSoon: true,
  },
]

export function OnboardingPage() {
  const navigate = useNavigate()
  const can = useCan()
  const { clubId, setClub } = useClubStore()

  const [step, setStep] = useState<1 | 2>(1)
  const [leagueId, setLeagueId] = useState<LeagueId | null>(null)
  const [clubs, setClubs] = useState<OnboardingClub[]>([])
  const [loadingClubs, setLoadingClubs] = useState(false)
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  // How many players the club already has. >0 means this is a CHANGE (the
  // existing squad gets wiped and replaced), not a first-time pre-fill.
  const [existingCount, setExistingCount] = useState(0)

  useEffect(() => {
    api.roster
      .list()
      .then((r) => setExistingCount(r.players.length))
      .catch(() => { /* non-fatal — treat as first-time onboarding */ })
  }, [])

  const replacing = existingCount > 0

  const chooseLeague = async (id: LeagueId) => {
    setLeagueId(id)
    setStep(2)
    setSelectedId(null)
    setSearch('')
    setError('')
    setLoadingClubs(true)
    try {
      const { clubs } = await api.onboarding.clubs(id)
      setClubs(clubs)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load clubs')
      setClubs([])
    } finally {
      setLoadingClubs(false)
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return clubs
    return clubs.filter((c) => c.name.toLowerCase().includes(q))
  }, [clubs, search])

  const selected = clubs.find((c) => c.id === selectedId) ?? null

  const complete = async () => {
    if (!selectedId) return
    setSubmitting(true)
    setError('')
    try {
      const res = await api.onboarding.complete(selectedId, replacing)
      if (clubId) setClub(clubId, res.club.name, res.club.leagueId, res.club.logoUrl, res.club.baseCurrency)
      toast.success(
        replacing ? 'Club changed' : 'Squad pre-filled',
        `${res.playersCreated} players imported for ${res.club.name}. Add their wages to finish.`,
      )
      navigate('/roster')
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Failed to complete onboarding'
      setError(msg)
      toast.error('Onboarding failed', msg)
      setSubmitting(false)
    }
    // On success we navigate away, so leave `submitting` true to keep the
    // importing overlay up until the route changes (no flicker back to the grid).
  }

  if (!can.switchLeague) {
    return (
      <div className="max-w-xl mx-auto">
        <Card className="p-10 text-center">
          <p className="text-[15px] font-medium text-slate-900">Onboarding is CFO-only</p>
          <p className="text-[13px] text-slate-500 mt-2">
            Ask a CFO on your team to select your club, or build the roster manually on the
            Roster page.
          </p>
          <Button variant="secondary" className="mt-5" onClick={() => navigate('/roster')}>
            Go to Roster
          </Button>
        </Card>
      </div>
    )
  }

  // The import is taking over the screen — communicate the squad being built.
  if (submitting && selected) {
    return (
      <div className="max-w-3xl mx-auto">
        <ImportingState club={selected} replacing={replacing} />
      </div>
    )
  }

  return (
    <div className="max-w-3xl mx-auto">
      {/* Welcome header */}
      <div className="text-center mb-7">
        <h1 className="text-[26px] font-bold text-slate-900 tracking-tight">
          {replacing ? 'Change your club' : 'Set up your club'}
        </h1>
        <p className="text-[13.5px] text-slate-500 mt-2 max-w-md mx-auto leading-relaxed">
          Pick your club and we’ll instantly pre-fill the squad — players, positions, shirt numbers
          and contracts. You just add the wages.
        </p>
      </div>

      {/* Stepper */}
      <div className="flex items-center justify-center gap-2.5 mb-7">
        <StepDot n={1} label="League" active={step === 1} done={step > 1} onClick={() => setStep(1)} />
        <span className={cn('h-px w-10 transition-colors', step > 1 ? 'bg-violet-300' : 'bg-slate-200')} />
        <StepDot n={2} label="Club" active={step === 2} done={false} />
      </div>

      {replacing && (
        <div className="mb-5 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <WarnIcon />
          <p className="text-[12.5px] text-amber-900 leading-relaxed">
            Changing your club <span className="font-medium">wipes your current {existingCount}-player squad</span>{' '}
            (players, contracts and head coach) and replaces it with the club you pick. Your financial
            settings are kept.
          </p>
        </div>
      )}

      {error && (
        <Card className="p-4 mb-4 border-red-200 bg-red-50">
          <p className="text-[13px] text-red-700">{error}</p>
        </Card>
      )}

      <AnimatePresence mode="wait">
        {step === 1 ? (
          <motion.div
            key="league"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="grid grid-cols-1 sm:grid-cols-2 gap-4"
          >
            {LEAGUES.map((l) => (
              <LeagueCard
                key={l.id}
                league={l}
                selected={leagueId === l.id}
                onChoose={l.comingSoon ? undefined : () => chooseLeague(l.id as LeagueId)}
              />
            ))}
          </motion.div>
        ) : (
          <motion.div
            key="club"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            {/* Toolbar: back + search + count */}
            <div className="flex items-center gap-3 mb-4">
              <button
                onClick={() => setStep(1)}
                className="inline-flex items-center gap-1 text-[13px] font-medium text-slate-500 hover:text-slate-900 transition-colors"
              >
                <BackIcon /> Back
              </button>
              <div className="relative flex-1 max-w-xs">
                <SearchIcon />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search clubs…"
                  className="w-full h-9 pl-9 pr-3 text-sm rounded-lg border border-slate-200 bg-white shadow-sm placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:border-transparent"
                />
              </div>
              {!loadingClubs && clubs.length > 0 && (
                <span className="text-[12px] text-slate-400 num">
                  {filtered.length} {filtered.length === 1 ? 'club' : 'clubs'}
                </span>
              )}
            </div>

            {loadingClubs ? (
              <ClubGridSkeleton />
            ) : clubs.length === 0 ? (
              <Card className="p-10 text-center">
                <p className="text-[15px] font-medium text-slate-900">No clubs cached yet</p>
                <p className="text-[13px] text-slate-500 mt-2 max-w-sm mx-auto">
                  The roster library for this league hasn’t been synced. Run the monthly template
                  sync, or build your squad manually on the Roster page.
                </p>
                <Button variant="secondary" className="mt-5" onClick={() => navigate('/roster')}>
                  Build manually
                </Button>
              </Card>
            ) : filtered.length === 0 ? (
              <Card className="p-10 text-center">
                <p className="text-[14px] font-medium text-slate-900">No clubs match “{search.trim()}”</p>
                <p className="text-[13px] text-slate-500 mt-1.5">Try a different spelling.</p>
              </Card>
            ) : (
              <LayoutGroup>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 pb-28">
                  {filtered.map((c) => (
                    <ClubTile
                      key={c.id}
                      club={c}
                      selected={selectedId === c.id}
                      onSelect={() => setSelectedId(c.id === selectedId ? null : c.id)}
                    />
                  ))}
                </div>
              </LayoutGroup>
            )}

            {/* Sticky confirm bar */}
            <AnimatePresence>
              {selected && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 10 }}
                  transition={{ duration: 0.16 }}
                  className="sticky bottom-4 mt-5 flex items-center justify-between gap-4 rounded-2xl border border-violet-200 bg-white/95 backdrop-blur px-4 py-3 shadow-[0_8px_30px_rgba(76,29,149,0.12)]"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <ClubAvatar club={selected} size={36} />
                    <div className="min-w-0">
                      <p className="text-[14px] font-semibold text-slate-900 truncate">{selected.name}</p>
                      <p className="text-[12px] text-slate-500">
                        {replacing
                          ? `Replaces your ${existingCount}-player squad · wages start at £0`
                          : 'Pre-fills the full squad · wages start at £0'}
                      </p>
                    </div>
                  </div>
                  <Button size="lg" onClick={complete} disabled={submitting} className="flex-shrink-0">
                    {replacing ? 'Replace squad' : 'Pre-fill squad'}
                    <ArrowIcon />
                  </Button>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ---------------------------------------------------------------------------

function LeagueCard({ league, selected, onChoose }: { league: LeagueMeta; selected: boolean; onChoose?: () => void }) {
  // Roadmap teaser — non-interactive, desaturated, badged "Coming Soon". Renders
  // as a plain div (no button semantics) so it can't be clicked or focused, and
  // the whole card is dimmed with the UI Kit opacity utility.
  if (league.comingSoon) {
    return (
      <div
        aria-disabled="true"
        className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-6 text-left opacity-60"
      >
        {/* accent bar */}
        <span className={cn('absolute inset-x-0 top-0 h-1 bg-gradient-to-r', league.grad)} />

        <div className="flex items-start justify-between">
          <img
            src={league.logo}
            alt={`${league.name} logo`}
            className="h-14 w-auto object-contain"
          />
          <span className="rounded-full bg-slate-100 text-slate-600 text-[11px] font-medium px-2.5 py-1 num">
            {league.count} clubs
          </span>
        </div>

        <p className="mt-4 text-[17px] font-bold text-slate-900">{league.name}</p>
        <p className="mt-1 text-[12.5px] text-slate-500">{league.tagline}</p>

        <span className="mt-5 inline-flex items-center gap-1.5 rounded-full bg-slate-100 text-slate-500 text-[11px] font-semibold px-2.5 py-1">
          <LockIcon />
          Coming Soon
        </span>
      </div>
    )
  }

  return (
    <button
      type="button"
      onClick={onChoose}
      className={cn(
        'group relative overflow-hidden rounded-2xl border bg-white p-6 text-left transition-all duration-150',
        'hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500',
        selected ? 'border-violet-400 ring-1 ring-violet-200' : 'border-slate-200 hover:border-violet-300',
      )}
    >
      {/* accent bar */}
      <span className={cn('absolute inset-x-0 top-0 h-1 bg-gradient-to-r', league.grad)} />

      <div className="flex items-start justify-between">
        <img
          src={league.logo}
          alt={`${league.name} logo`}
          className="h-14 w-auto object-contain"
        />
        <span className="rounded-full bg-slate-100 text-slate-600 text-[11px] font-medium px-2.5 py-1 num">
          {league.count} clubs
        </span>
      </div>

      <p className="mt-4 text-[17px] font-bold text-slate-900">{league.name}</p>
      <p className="mt-1 text-[12.5px] text-slate-500">{league.tagline}</p>

      <span className="mt-5 inline-flex items-center gap-1.5 text-[13px] font-semibold text-violet-600 transition-all group-hover:gap-2.5">
        Choose this league
        <ArrowIcon />
      </span>
    </button>
  )
}

function ClubTile({
  club,
  selected,
  onSelect,
}: {
  club: OnboardingClub
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'relative flex flex-col items-center gap-3 rounded-xl border bg-white px-3 py-5 text-center transition-all duration-150',
        'hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500',
        selected ? 'border-violet-500 ring-2 ring-violet-200 shadow-sm' : 'border-slate-200 hover:border-violet-300',
      )}
    >
      {selected && (
        <motion.span
          layoutId="club-check"
          className="absolute top-2 right-2 inline-flex h-5 w-5 items-center justify-center rounded-full bg-violet-600 text-white shadow"
        >
          <CheckIcon />
        </motion.span>
      )}
      <ClubAvatar club={club} size={52} />
      <span className="text-[12.5px] font-medium text-slate-800 leading-tight line-clamp-2">
        {club.name}
      </span>
    </button>
  )
}

function ClubGridSkeleton() {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
      {Array.from({ length: 12 }).map((_, i) => (
        <div key={i} className="flex flex-col items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-5">
          <span className="h-[52px] w-[52px] rounded-full bg-slate-100 animate-pulse" />
          <span className="h-3 w-16 rounded bg-slate-100 animate-pulse" />
        </div>
      ))}
    </div>
  )
}

// The "squad being built" moment — shown while POST /onboarding/complete runs,
// then the route changes to /roster. A short staged checklist makes the import
// feel tangible even though it's a single request.
function ImportingState({ club, replacing }: { club: OnboardingClub; replacing: boolean }) {
  const steps = ['Importing players & positions', 'Building contracts & book values', 'Finishing up your squad']
  return (
    <Card className="p-12 text-center">
      <div className="relative inline-flex items-center justify-center">
        <span className="absolute inline-flex h-24 w-24 rounded-full bg-violet-200/50 animate-ping" />
        <span className="relative inline-flex h-20 w-20 items-center justify-center rounded-full bg-violet-50 ring-1 ring-violet-100">
          <ClubAvatar club={club} size={48} />
        </span>
      </div>

      <p className="mt-6 text-[17px] font-bold text-slate-900">
        {replacing ? 'Replacing your squad…' : `Pre-filling ${club.name}`}
      </p>
      <p className="mt-1.5 text-[13px] text-slate-500">This only takes a moment.</p>

      <div className="mt-7 mx-auto max-w-xs space-y-2.5 text-left">
        {steps.map((s, i) => (
          <motion.div
            key={s}
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.15 + i * 0.5, duration: 0.25 }}
            className="flex items-center gap-2.5 text-[13px] text-slate-600"
          >
            <Spinner size={13} />
            <span>{s}</span>
          </motion.div>
        ))}
      </div>
    </Card>
  )
}

function ClubAvatar({ club, size }: { club: OnboardingClub; size: number }) {
  const initials = club.name
    .replace(/\bFC\b|\bAFC\b/gi, '')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase()

  if (club.logoUrl) {
    return (
      <img
        src={club.logoUrl}
        alt=""
        width={size}
        height={size}
        className="object-contain"
        style={{ width: size, height: size }}
        onError={(e) => {
          // Hide a broken crest URL and fall back to nothing rather than an icon.
          ;(e.currentTarget as HTMLImageElement).style.display = 'none'
        }}
      />
    )
  }
  return (
    <span
      className="inline-flex items-center justify-center rounded-full bg-violet-100 text-violet-700 font-semibold"
      style={{ width: size, height: size, fontSize: size * 0.36 }}
    >
      {initials || '⚽'}
    </span>
  )
}

function StepDot({
  n,
  label,
  active,
  done,
  onClick,
}: {
  n: number
  label: string
  active: boolean
  done: boolean
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      className={cn('inline-flex items-center gap-2', onClick ? 'cursor-pointer' : 'cursor-default')}
    >
      <span
        className={cn(
          'inline-flex h-6 w-6 items-center justify-center rounded-full text-[12px] font-semibold transition-colors',
          active ? 'bg-violet-600 text-white' : done ? 'bg-violet-100 text-violet-700' : 'bg-slate-100 text-slate-400',
        )}
      >
        {done ? <CheckIcon /> : n}
      </span>
      <span className={cn('text-[13px] font-medium', active ? 'text-slate-900' : 'text-slate-400')}>{label}</span>
    </button>
  )
}

function CheckIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  )
}

function ArrowIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </svg>
  )
}

function LockIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="11" width="18" height="11" rx="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  )
}

function BackIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="19" y1="12" x2="5" y2="12" />
      <polyline points="12 19 5 12 12 5" />
    </svg>
  )
}

function SearchIcon() {
  return (
    <svg
      className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
      width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
    >
      <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  )
}

function WarnIcon() {
  return (
    <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-400 text-white text-[12px] font-bold">
      !
    </span>
  )
}
