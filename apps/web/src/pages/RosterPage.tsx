/**
 * RosterPage — MVP 2.0 squad management.
 *
 * Two tabs: Squad (active players) and Archived. Three mutation flows:
 * (1) CSV upload — staging-area UX that validates on the server, lets the user
 *     fix errors inline, then commits the whole batch atomically.
 * (2) Manual add — single-player + contract via a modal form.
 * (3) Row click — opens the edit modal (player + contract patch).
 *
 * Design: follows the violet/light system from the UI Kit. No new primitives;
 * relies on Card, Button, NumericInput, Spinner.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation, Trans } from 'react-i18next'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { AlertTriangle } from 'lucide-react'
import * as XLSX from 'xlsx'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import {
  useRosterQuery,
  useArchivedRosterQuery,
  useManagerQuery,
  usePlayerPhasesQuery,
  invalidateRosterDerivedQueries,
} from '@/lib/queries'
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
import { useSeasonStore, seasonAsOfDate, seasonKey } from '@/stores/season'
import { exportAmortisationXLSX } from '@/lib/exports/amortisationXlsx'
import { findCountry, countryName } from '@/lib/countries'
import { Flag } from '@/components/ui/flag'
import { useWorkspaceCurrency } from '@/lib/useWorkspaceCurrency'
import { activeLocale } from '@/lib/locale'
import { formatPercentagePointDelta } from '@/lib/percentage'
import { compareByPosition, compareSquadNumbers } from '@/lib/positionSort'
import { TABLE_COLUMN_LABELS, formatSquadNumber, formatTableMoney, formatTimeLeft } from '@/lib/tablePresentation'
import { useTablePreferences } from '@/lib/useTablePreferences'
import { useScrollLock } from '@/lib/useScrollLock'
import { useCopilot } from '@/stores/copilot'
import { useNotificationsStore } from '@/stores/notifications'
import { CopilotTriggerIcon } from '@/components/ai/CopilotTrigger'
import { calculateRegistrationCost } from '@85percent/engine'
import {
  estimateScrChangePoints,
  previewAnnualCost,
} from '@/lib/rosterCosts'
import type {
  PlayerWithContract,
  PlayerPosition,
  RosterStagingRow,
  ManualPlayerInput,
  ManagerWithContract,
  ManagerInput,
  ManagerContractInput,
  ContractPhase,
  ExtendContractInput,
} from '@85percent/shared'

const POSITIONS: PlayerPosition[] = ['GK', 'DEF', 'MID', 'FWD']
type RosterTableFilter = 'all' | 'expiring' | PlayerPosition
type RosterTablePreferences = { sortKey: RosterSortKey; sortDir: RosterSortDir; filter: RosterTableFilter }
const ROSTER_TABLE_DEFAULTS: RosterTablePreferences = { sortKey: 'squadNumber', sortDir: 'asc', filter: 'all' }
const ROSTER_SORT_KEYS: RosterSortKey[] = ['squadNumber', 'name', 'position', 'wage', 'amortisation', 'total', 'contractEnd', 'expiry']

function isRosterTablePreferences(value: unknown): value is RosterTablePreferences {
  if (!value || typeof value !== 'object') return false
  const preferences = value as Partial<RosterTablePreferences>
  return ROSTER_SORT_KEYS.includes(preferences.sortKey as RosterSortKey)
    && (preferences.sortDir === 'asc' || preferences.sortDir === 'desc')
    && ['all', 'expiring', ...POSITIONS].includes(preferences.filter as RosterTableFilter)
}

// ---------------------------------------------------------------------------
// Top-level page
// ---------------------------------------------------------------------------
export function RosterPage() {
  const { t } = useTranslation()
  const can = useCan()
  const navigate = useNavigate()
  const { clubName, clubId, financials, setFinancials } = useClubStore()
  const { format: fmtMoney } = useWorkspaceCurrency()
  const openCopilot = useCopilot((s) => s.open)

  // Phase 4 trigger — serialize one player's engine figures and open the Co-pilot.
  const handleAskCopilotPlayer = (p: PlayerWithContract) => {
    const c = p.contract
    if (!c) return
    const months = p.monthsToExpiry
    openCopilot({
      module: 'Roster',
      subject: p.name,
      data: {
        playerName: p.name,
        position: p.position ?? '—',
        annualWage: fmtMoney(c.annualWagePence),
        remainingContract:
          months == null
            ? '—'
            : months < 0
              ? 'Expired'
              : `${months} months (~${(months / 12).toFixed(1)} yrs) to ${formatDate(c.endDate)}`,
        currentBookValue: fmtMoney(c.bookValuePence),
        annualAmortisation: fmtMoney(c.annualAmortisationPence),
        annualSquadCost: fmtMoney(c.totalAnnualCostPence),
        totalSquadCosts: financials ? fmtMoney(financials.currentSquadCosts) : 'n/a',
      },
    })
  }
  const [tab, setTab] = useState<'squad' | 'archived'>('squad')

  // Server data is cached in the QueryClient (above the router), so switching to
  // another tab and back serves it instantly — no re-fetch, no skeleton — until
  // it goes stale (5m), at which point it refreshes silently in the background.
  const queryClient = useQueryClient()
  const seasonStartYear = useSeasonStore((s) => s.startYear)
  const season = seasonKey(seasonStartYear)
  const rosterQuery = useRosterQuery()
  const archivedQuery = useArchivedRosterQuery()
  const managerQuery = useManagerQuery()
  const active = rosterQuery.data ?? []
  const archived = archivedQuery.data ?? []
  const manager = managerQuery.data ?? null
  const loadError =
    rosterQuery.isError || archivedQuery.isError || managerQuery.isError
      ? t('roster.failLoad')
      : ''
  // Mutation errors (restore / delete) — distinct from the load error above.
  const [error, setError] = useState('')

  // Modal state
  const [csvOpen, setCsvOpen] = useState(false)
  const [manualOpen, setManualOpen] = useState(false)
  const [editPlayer, setEditPlayer] = useState<PlayerWithContract | null>(null)
  const [managerAddOpen, setManagerAddOpen] = useState(false)
  const [managerEditOpen, setManagerEditOpen] = useState(false)

  // Archived-row action state — null when no row has confirm UI open. Only
  // one player can be in confirm-delete mode at a time so the user can't fan
  // a destructive action across multiple rows accidentally.
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [pendingActionId, setPendingActionId] = useState<string | null>(null)

  const tablePreferences = useTablePreferences('roster', clubId, ROSTER_TABLE_DEFAULTS, isRosterTablePreferences)
  const { filter } = tablePreferences.value
  const setFilter = (nextFilter: RosterTableFilter) => tablePreferences.setValue((current) => ({ ...current, filter: nextFilter }))

  // Re-fetch after a mutation by invalidating the cached queries: they refetch in
  // the background while the current rows stay on screen (no skeleton). Awaiting
  // lets callers sequence UI afterwards (close modal, clear the pending row).
  //
  // Financials are NOT a query here — they live in the club store (owned by
  // ProtectedRoute + the Settings editor), and a persistent query+sync effect
  // would clobber a just-saved edit with a stale cached copy on tab revisit.
  // A roster change does shift the server-derived squad costs, so we refresh the
  // store copy once, imperatively, instead.
  const refresh = async () => {
    setError('')
    await invalidateRosterDerivedQueries(queryClient)
    await Promise.all([
      api.club.getFinancials(season)
        .then(setFinancials)
        .catch(() => { /* preserve displayed financials on a transient failure */ }),
      useNotificationsStore.getState().refresh(season),
    ])
  }

  const handleRestore = async (id: string) => {
    setPendingActionId(id)
    setError('')
    try {
      await api.roster.restorePlayer(id)
      await refresh()
    } catch (e) {
      setError(e instanceof Error ? e.message : t('roster.failRestore'))
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
      setError(e instanceof Error ? e.message : t('roster.failDelete'))
    } finally {
      setPendingActionId(null)
    }
  }

  const filteredActive = useMemo(() => {
    // Filtering only — column ordering is owned by PlayerTable's sortable headers.
    if (filter === 'all') return active
    return filter === 'expiring'
      ? active.filter((p) => p.monthsToExpiry != null && p.monthsToExpiry <= 6)
      : active.filter((p) => p.position === filter)
  }, [active, filter])

  // Post-onboarding "redout": template hydration leaves every contract on a £0
  // wage. Surface those rows as validation errors (red wage cells + a banner)
  // until the CFO enters real payroll, so the SCR isn't silently understated.
  const zeroWageCount = useMemo(
    () => active.filter((p) => p.contract && p.contract.annualWagePence === 0).length,
    [active],
  )

  if (rosterQuery.isPending || archivedQuery.isPending || managerQuery.isPending || !tablePreferences.ready)
    return <RosterSkeleton />

  return (
    <div>
      {/* Page header */}
      <div className="mb-6 flex items-center gap-3">
        <span className="inline-block w-1.5 h-7 rounded-full bg-violet-600" />
        <div className="flex-1">
          <h1 className="text-[24px] font-bold text-slate-900 tracking-tight leading-none">
            {t('nav.roster')}
          </h1>
          <p className="text-[13px] text-slate-500 mt-1.5">
            {t('roster.subtitle')}
          </p>
        </div>
        {tab === 'squad' && (
          <div className="flex items-center gap-2">
            {can.mutateRoster && (
              <>
                <Button variant="secondary" onClick={() => setCsvOpen(true)}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M12 16V3" /><path d="m7 8 5-5 5 5" /><path d="M5 21h14" />
                  </svg>
                  {t('roster.importRoster')}
                </Button>
                <Button onClick={() => setManualOpen(true)}>{t('roster.addPlayer')}</Button>
              </>
            )}
            <RosterUtilitiesMenu
              disabled={active.length === 0}
              onExport={() => exportAmortisationXLSX({
                clubName: clubName ?? '85Percent FC',
                season: financials?.season ?? seasonKey(useSeasonStore.getState().startYear),
                players: active,
                currency: useClubStore.getState().baseCurrency,
              })}
            />
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-6 border-b border-slate-200 mb-5">
        <TabButton active={tab === 'squad'} onClick={() => setTab('squad')}>
          {t('roster.tabSquad')} <span className="ml-1.5 text-[12px] text-slate-400">({active.length})</span>
        </TabButton>
        <TabButton active={tab === 'archived'} onClick={() => setTab('archived')}>
          {t('roster.tabArchived')} <span className="ml-1.5 text-[12px] text-slate-400">({archived.length})</span>
        </TabButton>
      </div>

      {(error || loadError) && (
        <Card className="p-4 mb-4 border-red-200 bg-red-50">
          <p className="text-[13px] text-red-700">{error || loadError}</p>
        </Card>
      )}

      {tab === 'squad' ? (
        <>
          {/* Pre-fill redout banner — shown while any active contract still has
              a £0 wage (the state template hydration lands you in). Leads with
              the "imported" success, then guides the user to the wage step with
              a progress bar. */}
          {zeroWageCount > 0 && (() => {
            const withContract = active.filter((p) => p.contract).length
            const filled = Math.max(0, withContract - zeroWageCount)
            const pct = withContract > 0 ? Math.round((filled / withContract) * 100) : 0
            return (
              <Card className="p-4 mb-5 border-amber-300 bg-amber-50">
                <div className="flex items-start gap-3">
                  <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-amber-400 text-white">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] text-amber-900 font-semibold">
                      {t('roster.redout.title')}
                    </p>
                    <p className="text-[12.5px] text-amber-800 mt-1 leading-relaxed">
                      {t('roster.redout.body')}
                    </p>

                    {/* Wage-entry progress */}
                    <div className="mt-3 flex items-center gap-3">
                      <div className="h-1.5 flex-1 max-w-[260px] rounded-full bg-amber-200 overflow-hidden">
                        <div className="h-full rounded-full bg-amber-500 transition-all" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-[11.5px] font-medium text-amber-800 num whitespace-nowrap">
                        {t('roster.redout.progress', { filled, total: withContract })}
                      </span>
                    </div>

                    {can.mutateRoster && (
                      <div className="mt-3 flex items-center gap-2">
                        <Button size="sm" variant="secondary" onClick={() => setCsvOpen(true)}>
                          {t('roster.redout.uploadWages')}
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              </Card>
            )
          })()}

          {/* Head Coach / Manager — sits above the player table; their wages,
              amortised compensation fee and agent fees count toward the SCR. */}
          <ManagerCard
            manager={manager}
            canMutate={can.mutateRoster}
            onAdd={() => setManagerAddOpen(true)}
            onEdit={() => setManagerEditOpen(true)}
          />

          {/* Filter chips */}
          <div className="flex items-center gap-2 mb-4 flex-wrap">
            <FilterChip active={filter === 'all'} onClick={() => setFilter('all')}>
              {t('dashboard.table.filterAll')}
            </FilterChip>
            <FilterChip active={filter === 'expiring'} onClick={() => setFilter('expiring')}>
              {t('dashboard.table.filterExpiring')}
            </FilterChip>
            {POSITIONS.map((pos) => (
              <FilterChip
                key={pos}
                active={filter === pos}
                onClick={() => setFilter(pos)}
              >
                {t(`common.positions.${pos}`)}
              </FilterChip>
            ))}
            {!tablePreferences.isDefault && (
              <button
                type="button"
                onClick={tablePreferences.reset}
                className="px-2 py-1.5 text-[12px] font-medium text-slate-500 hover:text-violet-700"
              >
                Reset view
              </button>
            )}
          </div>

          {filteredActive.length === 0 ? (
            <EmptyState
              title={active.length === 0 ? t('roster.empty.noPlayers') : t('roster.empty.noMatch')}
              hint={
                active.length === 0
                  ? t('roster.empty.noPlayersHint')
                  : t('roster.empty.noMatchHint')
              }
              action={
                active.length === 0 && can.switchLeague ? (
                  <Button onClick={() => navigate('/onboarding')}>{t('roster.empty.prefillCta')}</Button>
                ) : undefined
              }
            />
          ) : (
            <PlayerTable
              players={filteredActive}
              onRowClick={(p) => setEditPlayer(p)}
              flagZeroWage
              onAskCopilot={handleAskCopilotPlayer}
              sortKey={tablePreferences.value.sortKey}
              sortDir={tablePreferences.value.sortDir}
              onSort={(sortKey, sortDir) => tablePreferences.setValue((current) => ({ ...current, sortKey, sortDir }))}
            />
          )}
        </>
      ) : (
        <>
          {archived.length === 0 ? (
            <EmptyState
              title={t('roster.empty.noArchived')}
              hint={t('roster.empty.noArchivedHint')}
            />
          ) : (
            <PlayerTable
              players={archived}
              onRowClick={() => undefined}
              archived
              sortKey={tablePreferences.value.sortKey}
              sortDir={tablePreferences.value.sortDir}
              onSort={(sortKey, sortDir) => tablePreferences.setValue((current) => ({ ...current, sortKey, sortDir }))}
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
            existingCount={active.length}
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
          <PlayerEditModal
            key={`edit-${editPlayer.id}`}
            player={editPlayer}
            onClose={() => setEditPlayer(null)}
            onSaved={async () => {
              setEditPlayer(null)
              await refresh()
            }}
          />
        )}
        {managerAddOpen && (
          <ManagerAddModal
            key="manager-add"
            onClose={() => setManagerAddOpen(false)}
            onCreated={async () => {
              setManagerAddOpen(false)
              await refresh()
            }}
          />
        )}
        {managerEditOpen && manager && (
          <ManagerDrawer
            key={`manager-edit-${manager.id}`}
            manager={manager}
            onClose={() => setManagerEditOpen(false)}
            onSaved={async () => {
              setManagerEditOpen(false)
              await refresh()
            }}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

function RosterUtilitiesMenu({ disabled, onExport }: { disabled: boolean; onExport: () => void }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpen((value) => !value)}
        aria-label={t('roster.moreActions')}
        title={t('roster.moreActions')}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="5" cy="12" r="1.75" /><circle cx="12" cy="12" r="1.75" /><circle cx="19" cy="12" r="1.75" />
        </svg>
      </Button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-1 z-20 min-w-[170px] rounded-lg border border-slate-200 bg-white p-1 shadow-md">
            <button
              onClick={() => { onExport(); setOpen(false) }}
              disabled={disabled}
              title={t('roster.exportExcelTitle')}
              className="flex w-full items-center gap-2 rounded px-2.5 py-2 text-left text-[13px] text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M12 3v13" /><path d="m7 11 5 5 5-5" /><path d="M5 21h14" />
              </svg>
              {t('roster.exportExcel')}
            </button>
          </div>
        </>
      )}
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
  flagZeroWage = false,
  canMutate = false,
  confirmDeleteId = null,
  pendingActionId = null,
  onRestore,
  onRequestDelete,
  onConfirmDelete,
  onCancelDelete,
  onAskCopilot,
  sortKey,
  sortDir,
  onSort,
}: {
  players: PlayerWithContract[]
  onRowClick: (p: PlayerWithContract) => void
  archived?: boolean
  // Phase 4 — per-row "AI Analysis" trigger (squad tab only).
  onAskCopilot?: (p: PlayerWithContract) => void
  // Highlight £0 wages as validation errors (post-onboarding redout, squad tab).
  flagZeroWage?: boolean
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
  sortKey: RosterSortKey
  sortDir: RosterSortDir
  onSort: (sortKey: RosterSortKey, sortDir: RosterSortDir) => void
}) {
  const { t } = useTranslation()
  const showActions = archived && canMutate && !!onRestore && !!onRequestDelete && !!onConfirmDelete && !!onCancelDelete
  const { format: fmtMoney } = useWorkspaceCurrency()

  const sortedPlayers = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1
    return [...players].sort((a, b) => {
      switch (sortKey) {
        case 'name':        return a.name.localeCompare(b.name) * dir
        case 'position':    return compareByPosition(a, b, sortDir)
        case 'wage':        return ((a.contract?.annualWagePence ?? 0) - (b.contract?.annualWagePence ?? 0)) * dir
        case 'amortisation':
          return ((a.contract?.annualAmortisationPence ?? 0) - (b.contract?.annualAmortisationPence ?? 0)) * dir
        case 'total':
          return ((a.contract?.totalAnnualCostPence ?? 0) - (b.contract?.totalAnnualCostPence ?? 0)) * dir
        case 'contractEnd': {
          const ad = a.contract?.endDate ? Date.parse(a.contract.endDate) : Infinity
          const bd = b.contract?.endDate ? Date.parse(b.contract.endDate) : Infinity
          return (ad - bd) * dir
        }
        case 'expiry': {
          // Last column shows "To Expiry" (contract end) on the squad tab and
          // the archived date on the archived tab — sort by whichever is shown.
          const aRaw = archived ? a.archivedAt : a.contract?.endDate
          const bRaw = archived ? b.archivedAt : b.contract?.endDate
          const ad = aRaw ? Date.parse(aRaw) : Infinity
          const bd = bRaw ? Date.parse(bRaw) : Infinity
          return (ad - bd) * dir
        }
        case 'squadNumber':
        default: {
          return compareSquadNumbers(a.squadNumber, b.squadNumber, sortDir) || a.name.localeCompare(b.name)
        }
      }
    })
  }, [players, sortKey, sortDir, archived])

  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
      <table className="w-full min-w-[840px]">
        <thead className="border-b border-slate-100">
          <tr>
            <SortableTh field="squadNumber" label={TABLE_COLUMN_LABELS.squadNumber} align="right" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <SortableTh field="name"        label={TABLE_COLUMN_LABELS.name} sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <SortableTh field="position"    label={TABLE_COLUMN_LABELS.position} sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <SortableTh field="wage"        label={TABLE_COLUMN_LABELS.weeklyWage} align="right" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <SortableTh field="total"       label={TABLE_COLUMN_LABELS.annualCost} align="right" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <SortableTh field="contractEnd" label={TABLE_COLUMN_LABELS.contractEnd} sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            <SortableTh field="expiry"      label={archived ? t('roster.th.archived') : TABLE_COLUMN_LABELS.timeLeft} align="right" sortKey={sortKey} sortDir={sortDir} onSort={onSort} />
            {showActions && <Th align="right">{t('roster.th.actions')}</Th>}
          </tr>
        </thead>
        <tbody>
          {sortedPlayers.map((p) => {
            return (
            <tr
              key={p.id}
              onClick={() => !archived && onRowClick(p)}
              className={cn(
                'group border-b border-slate-100 last:border-0 transition-colors',
                !archived && 'hover:bg-violet-50/60 cursor-pointer',
              )}
            >
              <td className="px-5 py-3.5 text-right text-[13px] num text-slate-500 tabular-nums w-12">
                {formatSquadNumber(p.squadNumber)}
              </td>
              <td className="px-5 py-3.5 text-[14px] text-slate-900 font-medium">
                <span className="inline-flex items-center gap-2 align-middle">
                  <NationalityFlag nationality={p.nationality} />
                  <span>{p.name}</span>
                </span>
                {!archived && p.monthsToExpiry != null && p.monthsToExpiry < 0 && (
                  <span className="ml-2 inline-block text-[10px] font-medium px-1.5 py-0.5 rounded bg-red-100 text-red-700 align-middle">
                    {t('roster.expiredBadge')}
                  </span>
                )}
                {onAskCopilot && !archived && p.contract && (
                  <CopilotTriggerIcon
                    onClick={() => onAskCopilot(p)}
                    title={t('roster.askAnalyst', { name: p.name })}
                    className="ml-1.5 align-middle opacity-0 transition-opacity focus:opacity-100 group-hover:opacity-100"
                  />
                )}
              </td>
              <td className="px-5 py-3.5">
                <PositionPill position={p.position} />
              </td>
              {(() => {
                const needsWage = flagZeroWage && !archived && !!p.contract && p.contract.annualWagePence === 0
                return (
                  <td className="px-5 py-3.5 text-[13px] num text-right text-slate-900">
                    {!p.contract ? (
                      '—'
                    ) : needsWage ? (
                      <span className="inline-flex items-center justify-end gap-1.5 text-slate-400">
                        {fmtMoney(0)}
                        <FinancialWarning />
                      </span>
                    ) : (
                      formatTableMoney(Math.round(p.contract.annualWagePence / 52), fmtMoney)
                    )}
                  </td>
                )
              })()}
              <td className="px-5 py-3.5 text-[13px] num text-right font-semibold text-slate-900">
                {p.contract ? formatTableMoney(p.contract.totalAnnualCostPence, fmtMoney) : '—'}
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
          )})}
        </tbody>
      </table>
      </div>
    </Card>
  )
}

function CostMetric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="meta-label">{label}</div>
      <div className="mt-0.5 text-[13px] font-medium text-slate-800 num">{value}</div>
    </div>
  )
}

function ContractCostSummary({
  feePence,
  carriedBookValuePence = null,
  annualWagePence,
  agentFeePence,
  startDate,
  endDate,
  className,
}: {
  feePence: number
  carriedBookValuePence?: number | null
  annualWagePence: number
  agentFeePence: number
  startDate: string
  endDate: string
  className?: string
}) {
  const { format: fmtMoney } = useWorkspaceCurrency()
  const financials = useClubStore((state) => state.financials)
  const preview = previewAnnualCost({
    feePence,
    carriedBookValuePence,
    annualWagePence,
    agentFeePence,
    startDate,
    endDate,
  })
  const scrChange = preview
    ? estimateScrChangePoints(preview.totalAnnualCostPence, financials?.footballRelatedRevenue)
    : null

  if (!preview) return null

  return (
    <p className={cn('text-[12px] text-slate-600', className)} aria-live="polite">
      Estimated annual cost: <span className="font-semibold text-slate-900 num">{fmtMoney(preview.totalAnnualCostPence)}</span>
      {scrChange != null && <span className="text-violet-700"> · Estimated SCR impact: {formatPercentagePointDelta(scrChange)}</span>}
    </p>
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
  const { t } = useTranslation()
  const confirming = confirmDeleteId === playerId
  const pending = pendingActionId === playerId

  if (confirming) {
    return (
      <span className="inline-flex items-center gap-2 justify-end">
        <span className="text-[11px] text-slate-600 whitespace-nowrap">{t('roster.rowActions.deletePrompt', { name: playerName })}</span>
        <IconButton
          label={pending ? t('roster.rowActions.deleting') : t('roster.rowActions.confirmDelete')}
          tone="danger"
          disabled={pending}
          onClick={() => onConfirmDelete(playerId)}
        >
          {pending ? <Spinner size={14} /> : <CheckIcon />}
        </IconButton>
        <IconButton
          label={t('common.cancel')}
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
        label={pending ? t('roster.rowActions.restoring') : t('roster.rowActions.restorePlayer')}
        tone="violet"
        disabled={pending}
        onClick={() => onRestore(playerId)}
      >
        {pending ? <Spinner size={14} /> : <RestoreIcon />}
      </IconButton>
      <IconButton
        label={t('roster.rowActions.deletePermanently')}
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

// Copy required next to every missing financial figure across the roster +
// staging surfaces. Bio-only ingestion leaves wages and transfer fees blank, so
// these prompts guide the CFO to enter official numbers without the old wall of
// red error states.
// Subtle amber AlertTriangle + hover/focus tooltip. The tooltip is rendered in a
// portal to <body> and positioned off the icon's screen rect, so it escapes the
// `overflow-hidden`/`overflow-auto` table containers that previously clipped it.
// Keyboard-focusable for a11y.
function FinancialWarning({ className }: { className?: string }) {
  const { t } = useTranslation()
  const warningText = t('roster.financialWarning')
  const iconRef = useRef<HTMLSpanElement>(null)
  const [coords, setCoords] = useState<{ top: number; right: number } | null>(null)

  const show = () => {
    const r = iconRef.current?.getBoundingClientRect()
    if (r) setCoords({ top: r.top, right: window.innerWidth - r.right })
  }
  const hide = () => setCoords(null)

  return (
    <span
      ref={iconRef}
      className={cn('relative inline-flex items-center align-middle', className)}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      <AlertTriangle
        size={14}
        strokeWidth={2}
        tabIndex={0}
        aria-label={warningText}
        className="text-amber-500 outline-none cursor-help"
      />
      {coords &&
        createPortal(
          <span
            role="tooltip"
            className="pointer-events-none fixed z-[1000] w-56 -translate-y-full rounded-lg bg-slate-900 px-3 py-2 text-left text-[11.5px] font-normal normal-case leading-snug text-white shadow-lg"
            style={{ top: coords.top - 8, right: coords.right }}
          >
            {warningText}
          </span>,
          document.body,
        )}
    </span>
  )
}

// A read-only money cell that shows the value, or £0 + a warning icon when the
// figure is missing (null) or zero. Keeps the column tidy (no red fill).
function FinancialCell({ pence }: { pence: number | null }) {
  const { format } = useWorkspaceCurrency()
  if (pence == null) return <span className="text-slate-400">—</span>
  if (pence <= 0) {
    return (
      <span className="inline-flex items-center justify-end gap-1.5 text-slate-400">
        {format(0)}
        <FinancialWarning />
      </span>
    )
  }
  return <>{format(pence)}</>
}

// Wraps a staging-table money input; floats the warning icon inside the field's
// right edge while the value is still missing/zero, then it disappears once the
// user types a real figure.
function FinancialInputCell({ needsValue, children }: { needsValue: boolean; children: React.ReactNode }) {
  return (
    <div className="relative">
      {children}
      {needsValue && (
        <span className="absolute right-1.5 top-1/2 -translate-y-1/2">
          <FinancialWarning />
        </span>
      )}
    </div>
  )
}

function EditIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
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

// Column-sort keys for the squad / archived player tables.
type RosterSortKey = 'squadNumber' | 'name' | 'position' | 'wage' | 'amortisation' | 'total' | 'contractEnd' | 'expiry'
type RosterSortDir = 'asc' | 'desc'

// Clickable header cell — matches the plain Th visually, adds a direction caret
// on the active column. First click sorts ascending for the text columns and
// descending for the right-aligned money/date columns (the more useful default);
// clicking again flips direction. Mirrors the Dashboard's SortableTh.
function SortableTh({
  field, label, align = 'left', sortKey, sortDir, onSort, info,
}: {
  field: RosterSortKey
  label: string
  align?: 'left' | 'right' | 'center'
  sortKey: RosterSortKey
  sortDir: RosterSortDir
  onSort: (f: RosterSortKey, d: RosterSortDir) => void
  // Optional info affordance (e.g. a tooltip) rendered beside the label. Clicks
  // on it are stopped so they don't toggle the column sort.
  info?: React.ReactNode
}) {
  const isActive = sortKey === field
  const handle = () => {
    if (isActive) onSort(field, sortDir === 'asc' ? 'desc' : 'asc')
    else onSort(field, align === 'right' ? 'desc' : 'asc')
  }
  return (
    <th
      onClick={handle}
      aria-sort={isActive ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
      className={cn(
        'meta-label px-5 py-3 cursor-pointer select-none whitespace-nowrap transition-colors',
        align === 'right' ? 'text-right' : align === 'center' ? 'text-center' : 'text-left',
        isActive ? 'text-violet-700' : 'hover:text-slate-600'
      )}
    >
      <span className={cn('inline-flex items-center gap-1', align === 'right' && 'flex-row-reverse')}>
        {label}
        {isActive && (
          <svg width="9" height="9" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {sortDir === 'asc' ? <path d="M3 8l3-4 3 4" /> : <path d="M3 4l3 4 3-4" />}
          </svg>
        )}
        {info && (
          <span onClick={(e) => e.stopPropagation()} className="cursor-default font-normal">
            {info}
          </span>
        )}
      </span>
    </th>
  )
}

// Renders a sharp SVG country flag for a player's nationality. Returns null
// when the value is empty or doesn't match a known country (e.g. legacy
// free-text values) — keeps the row clean rather than showing a placeholder.
function NationalityFlag({ nationality }: { nationality: string | null }) {
  const country = findCountry(nationality)
  if (!country) return null
  return <Flag code={country.code} title={countryName(country, activeLocale())} width={20} />
}

function PositionPill({ position }: { position: string | null }) {
  const { t } = useTranslation()
  if (!position) {
    return <span className="text-[12px] text-slate-400">—</span>
  }
  return (
    <span className="inline-block text-[11px] font-medium px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 whitespace-nowrap">
      {t(`common.positions.${position}`, { defaultValue: position })}
    </span>
  )
}

function ExpiryChip({ months }: { months: number | null }) {
  const { t } = useTranslation()
  if (months == null) return <span className="text-slate-400">—</span>
  if (months < 0) {
    return <span className="text-red-700 num">{t('dashboard.expiry.expired')}</span>
  }
  if (months <= 6) {
    return (
      <span className="inline-block text-[11px] font-medium px-2 py-0.5 rounded-md bg-amber-100 text-amber-700 whitespace-nowrap">
        {formatTimeLeft(months, t)}
      </span>
    )
  }
  return <span className="text-slate-500 whitespace-nowrap">{formatTimeLeft(months, t)}</span>
}

function formatDate(iso: string): string {
  const d = new Date(iso + (iso.length === 10 ? 'T00:00:00Z' : ''))
  if (Number.isNaN(d.getTime())) return iso
  return new Intl.DateTimeFormat(activeLocale(), { timeZone: 'UTC', day: '2-digit', month: 'short', year: 'numeric' }).format(d)
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

function EmptyState({ title, hint, action }: { title: string; hint: string; action?: React.ReactNode }) {
  return (
    <Card className="p-12 text-center">
      <p className="text-[15px] font-medium text-slate-900">{title}</p>
      <p className="text-[13px] text-slate-500 mt-2">{hint}</p>
      {action && <div className="mt-5 flex justify-center">{action}</div>}
    </Card>
  )
}

// ---------------------------------------------------------------------------
// CSV / Excel Upload Modal — staging area
// ---------------------------------------------------------------------------

// Read an uploaded file into CSV text. Plain .csv files are read as text;
// Excel workbooks (.xlsx / .xls) are converted to CSV from their first sheet
// via SheetJS, so the rest of the pipeline (server parse + validation) is
// identical regardless of the source format.
async function fileToCsvText(file: File): Promise<string> {
  const isExcel =
    /\.xlsx?$/i.test(file.name) ||
    file.type.includes('spreadsheetml') ||
    file.type === 'application/vnd.ms-excel'
  if (!isExcel) return file.text()

  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array' })
  const sheetName = wb.SheetNames[0]
  const sheet = sheetName ? wb.Sheets[sheetName] : undefined
  if (!sheet) throw new Error('That workbook has no sheets')
  // blankrows:false drops empty Excel rows. dateNF formats any real date cells
  // as ISO (YYYY-MM-DD) so contract/DOB/join columns survive the round-trip even
  // when Excel stored them as date cells rather than plain text.
  return XLSX.utils.sheet_to_csv(sheet, { blankrows: false, dateNF: 'yyyy-mm-dd' })
}

// Segmented choice between replacing the current squad and appending to it.
function ImportModeOption({
  active,
  onClick,
  title,
  desc,
}: {
  active: boolean
  onClick: () => void
  title: string
  desc: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'text-left rounded-lg border px-3 py-2.5 transition-colors',
        active
          ? 'border-violet-400 bg-white ring-1 ring-violet-200'
          : 'border-slate-200 bg-white hover:border-slate-300',
      )}
    >
      <div className="flex items-center gap-2">
        <span
          className={cn(
            'inline-flex h-3.5 w-3.5 items-center justify-center rounded-full border',
            active ? 'border-violet-600' : 'border-slate-300',
          )}
        >
          {active && <span className="h-1.5 w-1.5 rounded-full bg-violet-600" />}
        </span>
        <span className="text-[13px] font-medium text-slate-900">{title}</span>
      </div>
      <p className="mt-1 text-[12px] text-slate-500 pl-[22px] leading-snug">{desc}</p>
    </button>
  )
}

function CSVUploadModal({
  existingCount,
  onClose,
  onCommitted,
}: {
  existingCount: number
  onClose: () => void
  onCommitted: () => void
}) {
  const { t } = useTranslation()
  const { symbol } = useWorkspaceCurrency()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [parsing, setParsing] = useState(false)
  const [committing, setCommitting] = useState(false)
  const [rows, setRows] = useState<RosterStagingRow[]>([])
  const [globalError, setGlobalError] = useState('')
  // When the club already has a squad (e.g. a pre-filled template), the user
  // chooses whether to wipe it or add on top. Default to 'replace' so an import
  // doesn't silently duplicate the existing squad.
  const [mode, setMode] = useState<'replace' | 'append'>('replace')

  const handleFile = async (file: File) => {
    setParsing(true)
    setGlobalError('')
    try {
      const text = await fileToCsvText(file)
      const result = await api.roster.parseCsv(text)
      setRows(result.rows)
    } catch (e) {
      setGlobalError(e instanceof Error ? e.message : t('roster.csv.failParse'))
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
      await api.roster.commit(payload, existingCount > 0 ? mode : 'append')
      onCommitted()
    } catch (e) {
      setGlobalError(e instanceof Error ? e.message : t('roster.csv.failCommit'))
      setCommitting(false)
    }
  }

  return (
    <ModalShell onClose={onClose} title={t('roster.csv.title')}>
      <div className="max-h-[80vh] flex flex-col">
        <div className="px-5 pb-3">
          <p className="text-[13px] text-slate-600">{t('roster.csv.requirementsIntro')}</p>
          <div className="mt-3 grid gap-2 rounded-lg border border-slate-200 bg-slate-50/70 p-3 text-[12px] text-slate-600">
            <div>
              <span className="font-medium text-slate-800">{t('roster.csv.requiredColumns')}</span>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {['name', 'position', 'transfer_fee_pounds', 'weekly_wage_pounds', 'agent_fee_pounds', 'contract_start', 'contract_end'].map((column) => (
                  <code key={column} className="rounded bg-white px-1.5 py-0.5 text-[11px] text-slate-700 ring-1 ring-slate-200">{column}</code>
                ))}
              </div>
            </div>
            <div>
              <span className="font-medium text-slate-800">{t('roster.csv.optionalColumns')}</span>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {['squad_number', 'nationality', 'date_of_birth', 'joined_date', 'carried_book_value_pounds', 'amortisation_treatment'].map((column) => (
                  <code key={column} className="rounded bg-white px-1.5 py-0.5 text-[11px] text-slate-700 ring-1 ring-slate-200">{column}</code>
                ))}
              </div>
            </div>
            <p className="leading-relaxed text-slate-500">{t('roster.csv.requirementsHelp')}</p>
          </div>
          <div className="flex items-center gap-3 mt-4">
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv,.xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
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
              {parsing ? t('roster.csv.parsing') : rows.length > 0 ? t('roster.csv.chooseDifferent') : t('roster.csv.chooseFile')}
            </Button>
            {rows.length > 0 && (
              <span className="text-[13px] text-slate-500">
                {t('roster.csv.rows', { count: rows.length })} · {t('roster.csv.valid', { count: rows.filter((r) => r.ok).length })} ·{' '}
                <span className={rows.some((r) => !r.ok) ? 'text-red-600' : ''}>
                  {t('roster.csv.errors', { count: rows.filter((r) => !r.ok).length })}
                </span>
              </span>
            )}
          </div>
        </div>

        {/* Replace vs append — only relevant once a valid file is staged and the
            club already has a squad to act on. */}
        {rows.length > 0 && existingCount > 0 && (
          <div className="px-5 pb-3">
            <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
              <div className="meta-label mb-2">
                {t('roster.csv.alreadyHave', { count: existingCount })}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <ImportModeOption
                  active={mode === 'replace'}
                  onClick={() => setMode('replace')}
                  title={t('roster.csv.replaceSquad')}
                  desc={t('roster.csv.replaceDesc', { count: existingCount })}
                />
                <ImportModeOption
                  active={mode === 'append'}
                  onClick={() => setMode('append')}
                  title={t('roster.csv.addToSquad')}
                  desc={t('roster.csv.addToSquadDesc')}
                />
              </div>
              {mode === 'replace' && (
                <p className="mt-2 text-[12px] text-amber-700">
                  {t('roster.csv.replaceWarning', { count: existingCount })}
                </p>
              )}
            </div>
          </div>
        )}

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
                  <Th>{t('roster.csv.th.name')}</Th>
                  <Th>{t('roster.csv.th.pos')}</Th>
                  <Th align="right">{t('roster.csv.th.shirt')}</Th>
                  <Th>{t('roster.csv.th.dob')}</Th>
                  <Th align="right">{t('roster.csv.th.fee', { symbol })}</Th>
                  <Th align="right">{t('roster.csv.th.wage', { symbol })}</Th>
                  <Th align="right">{t('roster.csv.th.agent', { symbol })}</Th>
                  <Th>{t('roster.csv.th.start')}</Th>
                  <Th>{t('roster.csv.th.end')}</Th>
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
            {t('common.cancel')}
          </Button>
          <Button onClick={commit} disabled={!allValid || committing}>
            {committing ? <Spinner size={14} /> : null}
            {committing
              ? t('roster.csv.committing')
              : existingCount > 0 && mode === 'replace'
              ? t('roster.csv.replaceWith', { count: rows.filter((r) => r.ok).length })
              : t('roster.csv.commit', { count: rows.filter((r) => r.ok).length })}
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
  const { t } = useTranslation()
  const { format: fmtMoney } = useWorkspaceCurrency()
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
      <td className="px-5 py-3 text-[13px] num text-right text-slate-600">{p?.squadNumber ?? '—'}</td>
      <td className="px-5 py-3 text-[13px] text-slate-500 num">{p?.dateOfBirth ?? '—'}</td>
      <td className="px-5 py-3 text-[13px] num text-right">
        <FinancialCell pence={p ? p.transferFeePence : null} />
      </td>
      <td className="px-5 py-3 text-[13px] num text-right">
        <FinancialCell pence={p ? Math.floor(p.annualWagePence / 52) : null} />
      </td>
      <td className="px-5 py-3 text-[13px] num text-right">{p ? fmtMoney(p.agentFeePence) : '—'}</td>
      <td className="px-5 py-3 text-[13px] text-slate-500 num">{p?.startDate ?? '—'}</td>
      <td className="px-5 py-3 text-[13px] text-slate-500 num">
        <div className="flex items-center justify-between gap-2">
          <span>{p?.endDate ?? '—'}</span>
          {!row.ok && (
            <button
              onClick={() => setEditing(true)}
              className="text-[11px] font-medium text-violet-600 hover:text-violet-700"
            >
              {t('roster.csv.fix')}
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
  const { t } = useTranslation()
  // Editor seeds from existing parsed data or empty defaults
  const [name, setName] = useState(row.parsed?.name ?? '')
  const [position, setPosition] = useState<PlayerPosition>(row.parsed?.position ?? 'MID')
  const [squadNumber, setSquadNumber] = useState(row.parsed?.squadNumber ?? NaN)
  const [dateOfBirth, setDateOfBirth] = useState(row.parsed?.dateOfBirth ?? '')
  const [transferPounds, setTransferPounds] = useState(row.parsed ? row.parsed.transferFeePence / 100 : NaN)
  const [weeklyWagePounds, setWeeklyWagePounds] = useState(
    row.parsed ? Math.round(row.parsed.annualWagePence / 52 / 100) : NaN
  )
  const [agentPounds, setAgentPounds] = useState(row.parsed ? row.parsed.agentFeePence / 100 : NaN)
  const [carriedPounds, setCarriedPounds] = useState(
    row.parsed?.carriedBookValuePence != null ? row.parsed.carriedBookValuePence / 100 : NaN
  )
  const [showCarried, setShowCarried] = useState(row.parsed?.carriedBookValuePence != null)
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
        'name,position,squad_number,date_of_birth,transfer_fee_pounds,weekly_wage_pounds,agent_fee_pounds,contract_start,contract_end',
        [
          csvEscape(name),
          position,
          isFinite(squadNumber) ? squadNumber : '',
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
        // The synthesized CSV omits the optional Carried Book Value and join
        // date columns, so merge those back onto the re-validated parsed row
        // (from the editor state / original row) before committing.
        const carried =
          showCarried && Number.isFinite(carriedPounds) && carriedPounds >= 0
            ? Math.round(carriedPounds * 100)
            : null
        const merged =
          next.parsed != null
            ? {
                ...next,
      parsed: {
                ...next.parsed,
                carriedBookValuePence: carried,
                ...(row.parsed?.joinedDate ? { joinedDate: row.parsed.joinedDate } : {}),
                amortisationTreatment:
                  row.parsed?.amortisationTreatment ?? 'CONTINUE_CURRENT_SCHEDULE',
              },
              }
            : next
        onChange({ ...merged, rowIndex: row.rowIndex })
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
        <SelectControl value={position} onChange={(e) => setPosition(e.target.value as PlayerPosition)} className={cellInput}>
          {POSITIONS.map((p) => <option key={p} value={p}>{p}</option>)}
        </SelectControl>
      </td>
      <td className="px-2 py-2">
        <NumericInput value={squadNumber} onChange={setSquadNumber} className={cellNumeric} placeholder="—" />
      </td>
      <td className="px-2 py-2 align-top">
        <DatePicker
          value={dateOfBirth}
          onChange={setDateOfBirth}
          min={sixtyYearsAgoISO}
          max={todayISO}
        />
      </td>
      <td className="px-2 py-2">
        <FinancialInputCell needsValue={!isFinite(transferPounds) || transferPounds <= 0}>
          <NumericInput value={transferPounds} onChange={setTransferPounds} className={cellNumeric} placeholder="0" />
        </FinancialInputCell>
        {showCarried ? (
          <div className="mt-1.5">
            <div className="flex items-center justify-end gap-1 mb-0.5">
              <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500">{t('roster.csv.carriedBV')}</span>
              <InfoTooltip text={t('roster.nbv.carriedTooltip')} />
            </div>
            <NumericInput value={carriedPounds} onChange={setCarriedPounds} className={cellNumeric} placeholder="0" />
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setShowCarried(true)}
            className="mt-1 block w-full text-right text-[10.5px] font-medium text-violet-600 hover:text-violet-700"
          >
            {t('roster.csv.setCarriedBV')}
          </button>
        )}
      </td>
      <td className="px-2 py-2">
        <FinancialInputCell needsValue={!isFinite(weeklyWagePounds) || weeklyWagePounds <= 0}>
          <NumericInput value={weeklyWagePounds} onChange={setWeeklyWagePounds} className={cellNumeric} placeholder="0" />
        </FinancialInputCell>
      </td>
      <td className="px-2 py-2">
        <NumericInput value={agentPounds} onChange={setAgentPounds} className={cellNumeric} placeholder="0" />
      </td>
      <td className="px-2 py-2 align-top">
        <DatePicker value={startDate} onChange={setStartDate} />
      </td>
      <td className="px-2 py-2 align-top">
        <DatePicker value={endDate} onChange={setEndDate} />
        <div className="flex items-center justify-end gap-2 mt-2">
          <button onClick={onClose} className="text-[12px] text-slate-500 hover:text-slate-700">{t('common.cancel')}</button>
          <button onClick={save} disabled={saving} className="text-[12px] font-medium text-violet-600 hover:text-violet-700 disabled:opacity-60">
            {saving ? t('roster.csv.rechecking') : t('common.save')}
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
  const { t } = useTranslation()
  const [workflow, setWorkflow] = useState<'newSigning' | 'existingPlayer'>('newSigning')
  const [name, setName] = useState('')
  const [position, setPosition] = useState<PlayerPosition>('MID')
  const [transferPounds, setTransferPounds] = useState(NaN)
  const [carriedPounds, setCarriedPounds] = useState(NaN)
  const [wagePounds, setWagePounds] = useState(NaN)
  const [agentPounds, setAgentPounds] = useState(NaN)
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [profileOpen, setProfileOpen] = useState(false)
  const [squadNumber, setSquadNumber] = useState(NaN)
  const [nationality, setNationality] = useState<string | null>(null)
  const [dateOfBirth, setDateOfBirth] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const todayISO = new Date().toISOString().slice(0, 10)
  const weeklyWagePence = Math.round((Number.isFinite(wagePounds) ? wagePounds : 0) * 100)
  const annualWagePence = weeklyWagePence * 52
  const transferFeePence = Math.round((Number.isFinite(transferPounds) ? transferPounds : 0) * 100)
  const carriedBookValuePence =
    workflow === 'existingPlayer' && Number.isFinite(carriedPounds) && carriedPounds >= 0
      ? Math.round(carriedPounds * 100)
      : null
  const agentFeePence = Math.round((Number.isFinite(agentPounds) ? agentPounds : 0) * 100)

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!name.trim()) return setError("Enter the player's name")
    if (!Number.isFinite(wagePounds) || wagePounds <= 0) return setError('Weekly wage must be greater than zero')
    if (workflow === 'newSigning' && !startDate) return setError('Select a contract start date')
    if (!endDate) return setError('Select a contract end date')
    if (workflow === 'existingPlayer' && (!Number.isFinite(carriedPounds) || carriedPounds < 0)) return setError('Enter the current book value')
    setSaving(true)
    try {
      const payload: ManualPlayerInput = {
        name: name.trim(),
        position,
        transferFeePence: workflow === 'newSigning' ? transferFeePence : 0,
        ...(carriedBookValuePence != null ? { carriedBookValuePence } : {}),
        weeklyWagePence,
        agentFeePence,
        startDate: workflow === 'existingPlayer' ? todayISO : startDate,
        endDate,
        squadNumber: Number.isFinite(squadNumber) && squadNumber >= 1 ? squadNumber : undefined,
        nationality: nationality?.trim() || undefined,
        dateOfBirth: dateOfBirth || undefined,
      }
      await api.roster.createPlayer(payload)
      onCreated()
    } catch (e) {
      setError(e instanceof Error ? e.message : t('roster.form.failCreatePlayer'))
      setSaving(false)
    }
  }

  return (
    <ModalShell onClose={onClose} title={t('roster.manual.title')} size="compact">
      <form onSubmit={submit} className="max-h-[80vh] overflow-y-auto">
        <div className="space-y-4 px-5 py-5">
            <div className="grid grid-cols-2 gap-2" role="group" aria-label={t('roster.workflow.label')}>
              <WorkflowChoice
                active={workflow === 'newSigning'}
                title={t('roster.workflow.newSigning')}
                description={t('roster.workflow.newSigningDescription')}
                onClick={() => setWorkflow('newSigning')}
              />
              <WorkflowChoice
                active={workflow === 'existingPlayer'}
                title={t('roster.workflow.existingPlayer')}
                description={t('roster.workflow.existingPlayerDescription')}
                onClick={() => setWorkflow('existingPlayer')}
              />
            </div>

            <Field label={t('roster.form.name')}>
              <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} className={fieldClass} />
            </Field>
            <Field label={t('roster.form.position')}>
              <SelectControl value={position} onChange={(e) => setPosition(e.target.value as PlayerPosition)} className={fieldClass}>
                {POSITIONS.map((item) => <option key={item} value={item}>{t(`common.positions.${item}`)}</option>)}
              </SelectControl>
            </Field>

            {workflow === 'newSigning' && (
              <Field label={t('roster.form.contractStart')}>
                <DatePicker value={startDate} onChange={setStartDate} required />
              </Field>
            )}
            <Field label={t('roster.form.contractEnd')}>
              <DatePicker value={endDate} onChange={setEndDate} required />
            </Field>

            <Field label={t('roster.phase.weeklyWage')}>
              <PoundInput value={wagePounds} onChange={setWagePounds} />
            </Field>
            <Field label={workflow === 'existingPlayer' ? 'Remaining agent fee (£)' : t('roster.form.agentFee')}>
              <PoundInput value={agentPounds} onChange={setAgentPounds} />
            </Field>

            {workflow === 'newSigning' ? (
              <Field label={t('roster.form.transferFee')}>
                <PoundInput value={transferPounds} onChange={setTransferPounds} />
              </Field>
            ) : (
              <Field label={<span className="flex items-center gap-1.5"><span>{t('roster.accounting.carryingValue')}</span><InfoTooltip text={t('roster.nbv.carriedTooltip')} /></span>}>
                <PoundInput value={carriedPounds} onChange={setCarriedPounds} />
              </Field>
            )}

            <button
              type="button"
              onClick={() => setProfileOpen((open) => !open)}
              className="text-[12px] font-medium text-slate-600 hover:text-slate-900"
              aria-expanded={profileOpen}
            >
              {profileOpen ? t('roster.form.hideProfileDetails') : t('roster.form.profileDetails')}
            </button>
            {profileOpen && (
              <div className="grid gap-4 rounded-lg border border-slate-200 p-3 sm:grid-cols-2">
                <Field label={t('roster.form.squadNumberOptional')}>
                  <NumericInput value={squadNumber} onChange={setSquadNumber} className={fieldClass} placeholder={t('roster.form.squadNumberPlaceholder')} />
                </Field>
                <Field label={t('roster.form.nationalityOptional')}>
                  <CountryPicker value={nationality} onChange={setNationality} placeholder={t('roster.form.selectCountry')} />
                </Field>
                <Field label={t('roster.form.dobOptional')}>
                  <DatePicker value={dateOfBirth} onChange={setDateOfBirth} max={todayISO} />
                </Field>
              </div>
            )}

            <ContractCostSummary
              feePence={workflow === 'newSigning' ? transferFeePence : 0}
              carriedBookValuePence={carriedBookValuePence}
              annualWagePence={annualWagePence}
              agentFeePence={agentFeePence}
              startDate={workflow === 'existingPlayer' ? todayISO : startDate}
              endDate={endDate}
            />
        </div>
        {error && <div className="mx-5 mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">{error}</div>}
        <div className="sticky bottom-0 flex items-center justify-end gap-3 border-t border-slate-100 bg-white px-5 py-4">
          <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>{t('common.cancel')}</Button>
          <Button type="submit" disabled={saving}>
            {saving ? <Spinner size={14} /> : null}
            {saving ? t('common.saving') : t('roster.form.addPlayer')}
          </Button>
        </div>
      </form>
    </ModalShell>
  )
}

function WorkflowChoice({
  active,
  title,
  description,
  onClick,
}: {
  active: boolean
  title: string
  description: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-lg border p-3 text-left transition-colors',
        active ? 'border-violet-400 bg-violet-50 text-slate-900' : 'border-slate-200 bg-white text-slate-600 hover:border-violet-200',
      )}
    >
      <span className="block text-[13px] font-semibold">{title}</span>
      <span className="mt-1 block text-[11.5px] leading-snug text-slate-500">{description}</span>
    </button>
  )
}

// ---------------------------------------------------------------------------
// Player edit modal. A roster row opens this form directly; there is no
// read-only intermediate layer between the table and the edit workflow.
// ---------------------------------------------------------------------------
function PlayerEditModal({
  player,
  onClose,
  onSaved,
}: {
  player: PlayerWithContract
  onClose: () => void
  onSaved: () => void
}) {
  const { t } = useTranslation()
  const can = useCan()
  const { format: fmtMoney } = useWorkspaceCurrency()
  const c = player.contract
  const [name, setName] = useState(player.name)
  const [position, setPosition] = useState<PlayerPosition>(player.position ?? 'MID')
  const [squadNumber, setSquadNumber] = useState(player.squadNumber ?? NaN)
  const [nationality, setNationality] = useState<string | null>(player.nationality)
  const [dateOfBirth, setDateOfBirth] = useState(player.dateOfBirth ?? '')
  const [joinedDate, setJoinedDate] = useState(player.joinedDate ?? '')
  const [wagePounds, setWagePounds] = useState(c ? c.annualWagePence / 52 / 100 : NaN)
  const [agentPounds, setAgentPounds] = useState(c ? c.agentFeePence / 100 : NaN)
  const [startDate, setStartDate] = useState(c?.startDate ?? '')
  const [endDate, setEndDate] = useState(c?.endDate ?? '')

  const [profileOpen, setProfileOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [archiving, setArchiving] = useState(false)
  const [confirmArchive, setConfirmArchive] = useState(false)
  const [error, setError] = useState('')
  const [historyOpen, setHistoryOpen] = useState(false)
  const [playerValueEditing, setPlayerValueEditing] = useState(false)
  const [playerValueBasis, setPlayerValueBasis] = useState<'ACQUISITION_COST' | 'CURRENT_BOOK_VALUE'>(
    c?.accountingBasis ?? 'ACQUISITION_COST',
  )
  const [playerValuePounds, setPlayerValuePounds] = useState(
    c?.accountingBasis === 'CURRENT_BOOK_VALUE'
      ? (c.carriedBookValuePence ?? 0) / 100
      : (c?.transferFeePence ?? 0) / 100,
  )
  const formRef = useRef<HTMLFormElement>(null)

  // Contract history is a cached query. Undefined means still loading; an
  // empty array is the only genuine "no history" state.
  const phasesQuery = usePlayerPhasesQuery(c ? player.id : undefined, Boolean(c))
  const phases = phasesQuery.data
  const [extendOpen, setExtendOpen] = useState(false)

  // A keyed player modal is freshly mounted on every open. Reset explicitly as
  // well, so switching players can never retain a previous scroll position.
  useEffect(() => {
    formRef.current?.scrollTo({ top: 0 })
  }, [player.id])

  const computedAge = useMemo(() => ageFromDob(dateOfBirth), [dateOfBirth])
  const todayISO = new Date().toISOString().slice(0, 10)
  const sixtyYearsAgoISO = (() => {
    const d = new Date()
    d.setFullYear(d.getFullYear() - 60)
    return d.toISOString().slice(0, 10)
  })()
  const weeklyWagePence = Math.round((Number.isFinite(wagePounds) ? wagePounds : 0) * 100)
  const annualWagePence = weeklyWagePence * 52
  const agentFeePence = Math.round((Number.isFinite(agentPounds) ? agentPounds : 0) * 100)

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      // Update player fields
      const playerPatch: {
        name?: string
        position?: PlayerPosition
        squadNumber?: number | null
        nationality?: string | null
        dateOfBirth?: string | null
        joinedDate?: string | null
      } = {}
      if (name.trim() !== player.name) playerPatch.name = name.trim()
      if (position !== player.position) playerPatch.position = position
      const cleanSquadNumber = Number.isFinite(squadNumber) && squadNumber >= 1 ? squadNumber : null
      if (cleanSquadNumber !== (player.squadNumber ?? null)) playerPatch.squadNumber = cleanSquadNumber
      const cleanNationality = !nationality || nationality.trim() === '' ? null : nationality.trim()
      if (cleanNationality !== player.nationality) playerPatch.nationality = cleanNationality
      const cleanDob = dateOfBirth.trim() === '' ? null : dateOfBirth.trim()
      if (cleanDob !== (player.dateOfBirth ?? null)) playerPatch.dateOfBirth = cleanDob
      const cleanJoined = joinedDate.trim() === '' ? null : joinedDate.trim()
      if (cleanJoined !== (player.joinedDate ?? null)) playerPatch.joinedDate = cleanJoined

      if (Object.keys(playerPatch).length > 0) {
        await api.roster.updatePlayer(player.id, playerPatch)
      }

      // Update contract fields
      if (c) {
        if (!Number.isFinite(playerValuePounds) || playerValuePounds < 0) {
          throw new Error('Enter a valid player value')
        }
        const contractPatch: Parameters<typeof api.roster.updateContract>[1] = {}
        const agentPence = agentFeePence

        if (annualWagePence !== c.annualWagePence)  contractPatch.weeklyWagePence = weeklyWagePence
        if (agentPence !== c.agentFeePence)         contractPatch.agentFeePence = agentPence
        if (startDate !== c.startDate)              contractPatch.startDate = startDate
        if (endDate !== c.endDate)                  contractPatch.endDate = endDate

        if (Object.keys(contractPatch).length > 0) {
          await api.roster.updateContract(c.id, contractPatch)
        }
        const playerValuePence = Math.round((Number.isFinite(playerValuePounds) ? playerValuePounds : 0) * 100)
        const originalPlayerValuePence = playerValueBasis === 'CURRENT_BOOK_VALUE'
          ? (c.accountingBasis === 'CURRENT_BOOK_VALUE' ? c.carriedBookValuePence ?? 0 : c.bookValuePence)
          : c.transferFeePence
        if (playerValueBasis !== c.accountingBasis || playerValuePence !== originalPlayerValuePence) {
          await api.roster.correctRegistrationAsset(
            player.id,
            playerValueBasis === 'ACQUISITION_COST'
              ? { basis: 'ACQUISITION_COST', acquisitionFeePence: playerValuePence }
              : { basis: 'CURRENT_BOOK_VALUE', currentBookValuePence: playerValuePence },
          )
        }
      }

      onSaved()
    } catch (e) {
      setError(e instanceof Error ? e.message : t('roster.edit.failSave'))
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
      setError(e instanceof Error ? e.message : t('roster.edit.failArchive'))
      setArchiving(false)
      setConfirmArchive(false)
    }
  }

  if (extendOpen && c) {
    return (
      <ExtendContractWizard
        subjectLabel={player.name}
        currentContract={{
          feePence: c.transferFeePence,
          carriedBookValuePence: c.carriedBookValuePence,
          acquisitionAgentFeePence: c.acquisitionAgentFeePence,
          acquisitionDate: c.acquisitionDate,
          annualWagePence: c.annualWagePence,
          agentFeePence: c.agentFeePence,
          startDate: c.startDate,
          endDate: c.endDate,
        }}
        onClose={() => setExtendOpen(false)}
        submit={(input) => api.roster.extendPlayer(player.id, input)}
        onExtended={onSaved}
      />
    )
  }

  return (
    <ModalShell onClose={onClose} title={t('roster.edit.title', { name: player.name })} size="compact">
      <form ref={formRef} onSubmit={save} className="max-h-[calc(100dvh-57px)] overflow-y-auto overflow-x-visible sm:max-h-[80vh]">
        <div className="space-y-4 px-5 py-5">
            <Field label={t('roster.form.name')}>
              <input value={name} onChange={(event) => setName(event.target.value)} required maxLength={80} className={fieldClass} />
            </Field>
            <Field label={t('roster.form.position')}>
              <SelectControl value={position} onChange={(event) => setPosition(event.target.value as PlayerPosition)} className={fieldClass}>
                {POSITIONS.map((item) => <option key={item} value={item}>{t(`common.positions.${item}`)}</option>)}
              </SelectControl>
            </Field>

            <button
              type="button"
              onClick={() => setProfileOpen((open) => !open)}
              className="flex w-full items-center justify-between rounded-lg border border-slate-200 px-3 py-2.5 text-left text-[12px] font-medium text-slate-600 transition-colors hover:border-violet-200 hover:bg-violet-50/40 hover:text-slate-900"
              aria-expanded={profileOpen}
            >
              {profileOpen ? t('roster.form.hideProfileDetails') : t('roster.form.profileDetails')}
              <svg className={cn('h-4 w-4 transition-transform', profileOpen && 'rotate-180')} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
            </button>
            {profileOpen && (
              <div className="grid gap-4 rounded-lg border border-slate-200 p-3 sm:grid-cols-2">
                <Field label={t('roster.form.squadNumberOptional')}>
                  <NumericInput value={squadNumber} onChange={setSquadNumber} className={fieldClass} placeholder={t('roster.form.squadNumberPlaceholder')} />
                </Field>
                <Field label={t('roster.form.nationalityOptional')}>
                  <CountryPicker value={nationality} onChange={setNationality} placeholder={t('roster.form.selectCountry')} />
                </Field>
                <Field label={<span className="flex items-center justify-between"><span>{t('roster.form.dobOptional')}</span>{computedAge != null && <span className="text-[11px] font-normal normal-case tracking-normal text-slate-500">{t('roster.form.age')} {computedAge}</span>}</span>}>
                  <DatePicker value={dateOfBirth} onChange={setDateOfBirth} min={sixtyYearsAgoISO} max={todayISO} />
                </Field>
              </div>
            )}

            {c && (
              <section className="space-y-4 border-t border-slate-100 pt-4">
                <div className="meta-label">{t('roster.edit.contract')}</div>
                <Field label={t('roster.form.contractStart')}><DatePicker value={startDate} onChange={setStartDate} required /></Field>
                <Field label={t('roster.form.contractEnd')}><DatePicker value={endDate} onChange={setEndDate} required /></Field>
                <Field label={t('roster.phase.weeklyWage')}><PoundInput value={wagePounds} onChange={setWagePounds} /></Field>
                <Field label={t('roster.form.agentFee')}><PoundInput value={agentPounds} onChange={setAgentPounds} /></Field>
                <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="meta-label">Player value</div>
                      <p className="mt-1 text-[12px] text-slate-600">
                        Based on {c.accountingBasis === 'CURRENT_BOOK_VALUE' ? 'current book value' : 'transfer fee'}
                      </p>
                    </div>
                    <button type="button" onClick={() => setPlayerValueEditing((open) => !open)} className="text-[12px] font-medium text-violet-700 hover:text-violet-800">
                      {playerValueEditing ? 'Done' : 'Edit player value'}
                    </button>
                  </div>
                  {playerValueEditing && (
                    <div className="mt-3 grid gap-3 border-t border-slate-200 pt-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                      <SelectControl value={playerValueBasis} onChange={(event) => {
                        const basis = event.target.value as 'ACQUISITION_COST' | 'CURRENT_BOOK_VALUE'
                        setPlayerValueBasis(basis)
                        setPlayerValuePounds((basis === 'CURRENT_BOOK_VALUE' ? c.bookValuePence : c.transferFeePence) / 100)
                      }} className={fieldClass}>
                        <option value="ACQUISITION_COST">Transfer fee</option>
                        <option value="CURRENT_BOOK_VALUE">Current book value</option>
                      </SelectControl>
                      <PoundInput value={playerValuePounds} onChange={setPlayerValuePounds} />
                    </div>
                  )}
                </div>
                <p className="text-[12px] text-slate-500">{t('roster.edit.currentBookValue', { value: fmtMoney(c.bookValuePence) })}</p>
                {can.mutateRoster && <Button type="button" variant="outline" onClick={() => setExtendOpen(true)}><ExtendIcon /> Renew contract</Button>}
              </section>
            )}
            <section className="border-t border-slate-100 pt-4">
              <button type="button" onClick={() => setHistoryOpen((open) => !open)} className="flex w-full items-center justify-between rounded-lg border border-slate-200 px-3 py-2.5 text-left text-[12px] font-medium text-slate-600 transition-colors hover:border-violet-200 hover:bg-violet-50/40 hover:text-slate-900" aria-expanded={historyOpen}>
                Contract history{phases ? ` (${phases.length})` : ''}
                <svg className={cn('h-4 w-4 transition-transform', historyOpen && 'rotate-180')} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
              </button>
              {historyOpen && (
                <div className="mt-3 space-y-2">
                  {phases === undefined && <div className="h-16 animate-pulse rounded-lg bg-slate-100" aria-label="Loading contract history" />}
                  {[...(phases ?? [])].sort((a, b) => b.endDate.localeCompare(a.endDate)).map((phase) => (
                    <div key={phase.id} className="rounded-lg border border-slate-200 bg-slate-50/60 p-3">
                      <div className="flex items-center justify-between gap-3 text-[12px]"><div className="flex items-center gap-2"><PhaseTypePill phaseType={phase.phaseType} /><PhaseStatusPill status={phase.status} /></div><span className="num text-slate-500">{formatDate(phase.startDate)} - {formatDate(phase.endDate)}</span></div>
                      <div className="mt-3 grid grid-cols-2 gap-2"><CostMetric label={t('roster.phase.weeklyWage')} value={fmtMoney(Math.round(phase.annualWagePence / 52))} /><CostMetric label="Agent / negotiation fee" value={fmtMoney(phase.agentFeePence)} /></div>
                    </div>
                  ))}
                  {phases?.length === 0 && <p className="text-[12px] text-slate-500">No contract history is available.</p>}
                </div>
              )}
            </section>
          <ContractCostSummary
            feePence={c?.transferFeePence ?? 0}
            carriedBookValuePence={c?.carriedBookValuePence ?? null}
            annualWagePence={annualWagePence}
            agentFeePence={agentFeePence}
            startDate={startDate}
            endDate={endDate}
          />
        </div>
        {error && <div className="mx-5 mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">{error}</div>}
        <div className="sticky bottom-0 flex items-center justify-between gap-3 border-t border-slate-100 bg-white px-5 py-4">
          {can.mutateRoster ? (confirmArchive ? <div className="flex items-center gap-2"><span className="text-[13px] text-slate-700">{t('roster.edit.archivePrompt', { name: player.name })}</span><Button type="button" variant="destructive" onClick={archive} disabled={archiving}>{archiving ? <Spinner size={14} /> : null}{archiving ? t('roster.edit.archiving') : t('roster.edit.confirm')}</Button><Button type="button" variant="ghost" onClick={() => setConfirmArchive(false)} disabled={archiving}>{t('common.cancel')}</Button></div> : <Button type="button" variant="ghost" className="text-red-600 hover:bg-red-50 hover:text-red-700" onClick={() => setConfirmArchive(true)}>{t('roster.edit.archivePlayer')}</Button>) : <div />}
          <div className="flex items-center gap-3">{can.mutateRoster && <Button type="submit" disabled={saving}>{saving ? <Spinner size={14} /> : null}{saving ? t('common.saving') : t('roster.edit.saveChanges')}</Button>}</div>
        </div>
      </form>
    </ModalShell>
  )
}

// ---------------------------------------------------------------------------
// Manager (Head Coach)
// ---------------------------------------------------------------------------

function ManagerCard({
  manager,
  canMutate,
  onAdd,
  onEdit,
}: {
  manager: ManagerWithContract | null
  canMutate: boolean
  onAdd: () => void
  onEdit: () => void
}) {
  const { t } = useTranslation()
  const { format } = useWorkspaceCurrency()
  if (!manager) {
    return (
      <Card className="mb-5 p-5 border-dashed">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-lg bg-violet-50 text-violet-400 flex-shrink-0">
              <CoachIcon />
            </span>
            <div>
              <div className="text-[14px] font-semibold text-slate-900">{t('roster.manager.noCoachTitle')}</div>
              <div className="text-[12px] text-slate-500 mt-0.5">
                {t('roster.manager.noCoachBody')}
              </div>
            </div>
          </div>
          {canMutate && <Button onClick={onAdd}>{t('roster.manager.addCoach')}</Button>}
        </div>
      </Card>
    )
  }

  const c = manager.contract
  const needsWage = !!c && c.annualWagePence === 0
  const fmtMoney = format
  const cost = c ? previewAnnualCost({
    feePence: c.feePence,
    carriedBookValuePence: c.carriedBookValuePence,
    annualWagePence: c.annualWagePence,
    agentFeePence: c.agentFeePence,
    startDate: c.startDate,
    endDate: c.endDate,
  }) : null

  // Minimalist row that echoes a player row: flag · name · "Head Coach" tag on
  // the left; annual wage + contract end on the right; Edit at the far end. The
  // whole row is clickable to edit (like a player row) when the user can mutate.
  return (
    <Card className="mb-5 overflow-hidden">
      <div
        onClick={canMutate ? onEdit : undefined}
        className={cn(
          'flex items-center justify-between gap-4 px-5 py-3.5 transition-colors',
          canMutate && 'cursor-pointer hover:bg-violet-50/60',
        )}
      >
        <div className="flex items-center gap-3 min-w-0">
          <NationalityFlag nationality={manager.nationality} />
          <span className="text-[14px] font-medium text-slate-900 truncate">{manager.name}</span>
          <span className="inline-block text-[11px] font-medium px-2 py-0.5 rounded-md bg-violet-100 text-violet-700 whitespace-nowrap">
            {t('roster.manager.headCoach')}
          </span>
        </div>

        {!c ? (
          canMutate ? (
            <button type="button" onClick={(event) => { event.stopPropagation(); onEdit() }} className="text-[12px] font-medium text-violet-700 hover:text-violet-800">
              Add contract
            </button>
          ) : <span className="text-[12px] text-amber-700">{t('roster.manager.contractNotConfigured')}</span>
        ) : (
        <div className="flex items-center gap-5 sm:gap-8">
          <div className="text-right">
            <div className="meta-label">{t('roster.phase.weeklyWage')}</div>
            <div className="num text-[13px] mt-0.5 whitespace-nowrap text-slate-900">
              {needsWage ? (
                <span className="inline-flex items-center justify-end gap-1.5 text-slate-400">
                  {fmtMoney(0)}
                  <FinancialWarning />
                </span>
              ) : (
                fmtMoney(Math.round(c.annualWagePence / 52))
              )}
            </div>
          </div>
          <div className="hidden text-right sm:block">
            <div className="meta-label">{t('roster.manager.annualCost')}</div>
            <div className="mt-0.5 whitespace-nowrap text-[13px] font-medium text-slate-900 num">
              {cost ? fmtMoney(cost.totalAnnualCostPence) : t('roster.manager.contractNotConfigured')}
            </div>
          </div>
          <div className="hidden text-right md:block">
            <div className="meta-label">{t('roster.form.contractEnd')}</div>
            <div className="mt-0.5 whitespace-nowrap text-[13px] text-slate-700 num">
              {formatDate(c.endDate)}
            </div>
          </div>
          <div className="hidden lg:block">
            <span className="inline-flex rounded-full bg-emerald-50 px-2 py-1 text-[11px] font-medium text-emerald-700">
              {t('roster.manager.includedInScr')}
            </span>
          </div>
          {canMutate && <button type="button" onClick={(event) => { event.stopPropagation(); onEdit() }} className="text-[12px] font-medium text-violet-700 hover:text-violet-800">Edit contract</button>}
        </div>
        )}
      </div>
    </Card>
  )
}

// Create the Head Coach + their INITIAL contract phase.
function ManagerAddModal({
  onClose,
  onCreated,
}: {
  onClose: () => void
  onCreated: () => void
}) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [compPounds, setCompPounds] = useState(NaN)
  const [wagePounds, setWagePounds] = useState(NaN)
  const [agentPounds, setAgentPounds] = useState(NaN)
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [additionalCostsOpen, setAdditionalCostsOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const formRef = useRef<HTMLFormElement>(null)
  const compensationFeePence = Math.round((Number.isFinite(compPounds) ? compPounds : 0) * 100)
  const weeklyWagePence = Math.round((Number.isFinite(wagePounds) ? wagePounds : 0) * 100)
  const annualWagePence = weeklyWagePence * 52
  const agentFeePence = Math.round((Number.isFinite(agentPounds) ? agentPounds : 0) * 100)

  useEffect(() => {
    formRef.current?.scrollTo({ top: 0 })
  }, [])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      const payload: ManagerInput = {
        name: name.trim(),
        compensationFeePence,
        weeklyWagePence,
        agentFeePence,
        startDate,
        endDate,
      }
      await api.roster.createManager(payload)
      onCreated()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('roster.manager.failAdd'))
      setSaving(false)
    }
  }

  return (
    <ModalShell onClose={onClose} title={t('roster.manager.addCoach')} size="compact">
      <form ref={formRef} onSubmit={submit} className="max-h-[calc(100dvh-57px)] overflow-y-auto sm:max-h-[80vh]">
        <div className="space-y-5 px-5 py-5">
            <Field label={t('roster.form.name')}><input value={name} onChange={(event) => setName(event.target.value)} required maxLength={80} className={fieldClass} /></Field>
            <section className="space-y-5 border-t border-slate-100 pt-5">
              <p className="text-[12px] text-slate-500">Add contract details so the coach is included in SCR.</p>
              <Field label={t('roster.form.contractStart')}><DatePicker value={startDate} onChange={setStartDate} required /></Field>
              <Field label={t('roster.form.contractEnd')}><DatePicker value={endDate} onChange={setEndDate} required /></Field>
              <Field label={t('roster.phase.weeklyWage')}><PoundInput value={wagePounds} onChange={setWagePounds} /></Field>
              <button type="button" onClick={() => setAdditionalCostsOpen((open) => !open)} className="flex w-full items-center justify-between rounded-lg border border-slate-200 px-3 py-2.5 text-left text-[12px] font-medium text-slate-600 hover:border-violet-200 hover:bg-violet-50/40 hover:text-slate-900" aria-expanded={additionalCostsOpen}>Additional costs — optional <span aria-hidden="true">{additionalCostsOpen ? '−' : '+'}</span></button>
              {additionalCostsOpen && <div className="grid gap-4 rounded-lg border border-slate-200 p-4 sm:grid-cols-2"><Field label={t('roster.form.agentFee')}><PoundInput value={agentPounds} onChange={setAgentPounds} /></Field><Field label={t('roster.form.compFee')}><PoundInput value={compPounds} onChange={setCompPounds} /></Field></div>}
            </section>
            <ContractCostSummary feePence={compensationFeePence} annualWagePence={annualWagePence} agentFeePence={agentFeePence} startDate={startDate} endDate={endDate} />
        </div>
        {error && <div className="mx-5 mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">{error}</div>}
        <div className="sticky bottom-0 flex items-center justify-end gap-3 border-t border-slate-100 bg-white px-5 py-4"><Button type="button" variant="ghost" onClick={onClose} disabled={saving}>{t('common.cancel')}</Button><Button type="submit" disabled={saving}>{saving ? <Spinner size={14} /> : null}{saving ? t('common.saving') : t('roster.manager.addCoach')}</Button></div>
      </form>
    </ModalShell>
  )
}

// Edit the Head Coach: correct current-phase fields, view the contract ledger,
// log an extension, or remove (archive) them.
function ManagerDrawer({
  manager,
  onClose,
  onSaved,
}: {
  manager: ManagerWithContract
  onClose: () => void
  onSaved: () => void
}) {
  const { t } = useTranslation()
  const can = useCan()
  const { format: fmtMoney } = useWorkspaceCurrency()
  const c = manager.contract
  const [name, setName] = useState(manager.name)
  const [nationality, setNationality] = useState<string | null>(manager.nationality)
  const [compPounds, setCompPounds] = useState(c ? c.feePence / 100 : NaN)
  const [wagePounds, setWagePounds] = useState(c ? c.annualWagePence / 52 / 100 : NaN)
  const [agentPounds, setAgentPounds] = useState(c ? c.agentFeePence / 100 : NaN)
  const [startDate, setStartDate] = useState(c?.startDate ?? '')
  const [endDate, setEndDate] = useState(c?.endDate ?? '')
  const [additionalCostsOpen, setAdditionalCostsOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [extendOpen, setExtendOpen] = useState(false)
  const [phases, setPhases] = useState<ContractPhase[]>(manager.phases)
  const [error, setError] = useState('')
  const formRef = useRef<HTMLFormElement>(null)
  const compensationFeePence = Math.round((Number.isFinite(compPounds) ? compPounds : 0) * 100)
  const weeklyWagePence = Math.round((Number.isFinite(wagePounds) ? wagePounds : 0) * 100)
  const annualWagePence = weeklyWagePence * 52
  const agentFeePence = Math.round((Number.isFinite(agentPounds) ? agentPounds : 0) * 100)
  const contractCost = c ? previewAnnualCost({
    feePence: c.feePence,
    carriedBookValuePence: c.carriedBookValuePence,
    annualWagePence: c.annualWagePence,
    agentFeePence: c.agentFeePence,
    startDate: c.startDate,
    endDate: c.endDate,
  }) : null

  useEffect(() => {
    formRef.current?.scrollTo({ top: 0 })
  }, [manager.id])

  // Re-fetch phases in place after editing one (without closing the drawer).
  const reloadPhases = () => {
    api.roster
      .getManager()
      .then((r) => setPhases(r.manager?.phases ?? []))
      .catch(() => { /* ledger is supplementary — silent on failure */ })
  }

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      const cleanNationality = !nationality || nationality.trim() === '' ? null : nationality.trim()
      const mgrPatch: Parameters<typeof api.roster.updateManager>[1] = {}
      if (name.trim() !== manager.name) mgrPatch.name = name.trim()
      if (cleanNationality !== manager.nationality) mgrPatch.nationality = cleanNationality
      if (Object.keys(mgrPatch).length > 0) {
        await api.roster.updateManager(manager.id, mgrPatch)
      }
      const compPence = compensationFeePence
      const agentPence = agentFeePence

      if (c) {
        const patch: Parameters<typeof api.roster.updateManagerContract>[1] = {}
        if (compPence !== c.feePence) patch.feePence = compPence
        if (annualWagePence !== c.annualWagePence) patch.weeklyWagePence = weeklyWagePence
        if (agentPence !== c.agentFeePence) patch.agentFeePence = agentPence
        if (startDate !== c.startDate) patch.startDate = startDate
        if (endDate !== c.endDate) patch.endDate = endDate
        if (Object.keys(patch).length > 0) {
          await api.roster.updateManagerContract(c.id, patch)
        }
      } else if (startDate || endDate || Number.isFinite(wagePounds) || Number.isFinite(compPounds) || Number.isFinite(agentPounds)) {
        // No contract yet (a template-imported coach with no Transfermarkt data).
        // The CFO has started filling it in — create the INITIAL phase so the
        // manager begins counting toward SCR. All three are required to seed it.
        if (!startDate || !endDate) {
          throw new Error(t('roster.manager.needDates'))
        }
        if (!Number.isFinite(wagePounds) || annualWagePence <= 0) {
          throw new Error(t('roster.manager.needWage'))
        }
        const input: ManagerContractInput = {
          compensationFeePence: compPence,
          weeklyWagePence,
          agentFeePence: agentPence,
          startDate,
          endDate,
        }
        await api.roster.createManagerContract(manager.id, input)
      }
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('roster.manager.failSave'))
      setSaving(false)
    }
  }

  const remove = async () => {
    setRemoving(true)
    setError('')
    try {
      await api.roster.updateManager(manager.id, { isActive: false })
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('roster.manager.failRemove'))
      setRemoving(false)
      setConfirmRemove(false)
    }
  }

  if (extendOpen && c) {
    return (
      <ExtendContractWizard
        subjectLabel={manager.name}
        currentContract={{
          feePence: c.feePence,
          carriedBookValuePence: c.carriedBookValuePence,
          annualWagePence: c.annualWagePence,
          agentFeePence: c.agentFeePence,
          startDate: c.startDate,
          endDate: c.endDate,
        }}
        onClose={() => setExtendOpen(false)}
        submit={(input) => api.roster.extendManager(manager.id, input)}
        onExtended={onSaved}
      />
    )
  }

  return (
    <ModalShell onClose={onClose} title={t('roster.manager.editTitle', { name: manager.name })} size="compact">
      <form ref={formRef} onSubmit={save} className="flex min-h-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overflow-x-visible px-5 py-5">
        <Field label={t('roster.form.name')}>
          <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} className={fieldClass} />
        </Field>
        <div className="space-y-5 border-t border-slate-100 pt-5">
          <div className="flex items-center gap-2 mb-3">
            <span className="meta-label">{c ? t('roster.manager.currentContract') : t('roster.manager.contract')}</span>
            {c ? (
              <PhaseTypePill phaseType={c.phaseType} />
            ) : (
              <span className="text-[11px] font-medium px-2 py-0.5 rounded-md bg-amber-100 text-amber-700">
                {t('roster.manager.notSet')}
              </span>
            )}
          </div>
          {!c && (
            <p className="mb-3 text-[12px] text-slate-500">
              Add contract details so the coach is included in SCR.
            </p>
          )}
          <Field label={t('roster.form.contractStart')}><DatePicker value={startDate} onChange={setStartDate} required={!!c} /></Field>
          <Field label={t('roster.form.contractEnd')}><DatePicker value={endDate} onChange={setEndDate} required={!!c} /></Field>
          <Field label={t('roster.phase.weeklyWage')}><PoundInput value={wagePounds} onChange={setWagePounds} /></Field>
          <button type="button" onClick={() => setAdditionalCostsOpen((open) => !open)} className="flex w-full items-center justify-between rounded-lg border border-slate-200 px-3 py-2.5 text-left text-[12px] font-medium text-slate-600 hover:border-violet-200 hover:bg-violet-50/40 hover:text-slate-900" aria-expanded={additionalCostsOpen}>Additional costs — optional <span aria-hidden="true">{additionalCostsOpen ? '−' : '+'}</span></button>
          {additionalCostsOpen && <div className="grid gap-4 rounded-lg border border-slate-200 p-4 sm:grid-cols-2"><Field label={t('roster.form.agentFee')}><PoundInput value={agentPounds} onChange={setAgentPounds} /></Field><Field label={t('roster.form.compFee')}><PoundInput value={compPounds} onChange={setCompPounds} /></Field></div>}
          {c && (
            <p className="mt-2 text-[12px] text-slate-500">
              {t('roster.manager.currentBookValue', { value: fmtMoney(c.bookValuePence) })}
              {contractCost && c.feePence > 0 && (
                <> · {t('roster.manager.amortised', { value: fmtMoney(contractCost.amortisationPence) })}</>
              )}
            </p>
          )}

          {c && can.mutateRoster && (
            <div className="mt-4">
              <Button type="button" variant="outline" onClick={() => setExtendOpen(true)}>
                <ExtendIcon /> Edit contract
              </Button>
            </div>
          )}
        </div>

        <ContractCostSummary
          feePence={compensationFeePence}
          annualWagePence={annualWagePence}
          agentFeePence={agentFeePence}
          startDate={startDate}
          endDate={endDate}
        />
        </div>

        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-slate-100 bg-white px-5 py-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
          {can.mutateRoster ? (
            confirmRemove ? (
              <div className="flex min-w-0 items-center gap-2">
                <span className="text-[13px] text-slate-700">{t('roster.manager.removePrompt', { name: manager.name })}</span>
                <Button type="button" variant="destructive" onClick={remove} disabled={removing}>
                  {removing ? <Spinner size={14} /> : null}
                  {removing ? t('roster.manager.removing') : t('roster.manager.confirm')}
                </Button>
                <Button type="button" variant="ghost" onClick={() => setConfirmRemove(false)} disabled={removing}>{t('common.cancel')}</Button>
              </div>
            ) : (
              <Button type="button" variant="ghost" className="text-red-600 hover:text-red-700 hover:bg-red-50" onClick={() => setConfirmRemove(true)}>
                {t('roster.manager.removeCoach')}
              </Button>
            )
          ) : <div />}
          <div className="flex items-center gap-3">
            {can.mutateRoster && (
              <Button type="submit" disabled={saving}>
                {saving ? <Spinner size={14} /> : null}
                {saving ? t('common.saving') : t('roster.edit.saveChanges')}
              </Button>
            )}
          </div>
        </div>
        {error && <div className="shrink-0 border-t border-red-200 bg-red-50 px-5 py-3 text-[13px] text-red-700">{error}</div>}
      </form>
    </ModalShell>
  )
}

// ---------------------------------------------------------------------------
// Contract ledger — vertical timeline of phases (current = green, past = grey).
// Any phase can be edited in place, including archived ones (e.g. to correct a
// historical fee/date). `kind` routes the save to the player or manager
// endpoint; `onChanged` lets the parent re-fetch the ledger after a save.
// ---------------------------------------------------------------------------
function ContractLedger({
  phases,
  kind,
  canEdit = false,
  onChanged,
}: {
  phases: ContractPhase[]
  kind: 'player' | 'manager'
  canEdit?: boolean
  onChanged?: () => void
}) {
  const { t } = useTranslation()
  const { format: fmtMoney } = useWorkspaceCurrency()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState('')

  const doDelete = async (phaseId: string) => {
    setDeletingId(phaseId)
    setDeleteError('')
    try {
      if (kind === 'player') await api.roster.deleteContract(phaseId)
      else await api.roster.deleteManagerContract(phaseId)
      setConfirmDeleteId(null)
      onChanged?.()
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : t('roster.ledger.failDelete'))
    } finally {
      setDeletingId(null)
    }
  }

  return (
    <ol className="relative border-l border-slate-200 ml-1.5 space-y-3">
      {phases.map((p) => {
        const editing = editingId === p.id
        const confirming = confirmDeleteId === p.id
        const deleting = deletingId === p.id
        return (
        <li key={p.id} className="ml-4">
          <span
            className={cn(
              'absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full ring-2 ring-white',
              p.isCurrent ? 'bg-emerald-500' : 'bg-slate-300'
            )}
          />
          <div className="rounded-lg border border-slate-200 bg-white px-3.5 py-3">
            <div className="flex items-start justify-between gap-3">
              {/* Left: phase type + status pills, with the contract window
                  beneath them. Keeping dates here (not inline with the icons)
                  declutters the right edge and aligns every row. */}
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <PhaseTypePill phaseType={p.phaseType} />
                  {p.isCurrent ? (
                    <span className="inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">{t('roster.ledger.active')}</span>
                  ) : (
                    <span className="inline-block text-[10px] font-medium px-1.5 py-0.5 rounded bg-slate-100 text-slate-500">{t('roster.ledger.archivedTag')}</span>
                  )}
                </div>
                <div className="num tabular-nums text-[12px] text-slate-500 mt-1.5 whitespace-nowrap">
                  {formatDate(p.startDate)} → {formatDate(p.endDate)}
                </div>
              </div>

              {/* Right: actions, always in the same two slots. Edit + Delete on
                  every row; Delete is disabled on the live phase (managed via the
                  form / extension flow above) rather than hidden, so the columns
                  line up across rows. */}
              {canEdit && !editing && (
                confirming ? (
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <span className="text-[11px] text-slate-600 whitespace-nowrap">{t('roster.ledger.deletePrompt')}</span>
                    <IconButton label={deleting ? t('roster.ledger.deleting') : t('roster.ledger.confirmDelete')} tone="danger" disabled={deleting} onClick={() => doDelete(p.id)}>
                      {deleting ? <Spinner size={14} /> : <CheckIcon />}
                    </IconButton>
                    <IconButton label={t('common.cancel')} tone="neutral" disabled={deleting} onClick={() => setConfirmDeleteId(null)}>
                      <CloseIcon />
                    </IconButton>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    <IconButton label={t('roster.ledger.editPhase')} tone="violet" onClick={() => setEditingId(p.id)}>
                      <EditIcon />
                    </IconButton>
                    <IconButton
                      label={p.isCurrent ? t('roster.ledger.liveCantDelete') : t('roster.ledger.deletePhase')}
                      tone="danger"
                      disabled={p.isCurrent}
                      onClick={() => setConfirmDeleteId(p.id)}
                    >
                      <TrashIcon />
                    </IconButton>
                  </div>
                )
              )}
            </div>

            {editing ? (
              <PhaseEditor
                phase={p}
                kind={kind}
                onCancel={() => setEditingId(null)}
                onSaved={() => {
                  setEditingId(null)
                  onChanged?.()
                }}
              />
            ) : (
              <div className="mt-3 pt-3 border-t border-slate-100 grid grid-cols-3 gap-2 text-[12px]">
                <LedgerCell label={t('roster.ledger.fee')} value={fmtMoney(p.feePence)} />
                <LedgerCell label={t('roster.ledger.wagePerYear')} value={fmtMoney(p.annualWagePence)} />
                <LedgerCell label={p.isCurrent ? t('roster.ledger.bookValue') : t('roster.ledger.carriedOut')} value={fmtMoney(p.bookValuePence)} />
              </div>
            )}
          </div>
        </li>
        )
      })}
      {deleteError && <li className="ml-4 text-[12px] text-red-600">{deleteError}</li>}
    </ol>
  )
}

function LedgerCell({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="meta-label">{label}</div>
      <div className="num text-slate-800 mt-0.5">{value}</div>
    </div>
  )
}

// Inline editor for a single contract phase. Patches by phase id via the
// player or manager endpoint (both accept any phase, current or archived).
function PhaseEditor({
  phase,
  kind,
  onCancel,
  onSaved,
}: {
  phase: ContractPhase
  kind: 'player' | 'manager'
  onCancel: () => void
  onSaved: () => void
}) {
  const { t } = useTranslation()
  const [feePounds, setFeePounds] = useState(phase.feePence / 100)
  const [weeklyWagePounds, setWeeklyWagePounds] = useState(Math.round(phase.annualWagePence / 52 / 100))
  const [agentPounds, setAgentPounds] = useState(phase.agentFeePence / 100)
  const [startDate, setStartDate] = useState(phase.startDate)
  const [endDate, setEndDate] = useState(phase.endDate)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const save = async () => {
    setSaving(true)
    setError('')
    try {
      const feePence = (isFinite(feePounds) ? feePounds : 0) * 100
      const annualWagePence = (isFinite(weeklyWagePounds) ? weeklyWagePounds : 0) * 52 * 100
      const agentFeePence = (isFinite(agentPounds) ? agentPounds : 0) * 100
      if (kind === 'player') {
        await api.roster.updateContract(phase.id, {
          transferFeePence: feePence,
          annualWagePence,
          agentFeePence,
          startDate,
          endDate,
        })
      } else {
        await api.roster.updateManagerContract(phase.id, {
          feePence,
          annualWagePence,
          agentFeePence,
          startDate,
          endDate,
        })
      }
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('roster.phase.failSave'))
      setSaving(false)
    }
  }

  return (
    <div className="mt-3 space-y-3">
      <div className="grid grid-cols-3 gap-3">
        <Field label={t('roster.phase.fee')}>
          <PoundInput value={feePounds} onChange={setFeePounds} />
        </Field>
        <Field label={t('roster.phase.weeklyWage')}>
          <PoundInput value={weeklyWagePounds} onChange={setWeeklyWagePounds} />
        </Field>
        <Field label={t('roster.phase.agentFee')}>
          <PoundInput value={agentPounds} onChange={setAgentPounds} />
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Field label={t('roster.phase.start')}>
          <DatePicker value={startDate} onChange={setStartDate} required />
        </Field>
        <Field label={t('roster.phase.end')}>
          <DatePicker value={endDate} onChange={setEndDate} required />
        </Field>
      </div>
      {error && <div className="text-[12px] text-red-600">{error}</div>}
      <div className="flex items-center justify-end gap-1.5">
        <IconButton label={t('common.cancel')} tone="neutral" disabled={saving} onClick={onCancel}>
          <CloseIcon />
        </IconButton>
        <IconButton label={saving ? t('common.saving') : t('roster.phase.savePhase')} tone="violet" disabled={saving} onClick={save}>
          {saving ? <Spinner size={14} /> : <CheckIcon />}
        </IconButton>
      </div>
    </div>
  )
}

function PhaseTypePill({ phaseType }: { phaseType: ContractPhase['phaseType'] }) {
  const { t } = useTranslation()
  const isExt = phaseType === 'EXTENSION'
  return (
    <span
      className={cn(
        'inline-block text-[10px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wide',
        isExt ? 'bg-violet-100 text-violet-700' : 'bg-slate-100 text-slate-600'
      )}
    >
      {isExt ? t('roster.phase.extension') : t('roster.phase.initial')}
    </span>
  )
}

function PhaseStatusPill({ status }: { status: ContractPhase['status'] }) {
  const styles: Record<ContractPhase['status'], string> = {
    ACTIVE: 'bg-emerald-100 text-emerald-700',
    SCHEDULED: 'bg-violet-100 text-violet-700',
    COMPLETED: 'bg-slate-200 text-slate-600',
    ARCHIVED: 'bg-slate-200 text-slate-500',
  }
  return <span className={cn('rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide', styles[status])}>{status.toLowerCase()}</span>
}

// ---------------------------------------------------------------------------
// Extend Contract wizard — supersedes the current phase. Shared by player +
// manager (the `submit` callback targets the right endpoint).
// ---------------------------------------------------------------------------
function ExtendContractWizard({
  subjectLabel,
  currentContract,
  onClose,
  submit,
  onExtended,
}: {
  subjectLabel: string
  currentContract: {
    feePence: number
    carriedBookValuePence: number | null
    acquisitionAgentFeePence?: number
    acquisitionDate?: string
    annualWagePence: number
    agentFeePence: number
    startDate: string
    endDate: string
  }
  onClose: () => void
  submit: (input: ExtendContractInput) => Promise<unknown>
  onExtended: () => void
}) {
  const { t } = useTranslation()
  const { format: fmtMoney } = useWorkspaceCurrency()
  const seasonStartYear = useSeasonStore((state) => state.startYear)
  // The extension begins exactly when the current deal expires — it's derived
  // from the current contract's end date, never picked by hand. (Previously a
  // free date field let you "extend" a deal from an arbitrary, even already-
  // past, date.) New wage seeds from the current wage so a "same terms, longer
  // deal" renewal is a one-field change.
  const effectiveDate = dayAfter(currentContract.endDate)
  const extensionSignedDate = seasonAsOfDate(seasonStartYear).toISOString().slice(0, 10)
  const [newEndDate, setNewEndDate] = useState('')
  const [wagePounds, setWagePounds] = useState(currentContract.annualWagePence / 52 / 100)
  const [agentPounds, setAgentPounds] = useState(NaN)
  const [amortisationTreatment, setAmortisationTreatment] = useState<ExtendContractInput['amortisationTreatment']>('CONTINUE_CURRENT_SCHEDULE')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const weeklyWagePence = Math.round((Number.isFinite(wagePounds) ? wagePounds : 0) * 100)
  const annualWagePence = weeklyWagePence * 52
  const agentFeePence = Math.round((Number.isFinite(agentPounds) ? agentPounds : 0) * 100)
  const currentPhase = {
    id: 'current',
    startDate: currentContract.startDate,
    endDate: currentContract.endDate,
    annualWagePence: currentContract.annualWagePence,
    agentFeePence: currentContract.agentFeePence,
    amortisationTreatment: 'CONTINUE_CURRENT_SCHEDULE' as const,
  }
  const previewPhases = newEndDate ? [
    currentPhase,
    {
      id: 'extension',
      startDate: effectiveDate,
      endDate: newEndDate,
      annualWagePence,
      agentFeePence,
      amortisationTreatment,
      extensionSignedDate,
    },
  ] : []
  const registrationAsset = {
    acquisitionFeePence: currentContract.feePence,
    acquisitionAgentFeePence: currentContract.acquisitionAgentFeePence ?? currentContract.agentFeePence,
    acquisitionDate: currentContract.acquisitionDate ?? currentContract.startDate,
    carryingValuePence: currentContract.carriedBookValuePence,
  }
  const currentPreview = calculateRegistrationCost(
    registrationAsset,
    [currentPhase],
    new Date(`${extensionSignedDate}T00:00:00Z`),
  )
  const extensionPreview = newEndDate
    ? calculateRegistrationCost(registrationAsset, previewPhases, new Date(`${extensionSignedDate}T00:00:00Z`))
    : null

  const go = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      const input: ExtendContractInput = {
        effectiveDate,
        extensionSignedDate,
        newEndDate,
        newWeeklyWagePence: weeklyWagePence,
        newAgentFeePence: agentFeePence,
        amortisationTreatment,
      }
      await submit(input)
      onExtended()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('roster.extension.failLog'))
      setSubmitting(false)
    }
  }

  return (
    <ModalShell onClose={onClose} title={`Renew ${subjectLabel}`} size="compact">
      <form onSubmit={go} className="max-h-[80vh] overflow-y-auto">
        <div className="space-y-4 px-5 py-5">
            <div className="rounded-lg border border-violet-100 bg-violet-50/70 px-4 py-3 text-[12.5px] text-slate-600">
              <Trans i18nKey="roster.extension.intro" values={{ date: formatDate(effectiveDate) }} components={{ d: <span className="num font-medium text-slate-800" /> }} />
            </div>
            <Field label="Current contract end"><div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[14px] text-slate-500 num">{formatDate(currentContract.endDate)}</div></Field>
            <Field label={t('roster.extension.newEndDate')}><DatePicker value={newEndDate} onChange={setNewEndDate} required min={effectiveDate} /></Field>
            <Field label={t('roster.extension.newWeeklyWage')}><PoundInput value={wagePounds} onChange={setWagePounds} /></Field>
            <Field label={t('roster.extension.newAgentFees')}><PoundInput value={agentPounds} onChange={setAgentPounds} /></Field>
            <details className="rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2 text-[13px] text-slate-600">
              <summary className="cursor-pointer font-medium text-slate-700">Advanced accounting</summary>
              <label className="mt-3 block text-[11px] font-medium uppercase tracking-[0.08em] text-slate-500">Amortisation treatment</label>
              <select
                value={amortisationTreatment}
                onChange={(event) => setAmortisationTreatment(event.target.value as ExtendContractInput['amortisationTreatment'])}
                className="mt-1.5 h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-[13px] text-slate-800"
              >
                <option value="CONTINUE_CURRENT_SCHEDULE">Continue current schedule</option>
                <option value="SPREAD_REMAINING_BOOK_VALUE">Spread remaining book value over extended term</option>
              </select>
            </details>
            {extensionPreview && (
              <div className="grid grid-cols-3 gap-2 rounded-lg border border-slate-200 bg-slate-50/70 p-3">
                <CostMetric label={t('roster.extension.currentAnnualCost')} value={fmtMoney(currentPreview.totalAnnualCostPence)} />
                <CostMetric label={t('roster.extension.newAnnualCost')} value={fmtMoney(extensionPreview.totalAnnualCostPence)} />
                <CostMetric label={t('roster.extension.change')} value={fmtMoney(extensionPreview.totalAnnualCostPence - currentPreview.totalAnnualCostPence)} />
              </div>
            )}
        </div>
        {error && <div className="mx-5 mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700">{error}</div>}
        <div className="sticky bottom-0 flex items-center justify-end gap-3 border-t border-slate-100 bg-white px-5 py-4">
          <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>{t('roster.extension.back')}</Button>
          <Button type="submit" disabled={submitting}>{submitting ? <Spinner size={14} /> : null}{submitting ? t('roster.extension.logging') : t('roster.extension.logExtension')}</Button>
        </div>
      </form>
    </ModalShell>
  )
}

function dayAfter(isoDate: string): string {
  const value = new Date(`${isoDate.slice(0, 10)}T00:00:00Z`)
  value.setUTCDate(value.getUTCDate() + 1)
  return value.toISOString().slice(0, 10)
}

// Compact info tooltip beside a field label. Rendered through a portal to
// <body> and positioned off the icon's screen rect — the centred-above bubble
// is clamped to the viewport so it can't be clipped by the modal's edge (the
// "NEW CONTRACT END DATE" icon sits close to the right border).
function InfoTooltip({ text }: { text: string }) {
  const { t } = useTranslation()
  const iconRef = useRef<HTMLButtonElement>(null)
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null)

  const BUBBLE_WIDTH = 224 // matches w-56
  const MARGIN = 8

  const show = () => {
    const r = iconRef.current?.getBoundingClientRect()
    if (!r) return
    const centre = r.left + r.width / 2
    const half = BUBBLE_WIDTH / 2
    // Clamp the bubble's left edge inside the viewport.
    const left = Math.min(
      Math.max(centre - half, MARGIN),
      window.innerWidth - BUBBLE_WIDTH - MARGIN,
    )
    setCoords({ top: r.top - MARGIN, left })
  }
  const hide = () => setCoords(null)

  return (
    <span className="relative inline-flex">
      <button
        ref={iconRef}
        type="button"
        aria-label={t('roster.form.moreInfo')}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-slate-200 text-slate-600 text-[10px] font-semibold hover:bg-slate-300 transition-colors"
      >
        i
      </button>
      {coords &&
        createPortal(
          <span
            role="tooltip"
            className="pointer-events-none fixed z-[1000] -translate-y-full rounded-lg bg-slate-900 px-3 py-2 text-[11.5px] leading-snug text-white shadow-lg normal-case tracking-normal font-normal"
            style={{ width: BUBBLE_WIDTH, top: coords.top, left: coords.left }}
          >
            {text}
          </span>,
          document.body,
        )}
    </span>
  )
}

function ExtendIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12h14" />
      <path d="M13 6l6 6-6 6" />
    </svg>
  )
}

function CoachIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20a8 8 0 0 1 16 0" />
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Generic UI pieces (kept local — too small to factor out into ui/ kit)
// ---------------------------------------------------------------------------
function ModalShell({
  onClose,
  title,
  children,
  size = 'default',
  layout = 'modal',
}: {
  onClose: () => void
  title: string
  children: React.ReactNode
  size?: 'compact' | 'default'
  layout?: 'modal' | 'drawer'
}) {
  const { t } = useTranslation()
  useScrollLock()
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
        className={cn('fixed inset-0 z-50 flex bg-slate-900/40 backdrop-blur-[2px] overscroll-contain', layout === 'drawer' ? 'items-stretch justify-end' : 'items-stretch justify-center sm:items-center sm:p-4')}
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
          className={cn(
            'flex flex-col bg-white shadow-2xl border border-slate-200 overflow-hidden',
            layout === 'drawer'
              ? 'flex h-[100dvh] w-full max-w-[460px] flex-col rounded-none sm:rounded-l-2xl'
              : cn('h-[100dvh] w-full rounded-none sm:h-auto sm:max-h-[90dvh] sm:rounded-2xl', size === 'compact' ? 'sm:max-w-xl' : 'sm:max-w-3xl'),
          )}
        >
          <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
            <h2 className="text-[16px] font-semibold text-slate-900">{title}</h2>
            <button
              onClick={onClose}
              aria-label={t('roster.form.close')}
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

function SelectControl({
  children,
  className,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="relative">
      <select {...props} className={cn(className, 'appearance-none pr-10')}>
        {children}
      </select>
      <svg
        className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden="true"
      >
        <path d="m6 9 6 6 6-6" />
      </svg>
    </div>
  )
}

function Field({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  // String labels carry a "(£)" money hint; swap it for the workspace symbol so
  // every form field re-labels instantly when the currency changes. Non-money
  // labels contain no "£" and are unaffected; JSX labels pass through untouched.
  const { symbol } = useWorkspaceCurrency()
  const rendered =
    typeof label === 'string' && symbol !== '£' ? label.replaceAll('£', symbol) : label
  return (
    <label className="block">
      <span className="meta-label block mb-1.5">{rendered}</span>
      {children}
    </label>
  )
}

function PoundInput({
  value,
  onChange,
  invalid = false,
}: {
  value: number
  onChange: (n: number) => void
  // Red-rings the field — used to flag a zero wage as a validation error.
  invalid?: boolean
}) {
  const { symbol } = useWorkspaceCurrency()
  return (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-[14px]">{symbol}</span>
      <NumericInput
        value={value}
        onChange={onChange}
        className={cn(fieldClass, 'pl-7 num', invalid && 'border-red-300 ring-1 ring-red-200 focus-visible:ring-red-400')}
        placeholder="0"
      />
    </div>
  )
}
