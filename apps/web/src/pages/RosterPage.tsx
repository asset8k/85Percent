/**
 * RosterPage — MVP 2.0 squad management.
 *
 * Two tabs: Squad (active players) and Archived. Three mutation flows:
 * (1) CSV upload — staging-area UX that validates on the server, lets the user
 *     fix errors inline, then commits the whole batch atomically.
 * (2) Manual add — single-player + contract via a modal form.
 * (3) Row click — opens an edit drawer (player + contract patch).
 *
 * Design: follows the violet/light system from the UI Kit. No new primitives;
 * relies on Card, Button, NumericInput, Spinner.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { api } from '@/lib/api'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { RosterSkeleton } from '@/components/ui/page-skeletons'
import { NumericInput } from '@/components/ui/numeric-input'
import { CountryPicker } from '@/components/ui/country-picker'
import { DatePicker } from '@/components/ui/date-picker'
import { cn } from '@/lib/utils'
import { useCan } from '@/lib/role'
import { useClubStore } from '@/stores/club'
import { exportAmortisationXLSX } from '@/lib/exports/amortisationXlsx'
import { findCountry } from '@/lib/countries'
import { Flag } from '@/components/ui/flag'
import { formatPence } from '@headroom/shared'
import type {
  PlayerWithContract,
  PlayerPosition,
  RosterStagingRow,
  ManualPlayerInput,
} from '@headroom/shared'

const POSITIONS: PlayerPosition[] = ['GK', 'DEF', 'MID', 'FWD']

// ---------------------------------------------------------------------------
// Top-level page
// ---------------------------------------------------------------------------
export function RosterPage() {
  const can = useCan()
  const { clubName, financials, setFinancials } = useClubStore()
  const [tab, setTab] = useState<'squad' | 'archived'>('squad')
  const [active, setActive] = useState<PlayerWithContract[]>([])
  const [archived, setArchived] = useState<PlayerWithContract[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Modal state
  const [csvOpen, setCsvOpen] = useState(false)
  const [manualOpen, setManualOpen] = useState(false)
  const [editPlayer, setEditPlayer] = useState<PlayerWithContract | null>(null)

  // Archived-row action state — null when no row has confirm UI open. Only
  // one player can be in confirm-delete mode at a time so the user can't fan
  // a destructive action across multiple rows accidentally.
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [pendingActionId, setPendingActionId] = useState<string | null>(null)

  // Filters (Squad tab)
  const [filter, setFilter] = useState<'all' | 'expiring' | PlayerPosition>('all')

  // Roster mutations (add / edit contract / archive / CSV commit) change the
  // server-derived `currentSquadCosts` in financials. The top-bar SCR pill,
  // Setup page squad-cost line and any scenario projections all read that
  // value from the store, so we re-fetch financials alongside the roster on
  // every refresh. Season fallback matches the bootstrap in ProtectedRoute.
  const refresh = async () => {
    setLoading(true)
    setError('')
    const season = financials?.season ?? '2026-27'
    try {
      const [a, b, f] = await Promise.all([
        api.roster.list(),
        api.roster.listArchived(),
        api.club.getFinancials(season).catch(() => null),
      ])
      setActive(a.players)
      setArchived(b.players)
      if (f) setFinancials(f)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load roster')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  const handleRestore = async (id: string) => {
    setPendingActionId(id)
    setError('')
    try {
      await api.roster.restorePlayer(id)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to restore player')
    } finally {
      setPendingActionId(null)
    }
  }

  const handleDelete = async (id: string) => {
    setPendingActionId(id)
    setError('')
    try {
      await api.roster.deletePlayer(id)
      setConfirmDeleteId(null)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete player')
    } finally {
      setPendingActionId(null)
    }
  }

  const filteredActive = useMemo(() => {
    if (filter === 'all') return active
    if (filter === 'expiring') {
      return active.filter((p) => p.monthsToExpiry != null && p.monthsToExpiry <= 6)
    }
    return active.filter((p) => p.position === filter)
  }, [active, filter])

  if (loading) return <RosterSkeleton />

  return (
    <div>
      {/* Page header */}
      <div className="mb-6 flex items-center gap-3">
        <span className="inline-block w-1.5 h-7 rounded-full bg-violet-600" />
        <div className="flex-1">
          <h1 className="text-[24px] font-bold text-slate-900 tracking-tight leading-none">
            Roster
          </h1>
          <p className="text-[13px] text-slate-500 mt-1.5">
            Your squad. Squad costs are derived from these contracts.
          </p>
        </div>
        {tab === 'squad' && (
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              onClick={() => exportAmortisationXLSX({
                clubName: clubName ?? 'Headroom FC',
                season: financials?.season ?? '2026-27',
                players: active,
              })}
              disabled={active.length === 0}
              title="Download per-player amortisation schedules as an Excel workbook"
            >
              Export Excel
            </Button>
            {can.mutateRoster && (
              <>
                <Button variant="secondary" onClick={() => setCsvOpen(true)}>
                  Upload CSV
                </Button>
                <Button onClick={() => setManualOpen(true)}>Add Player</Button>
              </>
            )}
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-6 border-b border-slate-200 mb-5">
        <TabButton active={tab === 'squad'} onClick={() => setTab('squad')}>
          Squad <span className="ml-1.5 text-[12px] text-slate-400">({active.length})</span>
        </TabButton>
        <TabButton active={tab === 'archived'} onClick={() => setTab('archived')}>
          Archived <span className="ml-1.5 text-[12px] text-slate-400">({archived.length})</span>
        </TabButton>
      </div>

      {error && (
        <Card className="p-4 mb-4 border-red-200 bg-red-50">
          <p className="text-[13px] text-red-700">{error}</p>
        </Card>
      )}

      {tab === 'squad' ? (
        <>
          {/* Filter chips */}
          <div className="flex items-center gap-2 mb-4 flex-wrap">
            <FilterChip active={filter === 'all'} onClick={() => setFilter('all')}>
              All
            </FilterChip>
            <FilterChip active={filter === 'expiring'} onClick={() => setFilter('expiring')}>
              Expiring ≤ 6 mo
            </FilterChip>
            {POSITIONS.map((pos) => (
              <FilterChip
                key={pos}
                active={filter === pos}
                onClick={() => setFilter(pos)}
              >
                {pos}
              </FilterChip>
            ))}
          </div>

          {filteredActive.length === 0 ? (
            <EmptyState
              title={active.length === 0 ? 'No players yet' : 'No players match this filter'}
              hint={
                active.length === 0
                  ? 'Upload a CSV roster or add players manually to get started.'
                  : 'Try clearing the filter to see all players.'
              }
            />
          ) : (
            <PlayerTable
              players={filteredActive}
              onRowClick={(p) => setEditPlayer(p)}
            />
          )}
        </>
      ) : (
        <>
          {archived.length === 0 ? (
            <EmptyState
              title="No archived players"
              hint="Players you archive will appear here for audit history."
            />
          ) : (
            <PlayerTable
              players={archived}
              onRowClick={() => undefined}
              archived
              canMutate={can.mutateRoster}
              confirmDeleteId={confirmDeleteId}
              pendingActionId={pendingActionId}
              onRestore={handleRestore}
              onRequestDelete={(id) => setConfirmDeleteId(id)}
              onConfirmDelete={handleDelete}
              onCancelDelete={() => setConfirmDeleteId(null)}
            />
          )}
        </>
      )}

      <AnimatePresence>
        {csvOpen && (
          <CSVUploadModal
            key="csv"
            onClose={() => setCsvOpen(false)}
            onCommitted={async () => {
              setCsvOpen(false)
              await refresh()
            }}
          />
        )}
        {manualOpen && (
          <ManualPlayerModal
            key="manual"
            onClose={() => setManualOpen(false)}
            onCreated={async () => {
              setManualOpen(false)
              await refresh()
            }}
          />
        )}
        {editPlayer && (
          <PlayerEditDrawer
            key={`edit-${editPlayer.id}`}
            player={editPlayer}
            onClose={() => setEditPlayer(null)}
            onSaved={async () => {
              setEditPlayer(null)
              await refresh()
            }}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Player table
// ---------------------------------------------------------------------------
function PlayerTable({
  players,
  onRowClick,
  archived = false,
  canMutate = false,
  confirmDeleteId = null,
  pendingActionId = null,
  onRestore,
  onRequestDelete,
  onConfirmDelete,
  onCancelDelete,
}: {
  players: PlayerWithContract[]
  onRowClick: (p: PlayerWithContract) => void
  archived?: boolean
  // Archived-only props — required when `archived` is true and the caller
  // wants to expose restore/delete affordances. Kept optional so the squad
  // tab can still mount the table without ceremony.
  canMutate?: boolean
  confirmDeleteId?: string | null
  pendingActionId?: string | null
  onRestore?: (id: string) => void
  onRequestDelete?: (id: string) => void
  onConfirmDelete?: (id: string) => void
  onCancelDelete?: () => void
}) {
  const showActions = archived && canMutate && !!onRestore && !!onRequestDelete && !!onConfirmDelete && !!onCancelDelete
  return (
    <Card className="overflow-hidden">
      <table className="w-full">
        <thead className="border-b border-slate-100">
          <tr>
            <Th>Name</Th>
            <Th>Position</Th>
            <Th align="right">Annual Wage</Th>
            <Th align="right">Book Value</Th>
            <Th>Contract End</Th>
            <Th align="right">{archived ? 'Archived' : 'To Expiry'}</Th>
            {showActions && <Th align="right">Actions</Th>}
          </tr>
        </thead>
        <tbody>
          {players.map((p) => (
            <tr
              key={p.id}
              onClick={() => onRowClick(p)}
              className={cn(
                'border-b border-slate-100 last:border-0 transition-colors',
                !archived && 'hover:bg-violet-50/60 cursor-pointer'
              )}
            >
              <td className="px-5 py-3.5 text-[14px] text-slate-900 font-medium">
                <span className="inline-flex items-center gap-2 align-middle">
                  <NationalityFlag nationality={p.nationality} />
                  <span>{p.name}</span>
                </span>
                {!archived && p.monthsToExpiry != null && p.monthsToExpiry < 0 && (
                  <span className="ml-2 inline-block text-[10px] font-medium px-1.5 py-0.5 rounded bg-red-100 text-red-700 align-middle">
                    EXPIRED
                  </span>
                )}
              </td>
              <td className="px-5 py-3.5">
                <PositionPill position={p.position} />
              </td>
              <td className="px-5 py-3.5 text-[13px] num text-right text-slate-900">
                {p.contract ? formatPence(p.contract.annualWagePence) : '—'}
              </td>
              <td className="px-5 py-3.5 text-[13px] num text-right text-slate-700">
                {p.contract ? formatPence(p.contract.bookValuePence) : '—'}
              </td>
              <td className="px-5 py-3.5 text-[13px] text-slate-500 num whitespace-nowrap">
                {p.contract ? formatDate(p.contract.endDate) : '—'}
              </td>
              <td className="px-5 py-3.5 text-right text-[12px] whitespace-nowrap">
                {archived ? (
                  <span className="text-slate-500 num">{p.archivedAt ? formatDate(p.archivedAt.slice(0, 10)) : '—'}</span>
                ) : (
                  <ExpiryChip months={p.monthsToExpiry} />
                )}
              </td>
              {showActions && (
                <td className="px-5 py-3.5 text-right text-[12px] whitespace-nowrap">
                  <ArchivedRowActions
                    playerId={p.id}
                    playerName={p.name}
                    confirmDeleteId={confirmDeleteId}
                    pendingActionId={pendingActionId}
                    onRestore={onRestore!}
                    onRequestDelete={onRequestDelete!}
                    onConfirmDelete={onConfirmDelete!}
                    onCancelDelete={onCancelDelete!}
                  />
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  )
}

// Action affordances for an archived row — Restore on its own, Delete with an
// inline two-step confirm to avoid accidental destruction. Only one row can
// be in the confirm state at a time (state held in the parent), so opening
// confirm here implicitly cancels any other row's confirm.
function ArchivedRowActions({
  playerId,
  playerName,
  confirmDeleteId,
  pendingActionId,
  onRestore,
  onRequestDelete,
  onConfirmDelete,
  onCancelDelete,
}: {
  playerId: string
  playerName: string
  confirmDeleteId: string | null
  pendingActionId: string | null
  onRestore: (id: string) => void
  onRequestDelete: (id: string) => void
  onConfirmDelete: (id: string) => void
  onCancelDelete: () => void
}) {
  const confirming = confirmDeleteId === playerId
  const pending = pendingActionId === playerId

  if (confirming) {
    return (
      <span className="inline-flex items-center gap-2 justify-end">
        <span className="text-[11px] text-slate-600 whitespace-nowrap">Delete {playerName}?</span>
        <IconButton
          label={pending ? 'Deleting…' : 'Confirm delete'}
          tone="danger"
          disabled={pending}
          onClick={() => onConfirmDelete(playerId)}
        >
          {pending ? <Spinner size={14} /> : <CheckIcon />}
        </IconButton>
        <IconButton
          label="Cancel"
          tone="neutral"
          disabled={pending}
          onClick={onCancelDelete}
        >
          <CloseIcon />
        </IconButton>
      </span>
    )
  }

  return (
    <span className="inline-flex items-center gap-1.5 justify-end">
      <IconButton
        label={pending ? 'Restoring…' : 'Restore player'}
        tone="violet"
        disabled={pending}
        onClick={() => onRestore(playerId)}
      >
        {pending ? <Spinner size={14} /> : <RestoreIcon />}
      </IconButton>
      <IconButton
        label="Delete permanently"
        tone="danger"
        disabled={pending}
        onClick={() => onRequestDelete(playerId)}
      >
        <TrashIcon />
      </IconButton>
    </span>
  )
}

// Small square icon button used inside table cells. Matches the UI Kit
// language — neutral border + subtle hover tint per tone. Accessible via
// aria-label + title (tooltip).
function IconButton({
  label,
  tone,
  disabled,
  onClick,
  children,
}: {
  label: string
  tone: 'violet' | 'danger' | 'neutral'
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  const toneClass =
    tone === 'violet'
      ? 'text-violet-600 hover:bg-violet-50 hover:border-violet-200'
      : tone === 'danger'
      ? 'text-red-600 hover:bg-red-50 hover:border-red-200'
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

// Lucide-style 16px stroke icons. Kept inline because they're only used here
// and pulling in a full icon package for two glyphs would be overkill.
function RestoreIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 12a9 9 0 1 0 3-6.7L3 8" />
      <path d="M3 3v5h5" />
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

function Th({
  children,
  align = 'left',
}: {
  children: React.ReactNode
  align?: 'left' | 'right' | 'center'
}) {
  return (
    <th
      className={cn(
        'meta-label px-5 py-3 text-left',
        align === 'right' && 'text-right',
        align === 'center' && 'text-center'
      )}
    >
      {children}
    </th>
  )
}

// Renders a sharp SVG country flag for a player's nationality. Returns null
// when the value is empty or doesn't match a known country (e.g. legacy
// free-text values) — keeps the row clean rather than showing a placeholder.
function NationalityFlag({ nationality }: { nationality: string | null }) {
  const country = findCountry(nationality)
  if (!country) return null
  return <Flag code={country.code} title={country.name} width={20} />
}

function PositionPill({ position }: { position: string | null }) {
  if (!position) {
    return <span className="text-[12px] text-slate-400">—</span>
  }
  return (
    <span className="inline-block text-[11px] font-medium px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 whitespace-nowrap">
      {position}
    </span>
  )
}

// "49" → "4 years 1 month" — years lead, months only when non-zero, singular/plural correct.
function formatExpiryLabel(months: number): string {
  const years = Math.floor(months / 12)
  const rem = months % 12
  if (years === 0) return `${rem} ${rem === 1 ? 'month' : 'months'}`
  const yearPart = `${years} ${years === 1 ? 'year' : 'years'}`
  if (rem === 0) return yearPart
  return `${yearPart} ${rem} ${rem === 1 ? 'month' : 'months'}`
}

function ExpiryChip({ months }: { months: number | null }) {
  if (months == null) return <span className="text-slate-400">—</span>
  if (months < 0) {
    return <span className="text-red-700 num">expired</span>
  }
  if (months <= 6) {
    return (
      <span className="inline-block text-[11px] font-medium px-2 py-0.5 rounded-md bg-amber-100 text-amber-700 whitespace-nowrap">
        {formatExpiryLabel(months)}
      </span>
    )
  }
  return <span className="text-slate-500 whitespace-nowrap">{formatExpiryLabel(months)}</span>
}

function formatDate(iso: string): string {
  const d = new Date(iso + (iso.length === 10 ? 'T00:00:00Z' : ''))
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

// Compute integer age in years from an ISO YYYY-MM-DD DOB.
// Returns null when the input is missing/invalid or the DOB is in the future.
function ageFromDob(iso: string): number | null {
  if (!iso) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso)
  if (!m) return null
  const y = Number(m[1]), mo = Number(m[2]) - 1, d = Number(m[3])
  const now = new Date()
  let age = now.getFullYear() - y
  // Subtract a year if the birthday hasn't occurred yet this year
  const hadBirthdayThisYear =
    now.getMonth() > mo || (now.getMonth() === mo && now.getDate() >= d)
  if (!hadBirthdayThisYear) age -= 1
  if (age < 0 || age > 120) return null
  return age
}

// ---------------------------------------------------------------------------
// Filter / tab chips
// ---------------------------------------------------------------------------
function TabButton({
  active, onClick, children,
}: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'relative pb-3 text-[14px] font-medium transition-colors',
        active ? 'text-violet-700' : 'text-slate-500 hover:text-slate-900'
      )}
    >
      {children}
      {active && <span className="absolute left-0 right-0 bottom-[-1px] h-0.5 bg-violet-600 rounded-full" />}
    </button>
  )
}

function FilterChip({
  active, onClick, children,
}: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'px-3 py-1.5 text-[12px] font-medium rounded-full border transition-colors',
        active
          ? 'border-violet-600 bg-violet-600 text-white'
          : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'
      )}
    >
      {children}
    </button>
  )
}

function EmptyState({ title, hint }: { title: string; hint: string }) {
  return (
    <Card className="p-12 text-center">
      <p className="text-[15px] font-medium text-slate-900">{title}</p>
      <p className="text-[13px] text-slate-500 mt-2">{hint}</p>
    </Card>
  )
}

// ---------------------------------------------------------------------------
// CSV Upload Modal — staging area
// ---------------------------------------------------------------------------
function CSVUploadModal({
  onClose,
  onCommitted,
}: {
  onClose: () => void
  onCommitted: () => void
}) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [parsing, setParsing] = useState(false)
  const [committing, setCommitting] = useState(false)
  const [rows, setRows] = useState<RosterStagingRow[]>([])
  const [globalError, setGlobalError] = useState('')

  const handleFile = async (file: File) => {
    setParsing(true)
    setGlobalError('')
    try {
      const text = await file.text()
      const result = await api.roster.parseCsv(text)
      setRows(result.rows)
    } catch (e) {
      setGlobalError(e instanceof Error ? e.message : 'Failed to parse CSV')
    } finally {
      setParsing(false)
    }
  }

  const allValid = rows.length > 0 && rows.every((r) => r.ok)

  const commit = async () => {
    if (!allValid) return
    setCommitting(true)
    setGlobalError('')
    try {
      // Strip the staging metadata before sending
      const payload = rows
        .filter((r) => r.ok && r.parsed)
        .map((r) => r.parsed!)
      await api.roster.commit(payload)
      onCommitted()
    } catch (e) {
      setGlobalError(e instanceof Error ? e.message : 'Failed to commit roster')
      setCommitting(false)
    }
  }

  return (
    <ModalShell onClose={onClose} title="Import roster from CSV">
      <div className="max-h-[80vh] flex flex-col">
        <div className="px-5 pb-3">
          <p className="text-[13px] text-slate-600">
            Required:{' '}
            <code className="text-[12px] bg-slate-100 px-1.5 py-0.5 rounded">
              name, position, transfer_fee_pounds, weekly_wage_pounds, agent_fee_pounds, contract_start, contract_end
            </code>
            . Optional:{' '}
            <code className="text-[12px] bg-slate-100 px-1.5 py-0.5 rounded">nationality, date_of_birth</code>
            . Dates as <code className="text-[12px] bg-slate-100 px-1.5 py-0.5 rounded">YYYY-MM-DD</code>.
          </p>
          <div className="flex items-center gap-3 mt-4">
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) handleFile(f)
              }}
              className="hidden"
            />
            <Button
              variant="outline"
              onClick={() => fileInputRef.current?.click()}
              disabled={parsing}
            >
              {parsing ? <Spinner size={14} /> : null}
              {parsing ? 'Parsing…' : rows.length > 0 ? 'Choose different file' : 'Choose CSV file'}
            </Button>
            {rows.length > 0 && (
              <span className="text-[13px] text-slate-500">
                {rows.length} rows · {rows.filter((r) => r.ok).length} valid ·{' '}
                <span className={rows.some((r) => !r.ok) ? 'text-red-600' : ''}>
                  {rows.filter((r) => !r.ok).length} errors
                </span>
              </span>
            )}
          </div>
        </div>

        {globalError && (
          <div className="px-5 pb-3">
            <div className="border border-red-200 bg-red-50 rounded-lg px-4 py-3 text-[13px] text-red-700">
              {globalError}
            </div>
          </div>
        )}

        {rows.length > 0 && (
          <div className="flex-1 overflow-auto border-t border-slate-100">
            <table className="w-full">
              <thead className="bg-slate-50 sticky top-0">
                <tr>
                  <Th>#</Th>
                  <Th>Name</Th>
                  <Th>Pos</Th>
                  <Th>DOB</Th>
                  <Th align="right">Fee (£)</Th>
                  <Th align="right">Wage £/wk</Th>
                  <Th align="right">Agent (£)</Th>
                  <Th>Start</Th>
                  <Th>End</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row, idx) => (
                  <StagingRowDisplay
                    key={idx}
                    row={row}
                    onChange={(next) => {
                      setRows((prev) => prev.map((r, i) => (i === idx ? next : r)))
                    }}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="px-5 py-4 border-t border-slate-100 flex items-center justify-end gap-3">
          <Button variant="ghost" onClick={onClose} disabled={committing}>
            Cancel
          </Button>
          <Button onClick={commit} disabled={!allValid || committing}>
            {committing ? <Spinner size={14} /> : null}
            {committing ? 'Committing…' : `Commit ${rows.filter((r) => r.ok).length} players`}
          </Button>
        </div>
      </div>
    </ModalShell>
  )
}

// ---------------------------------------------------------------------------
// Staging row — displays parsed data; inline editing limited to text/numeric
// edits via a "re-parse" callback. For brevity we expose an "Issues" tooltip
// rather than full per-field inline edit; users with errors can re-export
// from their CSV after fixing source data — keeps the surface area small.
// ---------------------------------------------------------------------------
function StagingRowDisplay({
  row,
  onChange,
}: {
  row: RosterStagingRow
  onChange: (next: RosterStagingRow) => void
}) {
  const [editing, setEditing] = useState(false)
  const p = row.parsed

  if (editing) {
    return <StagingRowEditor row={row} onClose={() => setEditing(false)} onChange={onChange} />
  }

  return (
    <tr className={cn('border-b border-slate-100 last:border-0', !row.ok && 'bg-red-50/60')}>
      <td className="px-5 py-3 text-[12px] text-slate-400 num">{row.rowIndex}</td>
      <td className="px-5 py-3 text-[13px] text-slate-900">{p?.name ?? '—'}</td>
      <td className="px-5 py-3"><PositionPill position={p?.position ?? null} /></td>
      <td className="px-5 py-3 text-[13px] text-slate-500 num">{p?.dateOfBirth ?? '—'}</td>
      <td className="px-5 py-3 text-[13px] num text-right">{p ? formatPence(p.transferFeePence) : '—'}</td>
      <td className="px-5 py-3 text-[13px] num text-right">{p ? formatPence(Math.floor(p.annualWagePence / 52)) : '—'}</td>
      <td className="px-5 py-3 text-[13px] num text-right">{p ? formatPence(p.agentFeePence) : '—'}</td>
      <td className="px-5 py-3 text-[13px] text-slate-500 num">{p?.startDate ?? '—'}</td>
      <td className="px-5 py-3 text-[13px] text-slate-500 num">
        <div className="flex items-center justify-between gap-2">
          <span>{p?.endDate ?? '—'}</span>
          {!row.ok && (
            <button
              onClick={() => setEditing(true)}
              className="text-[11px] font-medium text-violet-600 hover:text-violet-700"
            >
              Fix
            </button>
          )}
        </div>
        {!row.ok && (
          <div className="mt-1 text-[11px] text-red-700 font-normal whitespace-normal">
            {row.issues.join(' · ')}
          </div>
        )}
      </td>
    </tr>
  )
}

function StagingRowEditor({
  row,
  onClose,
  onChange,
}: {
  row: RosterStagingRow
  onClose: () => void
  onChange: (next: RosterStagingRow) => void
}) {
  // Editor seeds from existing parsed data or empty defaults
  const [name, setName] = useState(row.parsed?.name ?? '')
  const [position, setPosition] = useState<PlayerPosition>(row.parsed?.position ?? 'MID')
  const [dateOfBirth, setDateOfBirth] = useState(row.parsed?.dateOfBirth ?? '')
  const [transferPounds, setTransferPounds] = useState(row.parsed ? row.parsed.transferFeePence / 100 : NaN)
  const [weeklyWagePounds, setWeeklyWagePounds] = useState(
    row.parsed ? Math.round(row.parsed.annualWagePence / 52 / 100) : NaN
  )
  const [agentPounds, setAgentPounds] = useState(row.parsed ? row.parsed.agentFeePence / 100 : NaN)
  const [startDate, setStartDate] = useState(row.parsed?.startDate ?? '')
  const [endDate, setEndDate] = useState(row.parsed?.endDate ?? '')
  const [saving, setSaving] = useState(false)

  // Same DOB bounds as the manual modal (≤ today, ≥ 60 years ago).
  const todayISO = new Date().toISOString().slice(0, 10)
  const sixtyYearsAgoISO = (() => {
    const d = new Date()
    d.setFullYear(d.getFullYear() - 60)
    return d.toISOString().slice(0, 10)
  })()

  const save = async () => {
    setSaving(true)
    try {
      // Re-validate via the /roster/parse endpoint to ensure server-side rules apply.
      // Synthesize a one-row CSV and ask the server to validate.
      const csvText = [
        'name,position,date_of_birth,transfer_fee_pounds,weekly_wage_pounds,agent_fee_pounds,contract_start,contract_end',
        [
          csvEscape(name),
          position,
          dateOfBirth,
          isFinite(transferPounds) ? transferPounds : '',
          isFinite(weeklyWagePounds) ? weeklyWagePounds : '',
          isFinite(agentPounds) ? agentPounds : '',
          startDate,
          endDate,
        ].join(','),
      ].join('\n')
      const result = await api.roster.parseCsv(csvText)
      const next = result.rows[0]
      if (next) {
        onChange({ ...next, rowIndex: row.rowIndex })
        onClose()
      }
    } finally {
      setSaving(false)
    }
  }

  const cellInput = 'w-full px-2 py-1.5 text-[13px] rounded border border-slate-300 focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500'
  const cellNumeric = cellInput + ' text-right num'

  return (
    <tr className="bg-violet-50/40 border-b border-slate-100">
      <td className="px-5 py-3 text-[12px] text-slate-400 num">{row.rowIndex}</td>
      <td className="px-2 py-2">
        <input value={name} onChange={(e) => setName(e.target.value)} className={cellInput} />
      </td>
      <td className="px-2 py-2">
        <select value={position} onChange={(e) => setPosition(e.target.value as PlayerPosition)} className={cellInput}>
          {POSITIONS.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </td>
      <td className="px-2 py-2 align-top">
        <DatePicker
          value={dateOfBirth}
          onChange={setDateOfBirth}
          min={sixtyYearsAgoISO}
          max={todayISO}
          placeholder="DOB"
        />
      </td>
      <td className="px-2 py-2">
        <NumericInput value={transferPounds} onChange={setTransferPounds} className={cellNumeric} placeholder="0" />
      </td>
      <td className="px-2 py-2">
        <NumericInput value={weeklyWagePounds} onChange={setWeeklyWagePounds} className={cellNumeric} placeholder="0" />
      </td>
      <td className="px-2 py-2">
        <NumericInput value={agentPounds} onChange={setAgentPounds} className={cellNumeric} placeholder="0" />
      </td>
      <td className="px-2 py-2 align-top">
        <DatePicker value={startDate} onChange={setStartDate} placeholder="Start date" />
      </td>
      <td className="px-2 py-2 align-top">
        <DatePicker value={endDate} onChange={setEndDate} placeholder="End date" />
        <div className="flex items-center justify-end gap-2 mt-2">
          <button onClick={onClose} className="text-[12px] text-slate-500 hover:text-slate-700">Cancel</button>
          <button onClick={save} disabled={saving} className="text-[12px] font-medium text-violet-600 hover:text-violet-700 disabled:opacity-60">
            {saving ? 'Re-checking…' : 'Save'}
          </button>
        </div>
      </td>
    </tr>
  )
}

function csvEscape(s: string): string {
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`
  }
  return s
}

// ---------------------------------------------------------------------------
// Manual player creation modal
// ---------------------------------------------------------------------------
function ManualPlayerModal({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: () => void
}) {
  const [name, setName] = useState('')
  const [position, setPosition] = useState<PlayerPosition>('MID')
  const [nationality, setNationality] = useState<string | null>(null)
  const [dateOfBirth, setDateOfBirth] = useState('')
  const [transferPounds, setTransferPounds] = useState(NaN)
  const [weeklyWagePounds, setWeeklyWagePounds] = useState(NaN)
  const [agentPounds, setAgentPounds] = useState(NaN)
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const computedAge = useMemo(() => ageFromDob(dateOfBirth), [dateOfBirth])
  // Players are realistically 14–60. Reject obviously bogus DOBs at the UI
  // boundary so the form is honest about what it will accept.
  const todayISO = new Date().toISOString().slice(0, 10)
  const sixtyYearsAgoISO = (() => {
    const d = new Date()
    d.setFullYear(d.getFullYear() - 60)
    return d.toISOString().slice(0, 10)
  })()

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      const cleanNationality = nationality?.trim() ?? ''
      const payload: ManualPlayerInput = {
        name: name.trim(),
        position,
        ...(cleanNationality ? { nationality: cleanNationality } : {}),
        ...(dateOfBirth ? { dateOfBirth } : {}),
        transferFeePence: (isFinite(transferPounds) ? transferPounds : 0) * 100,
        annualWagePence:  (isFinite(weeklyWagePounds) ? weeklyWagePounds : 0) * 52 * 100,
        agentFeePence:    (isFinite(agentPounds) ? agentPounds : 0) * 100,
        startDate,
        endDate,
      }
      await api.roster.createPlayer(payload)
      onCreated()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create player')
      setSaving(false)
    }
  }

  return (
    <ModalShell onClose={onClose} title="Add player">
      <form onSubmit={submit} className="px-5 pb-5 space-y-4 max-h-[80vh] overflow-y-auto overflow-x-visible">
        <Field label="Name">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={80}
            className={fieldClass}
          />
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Position">
            <select value={position} onChange={(e) => setPosition(e.target.value as PlayerPosition)} className={fieldClass}>
              {POSITIONS.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </Field>
          <Field label="Nationality (optional)">
            <CountryPicker value={nationality} onChange={setNationality} placeholder="Select country" />
          </Field>
        </div>

        <Field
          label={
            <span className="flex items-center justify-between">
              <span>Date of birth (optional)</span>
              {computedAge != null && (
                <span className="text-[11px] font-normal text-slate-500 normal-case tracking-normal">
                  Age <span className="num text-slate-700 font-medium">{computedAge}</span>
                </span>
              )}
            </span>
          }
        >
          <DatePicker
            value={dateOfBirth}
            onChange={setDateOfBirth}
            min={sixtyYearsAgoISO}
            max={todayISO}
            placeholder="Select date of birth"
          />
        </Field>

        <div className="grid grid-cols-3 gap-4">
          <Field label="Transfer fee (£)">
            <PoundInput value={transferPounds} onChange={setTransferPounds} />
          </Field>
          <Field label="Weekly wage (£)">
            <PoundInput value={weeklyWagePounds} onChange={setWeeklyWagePounds} />
          </Field>
          <Field label="Agent fee (£)">
            <PoundInput value={agentPounds} onChange={setAgentPounds} />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Contract start">
            <DatePicker value={startDate} onChange={setStartDate} required placeholder="Select start date" />
          </Field>
          <Field label="Contract end">
            <DatePicker value={endDate} onChange={setEndDate} required placeholder="Select end date" />
          </Field>
        </div>

        {error && (
          <div className="border border-red-200 bg-red-50 rounded-lg px-4 py-3 text-[13px] text-red-700">
            {error}
          </div>
        )}

        <div className="flex items-center justify-end gap-3 pt-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? <Spinner size={14} /> : null}
            {saving ? 'Saving…' : 'Add player'}
          </Button>
        </div>
      </form>
    </ModalShell>
  )
}

// ---------------------------------------------------------------------------
// Player edit drawer (existing player)
// ---------------------------------------------------------------------------
function PlayerEditDrawer({
  player,
  onClose,
  onSaved,
}: {
  player: PlayerWithContract
  onClose: () => void
  onSaved: () => void
}) {
  const can = useCan()
  const c = player.contract
  const [name, setName] = useState(player.name)
  const [position, setPosition] = useState<PlayerPosition>(player.position ?? 'MID')
  const [nationality, setNationality] = useState<string | null>(player.nationality)
  const [dateOfBirth, setDateOfBirth] = useState(player.dateOfBirth ?? '')
  const [transferPounds, setTransferPounds] = useState(c ? c.transferFeePence / 100 : NaN)
  const [weeklyWagePounds, setWeeklyWagePounds] = useState(c ? Math.round(c.annualWagePence / 52 / 100) : NaN)
  const [agentPounds, setAgentPounds] = useState(c ? c.agentFeePence / 100 : NaN)
  const [startDate, setStartDate] = useState(c?.startDate ?? '')
  const [endDate, setEndDate] = useState(c?.endDate ?? '')
  const [saving, setSaving] = useState(false)
  const [archiving, setArchiving] = useState(false)
  const [confirmArchive, setConfirmArchive] = useState(false)
  const [error, setError] = useState('')

  const computedAge = useMemo(() => ageFromDob(dateOfBirth), [dateOfBirth])
  const todayISO = new Date().toISOString().slice(0, 10)
  const sixtyYearsAgoISO = (() => {
    const d = new Date()
    d.setFullYear(d.getFullYear() - 60)
    return d.toISOString().slice(0, 10)
  })()

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      // Update player fields
      const playerPatch: {
        name?: string
        position?: PlayerPosition
        nationality?: string | null
        dateOfBirth?: string | null
      } = {}
      if (name.trim() !== player.name) playerPatch.name = name.trim()
      if (position !== player.position) playerPatch.position = position
      const cleanNationality = !nationality || nationality.trim() === '' ? null : nationality.trim()
      if (cleanNationality !== player.nationality) playerPatch.nationality = cleanNationality
      const cleanDob = dateOfBirth.trim() === '' ? null : dateOfBirth.trim()
      if (cleanDob !== (player.dateOfBirth ?? null)) playerPatch.dateOfBirth = cleanDob

      if (Object.keys(playerPatch).length > 0) {
        await api.roster.updatePlayer(player.id, playerPatch)
      }

      // Update contract fields
      if (c) {
        const contractPatch: Parameters<typeof api.roster.updateContract>[1] = {}
        const transferPence = (isFinite(transferPounds) ? transferPounds : 0) * 100
        const annualWagePence = (isFinite(weeklyWagePounds) ? weeklyWagePounds : 0) * 52 * 100
        const agentPence = (isFinite(agentPounds) ? agentPounds : 0) * 100

        if (transferPence !== c.transferFeePence)   contractPatch.transferFeePence = transferPence
        if (annualWagePence !== c.annualWagePence)  contractPatch.annualWagePence = annualWagePence
        if (agentPence !== c.agentFeePence)         contractPatch.agentFeePence = agentPence
        if (startDate !== c.startDate)              contractPatch.startDate = startDate
        if (endDate !== c.endDate)                  contractPatch.endDate = endDate

        if (Object.keys(contractPatch).length > 0) {
          await api.roster.updateContract(c.id, contractPatch)
        }
      }

      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save')
      setSaving(false)
    }
  }

  const archive = async () => {
    setArchiving(true)
    setError('')
    try {
      await api.roster.archivePlayer(player.id)
      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to archive')
      setArchiving(false)
      setConfirmArchive(false)
    }
  }

  return (
    <ModalShell onClose={onClose} title={`Edit ${player.name}`}>
      <form onSubmit={save} className="px-5 pb-5 space-y-4 max-h-[80vh] overflow-y-auto overflow-x-visible">
        <Field label="Name">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={80}
            className={fieldClass}
          />
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Position">
            <select value={position} onChange={(e) => setPosition(e.target.value as PlayerPosition)} className={fieldClass}>
              {POSITIONS.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </Field>
          <Field label="Nationality">
            <CountryPicker value={nationality} onChange={setNationality} placeholder="Select country" />
          </Field>
        </div>

        <Field
          label={
            <span className="flex items-center justify-between">
              <span>Date of birth (optional)</span>
              {computedAge != null && (
                <span className="text-[11px] font-normal text-slate-500 normal-case tracking-normal">
                  Age <span className="num text-slate-700 font-medium">{computedAge}</span>
                </span>
              )}
            </span>
          }
        >
          <DatePicker
            value={dateOfBirth}
            onChange={setDateOfBirth}
            min={sixtyYearsAgoISO}
            max={todayISO}
            placeholder="Select date of birth"
          />
        </Field>

        {c && (
          <>
            <div className="border-t border-slate-100 pt-4">
              <div className="meta-label mb-3">Contract</div>
              <div className="grid grid-cols-3 gap-4">
                <Field label="Transfer fee (£)">
                  <PoundInput value={transferPounds} onChange={setTransferPounds} />
                </Field>
                <Field label="Weekly wage (£)">
                  <PoundInput value={weeklyWagePounds} onChange={setWeeklyWagePounds} />
                </Field>
                <Field label="Agent fee (£)">
                  <PoundInput value={agentPounds} onChange={setAgentPounds} />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-4 mt-4">
                <Field label="Contract start">
                  <DatePicker value={startDate} onChange={setStartDate} required placeholder="Select start date" />
                </Field>
                <Field label="Contract end">
                  <DatePicker value={endDate} onChange={setEndDate} required placeholder="Select end date" />
                </Field>
              </div>
              <p className="mt-2 text-[12px] text-slate-500">
                Current book value: <span className="num text-slate-700">{formatPence(c.bookValuePence)}</span>
              </p>
            </div>
          </>
        )}

        {error && (
          <div className="border border-red-200 bg-red-50 rounded-lg px-4 py-3 text-[13px] text-red-700">
            {error}
          </div>
        )}

        <div className="flex items-center justify-between gap-3 pt-3 border-t border-slate-100">
          {can.mutateRoster ? (
            confirmArchive ? (
              <div className="flex items-center gap-2">
                <span className="text-[13px] text-slate-700">Archive {player.name}?</span>
                <Button type="button" variant="destructive" onClick={archive} disabled={archiving}>
                  {archiving ? <Spinner size={14} /> : null}
                  {archiving ? 'Archiving…' : 'Confirm'}
                </Button>
                <Button type="button" variant="ghost" onClick={() => setConfirmArchive(false)} disabled={archiving}>
                  Cancel
                </Button>
              </div>
            ) : (
              <Button type="button" variant="ghost" className="text-red-600 hover:text-red-700 hover:bg-red-50" onClick={() => setConfirmArchive(true)}>
                Archive player
              </Button>
            )
          ) : <div />}
          <div className="flex items-center gap-3">
            <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
              Close
            </Button>
            {can.mutateRoster && (
              <Button type="submit" disabled={saving}>
                {saving ? <Spinner size={14} /> : null}
                {saving ? 'Saving…' : 'Save changes'}
              </Button>
            )}
          </div>
        </div>
      </form>
    </ModalShell>
  )
}

// ---------------------------------------------------------------------------
// Generic UI pieces (kept local — too small to factor out into ui/ kit)
// ---------------------------------------------------------------------------
function ModalShell({
  onClose,
  title,
  children,
}: {
  onClose: () => void
  title: string
  children: React.ReactNode
}) {
  return (
    <AnimatePresence>
      <motion.div
        key="backdrop"
        role="dialog"
        aria-modal="true"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18 }}
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-[2px]"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose()
        }}
      >
        <motion.div
          // Pure fade — no translation, no scale. The dialog materialises in
          // place rather than sliding/zooming into position, so there's no
          // residual motion that reads as a layout shift.
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.12 } }}
          transition={{ duration: 0.16, ease: 'easeOut' }}
          className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl border border-slate-200 overflow-hidden"
        >
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
            <h2 className="text-[16px] font-semibold text-slate-900">{title}</h2>
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
          {children}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}

const fieldClass =
  'w-full px-3 py-2 text-[14px] rounded-lg border border-slate-200 bg-white focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500 transition-colors'

function Field({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="meta-label block mb-1.5">{label}</span>
      {children}
    </label>
  )
}

function PoundInput({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-[14px]">£</span>
      <NumericInput
        value={value}
        onChange={onChange}
        className={fieldClass + ' pl-7 num'}
        placeholder="0"
      />
    </div>
  )
}
