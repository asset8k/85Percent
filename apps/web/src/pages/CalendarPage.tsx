import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { Card } from '@/components/ui/card'
import { CalendarSkeleton } from '@/components/ui/page-skeletons'
import { api } from '@/lib/api'
import { useWorkspaceCurrency } from '@/lib/useWorkspaceCurrency'
import type { PlayerWithContract } from '@headroom/shared'
import type { ComplianceStatus } from '@headroom/shared'
import { useClubStore } from '@/stores/club'
import { computeActiveBaseline } from '@/lib/scr'
import {
  useSeasonStore,
  seasonLabel,
  seasonEndYear,
  isExpiringInSeasonView,
} from '@/stores/season'

// ---------------------------------------------------------------------------
// Compliance calendar (MVP 2.1) — season-aware, interactive, data-dense.
//
// Fixed EFL regulatory dates derive their year from the active season (the
// fiscal year runs 1 Jul → 30 Jun). Beyond static dates the timeline now acts
// like a working compliance dashboard:
//   • COMPLIANCE TEST nodes surface the club's live Projected SCR (colour-coded).
//   • CHECKPOINT / DEADLINE nodes carry a Pending/Completed status toggle
//     (local state for now) that dims the card + greens the timeline dot.
//   • A dynamic "Contracts Expiring" node (from the live roster) opens a
//     side-drawer with the affected players.
// ---------------------------------------------------------------------------

type EventKind = 'checkpoint' | 'compliance' | 'window' | 'deadline' | 'expiry'

interface TimelineEvent {
  id: string
  /** UTC ms — the single source of truth for chronological ordering. */
  ts: number
  dateLabel: string
  kind: EventKind
  name: string
  desc: string
  key?: boolean
  /** Present on the dynamic expiry node — drives the clickable side-drawer. */
  expiringPlayers?: PlayerWithContract[]
}

const KIND_META: Record<EventKind, { label: string; cls: string }> = {
  checkpoint: { label: 'CHECKPOINT',      cls: 'bg-slate-100 text-slate-600' },
  compliance: { label: 'COMPLIANCE TEST', cls: 'bg-violet-100 text-violet-700' },
  window:     { label: 'TRANSFER WINDOW', cls: 'bg-blue-100 text-blue-700' },
  deadline:   { label: 'DEADLINE',        cls: 'bg-amber-100 text-amber-700' },
  expiry:     { label: 'CONTRACTS',       cls: 'bg-rose-100 text-rose-700' },
}

// Status-tinted styles for the Projected SCR pill, matching the app's
// Green/Amber/Red thresholds (the same palette as StatusBadge / the SCR pill).
const STATUS_PILL: Record<ComplianceStatus, string> = {
  green: 'bg-green-50 text-green-700 ring-green-200',
  amber: 'bg-amber-50 text-amber-700 ring-amber-200',
  red:   'bg-red-50 text-red-700 ring-red-200',
}
const STATUS_LABEL: Record<ComplianceStatus, string> = {
  green: 'Compliant',
  amber: 'Levy Zone',
  red:   'Points Risk',
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

// Format a UTC date as "01 Jul 2026".
function fmtDate(d: Date): string {
  return `${String(d.getUTCDate()).padStart(2, '0')} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

function utc(year: number, month0: number, day: number): { ts: number; label: string } {
  const d = new Date(Date.UTC(year, month0, day))
  return { ts: d.getTime(), label: fmtDate(d) }
}

// The fixed EFL regulatory timeline for a fiscal season, with years derived
// from the start year. Summer/autumn dates sit in the start year; Jan→Jun
// dates roll into the following calendar year. IDs are role-based (no year) so
// the Pending/Completed toggle reads naturally; state is reset per season.
function buildFixedEvents(startYear: number): TimelineEvent[] {
  const end = seasonEndYear(startYear)
  const label = seasonLabel(startYear)
  const nextLabel = seasonLabel(end)
  const mk = (
    id: string,
    p: { ts: number; label: string },
    kind: EventKind,
    name: string,
    desc: string,
    key?: boolean,
  ): TimelineEvent => ({ id, ts: p.ts, dateLabel: p.label, kind, name, desc, key })

  return [
    mk('summer-open',    utc(startYear, 6, 1),  'window',     'Summer Transfer Window Opens', 'Domestic transfers between EFL clubs now permitted.'),
    mk('summer-deadline',utc(startYear, 8, 1),  'deadline',   'Summer Window Deadline', 'Final day for permanent transfers in the summer window.'),
    mk('q1-recon',       utc(startYear, 8, 30), 'checkpoint', 'Q1 Squad Cost Reconciliation', 'Internal reconciliation of squad costs against budget. No filing required.'),
    mk('jan-open',       utc(end, 0, 1),        'window',     'January Transfer Window Opens', 'Mid-season window — most simulation activity occurs here.'),
    mk('jan-deadline',   utc(end, 0, 31),       'deadline',   'January Window Deadline', 'Final day for January transfers. SCR exposure locks in for the second half-season.'),
    mk('main-scr',       utc(end, 2, 1),        'compliance', 'Main SCR Compliance Test', 'Primary regulatory checkpoint. Clubs must demonstrate squad costs are within the calculated threshold.', true),
    mk('pre-end-review', utc(end, 3, 15),       'checkpoint', 'Pre-Season-End Position Review', 'EFL provisional review of clubs trending toward breach.'),
    mk('accounts-cutoff',utc(end, 4, 31),       'deadline',   'Season End — Accounts Cutoff', `Fiscal close for the ${label} squad cost calculation period.`),
    mk('accounts-confirm',utc(end, 5, 15),      'compliance', 'Accounts Confirmation Test', 'Final audited submission. Sanctions confirmed for the season just ended.', true),
    mk('next-summer-open',utc(end, 6, 1),       'window',     `Summer Transfer Window Opens (${nextLabel})`, `Beginning of the ${nextLabel} cycle.`),
  ]
}

export function CalendarPage() {
  const startYear = useSeasonStore((s) => s.startYear)
  const { financials, scenarios } = useClubStore()
  const [roster, setRoster] = useState<PlayerWithContract[]>([])
  const [loading, setLoading] = useState(true)
  const [drawerPlayers, setDrawerPlayers] = useState<PlayerWithContract[] | null>(null)

  // Locally-tracked completed checkpoint/deadline nodes (DB wiring comes later).
  // Reset when the season changes — checkpoints are per-season events.
  const [completedIds, setCompletedIds] = useState<Set<string>>(new Set())
  useEffect(() => { setCompletedIds(new Set()) }, [startYear])
  const toggleCompleted = (id: string) =>
    setCompletedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    api.roster
      .list()
      .then((r) => { if (!cancelled) setRoster(r.players) })
      .catch(() => { if (!cancelled) setRoster([]) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  // Live Projected SCR from global state — the same Active Baseline the TopBar
  // pill uses (Settings financials + included scenarios).
  const projected = useMemo(
    () => (financials ? computeActiveBaseline(financials, scenarios) : null),
    [financials, scenarios],
  )

  // Players whose current active contract expires inside the active season's
  // view window. For the upcoming season this also includes deals lapsing in
  // the run-up before 1 July (e.g. a 30 June expiry), so the calendar matches
  // the expiry notifications instead of silently dropping imminent ones.
  const expiringPlayers = useMemo(
    () =>
      roster
        .filter((p) => p.isActive && p.contract && isExpiringInSeasonView(p.contract.endDate, startYear))
        .sort((a, b) => (a.contract!.endDate < b.contract!.endDate ? -1 : 1)),
    [roster, startYear],
  )

  // Merge the fixed timeline with dynamic expiry nodes. Players are grouped by
  // their exact expiry date so each date gets its own node positioned
  // chronologically — rather than lumping everyone onto the earliest date.
  const events = useMemo(() => {
    const list = buildFixedEvents(startYear)
    const byDate = new Map<string, PlayerWithContract[]>()
    for (const p of expiringPlayers) {
      const key = p.contract!.endDate.slice(0, 10)
      const group = byDate.get(key)
      if (group) group.push(p)
      else byDate.set(key, [p])
    }
    for (const [date, group] of byDate) {
      const d = new Date(date + 'T00:00:00Z')
      list.push({
        id: `expiry-${date}`,
        ts: d.getTime(),
        dateLabel: fmtDate(d),
        kind: 'expiry',
        name: `${group.length} Contract${group.length === 1 ? '' : 's'} Expiring`,
        desc: `${group.length === 1 ? 'A squad member’s contract reaches' : 'Squad members’ contracts reach'} expiry on this date. Click to review who, and plan renewals or replacements.`,
        expiringPlayers: group,
      })
    }
    return list.sort((a, b) => a.ts - b.ts)
  }, [startYear, expiringPlayers])

  if (loading) return <CalendarSkeleton />

  return (
    <div>
      <div className="mb-2 flex items-center gap-3">
        <span className="inline-block w-1.5 h-7 rounded-full bg-violet-600" />
        <div>
          <h1 className="text-[24px] font-bold text-slate-900 tracking-tight leading-none">
            Compliance Calendar {seasonLabel(startYear)}
          </h1>
          <p className="text-[13px] text-slate-400 mt-1.5 italic">
            EFL Championship — Key regulatory dates. Confirm against the official EFL Handbook when published.
          </p>
        </div>
      </div>

      <div className="mt-8 relative">
        {/* Connecting line */}
        <div className="absolute top-2 bottom-2 w-px bg-slate-200" style={{ left: 134 }} />
        <ul className="space-y-4">
          {events.map((ev) => {
            const meta = KIND_META[ev.kind]
            const isExpiry = ev.kind === 'expiry'
            const isCompliance = ev.kind === 'compliance'
            const togglable = ev.kind === 'checkpoint' || ev.kind === 'deadline'
            const completed = togglable && completedIds.has(ev.id)

            const dotColor = completed
              ? 'border-green-500'
              : isExpiry
              ? 'border-rose-500'
              : ev.key
              ? 'border-violet-600'
              : 'border-slate-300'

            return (
              <li key={ev.id} className="flex items-start gap-0">
                <div className="w-[120px] flex-shrink-0 pt-5">
                  <div className="num text-[13px] text-slate-500">{ev.dateLabel}</div>
                </div>
                <div className="relative flex-shrink-0" style={{ width: 28 }}>
                  <span
                    className={`absolute left-1/2 top-7 -translate-x-1/2 w-3 h-3 rounded-full border-[2.5px] bg-white transition-colors ${dotColor}`}
                  />
                </div>

                {isExpiry ? (
                  <button
                    type="button"
                    onClick={() => setDrawerPlayers(ev.expiringPlayers ?? [])}
                    className="flex-1 text-left group"
                    aria-label={`Review ${ev.name}`}
                  >
                    <Card className="p-5 border-l-4 border-l-rose-500 transition-shadow group-hover:shadow-md cursor-pointer">
                      <div className="flex items-center gap-2 mb-2">
                        <KindTag meta={meta} />
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold tracking-wider whitespace-nowrap bg-rose-500 text-white">
                          FROM YOUR ROSTER
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <h3 className="text-[15px] font-semibold text-slate-900">{ev.name}</h3>
                          <p className="text-[13px] text-slate-500 mt-1.5 leading-relaxed">{ev.desc}</p>
                        </div>
                        <span className="flex-shrink-0 inline-flex items-center gap-1 text-[12.5px] font-medium text-rose-600 group-hover:text-rose-700">
                          Review
                          <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M5 12h14" /><path d="M13 6l6 6-6 6" />
                          </svg>
                        </span>
                      </div>
                    </Card>
                  </button>
                ) : (
                  <Card
                    className={`flex-1 p-5 transition-opacity ${ev.key ? 'border-l-4 border-l-violet-600' : ''} ${
                      completed ? 'opacity-60' : ''
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-2">
                      <KindTag meta={meta} />
                      {ev.key && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold tracking-wider whitespace-nowrap bg-violet-600 text-white">
                          KEY DATE
                        </span>
                      )}
                    </div>

                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <h3 className="text-[15px] font-semibold text-slate-900">{ev.name}</h3>
                        <p className="text-[13px] text-slate-500 mt-1.5 leading-relaxed">{ev.desc}</p>
                      </div>

                      {/* COMPLIANCE TEST → live Projected SCR pill */}
                      {isCompliance && <ProjectedSCRPill projected={projected} />}

                      {/* CHECKPOINT / DEADLINE → Pending/Completed toggle */}
                      {togglable && (
                        <StatusToggle completed={completed} onToggle={() => toggleCompleted(ev.id)} />
                      )}
                    </div>
                  </Card>
                )}
              </li>
            )
          })}
        </ul>
      </div>

      <ExpiringContractsDrawer
        players={drawerPlayers}
        seasonLabel={seasonLabel(startYear)}
        onClose={() => setDrawerPlayers(null)}
      />
    </div>
  )
}

function KindTag({ meta }: { meta: { label: string; cls: string } }) {
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-[10px] font-medium tracking-wider whitespace-nowrap ${meta.cls}`}>
      {meta.label}
    </span>
  )
}

// Projected SCR metric pill, aligned right inside a compliance node. Pulls the
// club's live Active Baseline and colour-codes by threshold status.
function ProjectedSCRPill({ projected }: { projected: ReturnType<typeof computeActiveBaseline> | null }) {
  if (!projected) {
    return (
      <div className="flex-shrink-0 text-right">
        <div className="meta-label text-slate-400">Projected SCR</div>
        <div className="num text-[15px] font-semibold text-slate-400 mt-1">—</div>
        <div className="text-[11px] text-slate-400 mt-0.5">Set up financials</div>
      </div>
    )
  }
  const pct = projected.ratio * 100
  const status = projected.status
  return (
    <div className="flex-shrink-0 text-right">
      <div className="meta-label text-slate-400 mb-1">Projected SCR</div>
      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full ring-1 ${STATUS_PILL[status]}`}>
        <span className={`inline-block w-1.5 h-1.5 rounded-full ${status === 'green' ? 'bg-green-500' : status === 'amber' ? 'bg-amber-500' : 'bg-red-500'}`} />
        <span className="num text-[15px] font-semibold tabular-nums">{pct.toFixed(1)}%</span>
      </span>
      <div className="text-[11px] text-slate-400 mt-1">{STATUS_LABEL[status]}</div>
    </div>
  )
}

// Pending ↔ Completed toggle. Subtle pill styled in the kit; clicking flips the
// state (which dims the card + greens the timeline dot in the parent).
function StatusToggle({ completed, onToggle }: { completed: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={completed}
      className={`flex-shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[12px] font-medium ring-1 transition-colors ${
        completed
          ? 'bg-green-50 text-green-700 ring-green-200 hover:bg-green-100'
          : 'bg-slate-50 text-slate-500 ring-slate-200 hover:bg-slate-100'
      }`}
    >
      {completed ? (
        <svg width={13} height={13} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 6L9 17l-5-5" />
        </svg>
      ) : (
        <span className="inline-block w-1.5 h-1.5 rounded-full bg-slate-400" />
      )}
      {completed ? 'Completed' : 'Pending'}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Side-drawer — lists the players whose contracts expire this season.
// Right-anchored, full-height; styled to match the kit modal header.
// ---------------------------------------------------------------------------

const POSITION_META: Record<string, { label: string; cls: string }> = {
  GK:  { label: 'GK',  cls: 'bg-amber-100 text-amber-700' },
  DEF: { label: 'DEF', cls: 'bg-blue-100 text-blue-700' },
  MID: { label: 'MID', cls: 'bg-green-100 text-green-700' },
  FWD: { label: 'FWD', cls: 'bg-rose-100 text-rose-700' },
}

function fmtExpiry(iso: string): string {
  const d = new Date(iso.slice(0, 10) + 'T00:00:00Z')
  return fmtDate(d)
}

function ExpiringContractsDrawer({
  players,
  seasonLabel: label,
  onClose,
}: {
  players: PlayerWithContract[] | null
  seasonLabel: string
  onClose: () => void
}) {
  const { format: fmtMoney } = useWorkspaceCurrency()
  // ESC dismiss
  useEffect(() => {
    if (!players) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [players, onClose])

  return createPortal(
    <AnimatePresence>
      {players && (
        <motion.div
          key="drawer-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="Contracts expiring this season"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-0 z-50 flex justify-end bg-slate-900/40 backdrop-blur-[2px]"
          onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
        >
          <motion.div
            initial={{ x: 32, opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: 32, opacity: 0, transition: { duration: 0.14 } }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="h-full w-full max-w-[420px] bg-white border-l border-slate-200 shadow-2xl flex flex-col"
          >
            <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
              <div>
                <h2 className="text-[16px] font-semibold text-slate-900">Contracts Expiring</h2>
                <p className="text-[12px] text-slate-500 mt-0.5">
                  {players.length} {players.length === 1 ? 'player' : 'players'} · {label} season
                </p>
              </div>
              <button
                onClick={onClose}
                aria-label="Close"
                className="text-slate-400 hover:text-slate-700 p-1 -m-1 rounded transition-colors"
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 6L6 18" /><path d="M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2.5">
              {players.length === 0 ? (
                <p className="text-[13px] text-slate-400 text-center py-10">No contracts expire this season.</p>
              ) : (
                players.map((p) => {
                  const pos = p.position ? POSITION_META[p.position] : null
                  const weekly = p.contract ? Math.round(p.contract.annualWagePence / 52) : 0
                  return (
                    <div key={p.id} className="flex items-center gap-3 rounded-xl border border-slate-200 px-3.5 py-3">
                      <span className={`flex-shrink-0 inline-flex items-center justify-center w-9 h-9 rounded-full text-[11px] font-semibold ${pos ? pos.cls : 'bg-slate-100 text-slate-500'}`}>
                        {pos ? pos.label : '—'}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-[14px] font-medium text-slate-900 truncate">{p.name}</span>
                          {p.squadNumber != null && (
                            <span className="num text-[11px] text-slate-400">#{p.squadNumber}</span>
                          )}
                        </div>
                        <div className="text-[12px] text-slate-500 mt-0.5">
                          Expires <span className="num text-slate-700">{p.contract ? fmtExpiry(p.contract.endDate) : '—'}</span>
                        </div>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <div className="num text-[13px] font-medium text-slate-900">{fmtMoney(p.contract?.annualWagePence ?? 0)}</div>
                        <div className="num text-[11px] text-slate-400">{fmtMoney(weekly)}/wk</div>
                      </div>
                    </div>
                  )
                })
              )}
            </div>

            <div className="px-5 py-3.5 border-t border-slate-100 bg-slate-50/40">
              <p className="text-[11.5px] text-slate-400 leading-relaxed">
                Wages shown are the current annual figures. Plan renewals from the Roster, or model replacements in Scenarios.
              </p>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  )
}
