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
import { useTranslation, Trans } from 'react-i18next'
import type { TFunction } from 'i18next'
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
  queryKeys,
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
import { useSeasonStore, seasonKey } from '@/stores/season'
import { exportAmortisationXLSX } from '@/lib/exports/amortisationXlsx'
import { findCountry, countryName } from '@/lib/countries'
import { Flag } from '@/components/ui/flag'
import { useWorkspaceCurrency } from '@/lib/useWorkspaceCurrency'
import { activeLocale } from '@/lib/locale'
import { useScrollLock } from '@/lib/useScrollLock'
import { useCopilot } from '@/stores/copilot'
import { CopilotTriggerIcon } from '@/components/ai/CopilotTrigger'
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

// Annualised amortisation of a capitalised fee under the 5-year regulatory cap
// (the Chelsea Rule). Mirrors amortisationPeriodYears in @85percent/engine.
function annualAmortisation(feePence: number, contractLengthYears: number): number {
  if (feePence <= 0) return 0
  const years = contractLengthYears > 0 ? contractLengthYears : 1
  return Math.floor(feePence / Math.min(years, 5))
}

const POSITIONS: PlayerPosition[] = ['GK', 'DEF', 'MID', 'FWD']

// ---------------------------------------------------------------------------
// Top-level page
// ---------------------------------------------------------------------------
export function RosterPage() {
  const { t } = useTranslation()
  const can = useCan()
  const navigate = useNavigate()
  const { clubName, financials, setFinancials } = useClubStore()
  const { format: fmtMoney } = useWorkspaceCurrency()
  const openCopilot = useCopilot((s) => s.open)

  // Phase 4 trigger — serialize one player's engine figures and open the Co-pilot.
  const handleAskCopilotPlayer = (p: PlayerWithContract) => {
    const c = p.contract
    if (!c) return
    const feePence = c.carriedBookValuePence ?? c.transferFeePence
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
        annualAmortisation: fmtMoney(annualAmortisation(feePence, c.contractLengthYears)),
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

  // Filters (Squad tab)
  const [filter, setFilter] = useState<'all' | 'expiring' | PlayerPosition>('all')

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
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.roster }),
      queryClient.invalidateQueries({ queryKey: queryKeys.rosterArchived }),
      queryClient.invalidateQueries({ queryKey: queryKeys.manager }),
    ])
    try {
      setFinancials(await api.club.getFinancials(season))
    } catch {
      /* keep the existing store financials on a transient failure */
    }
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

  if (rosterQuery.isPending || archivedQuery.isPending || managerQuery.isPending)
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
            <Button
              variant="ghost"
              onClick={() => exportAmortisationXLSX({
                clubName: clubName ?? '85Percent FC',
                season: financials?.season ?? seasonKey(useSeasonStore.getState().startYear),
                players: active,
                currency: useClubStore.getState().baseCurrency,
              })}
              disabled={active.length === 0}
              title={t('roster.exportExcelTitle')}
            >
              {t('roster.exportExcel')}
            </Button>
            {can.mutateRoster && (
              <>
                <Button variant="secondary" onClick={() => setCsvOpen(true)}>
                  {t('roster.uploadCsv')}
                </Button>
                <Button onClick={() => setManualOpen(true)}>{t('roster.addPlayer')}</Button>
              </>
            )}
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
}) {
  const { t } = useTranslation()
  const showActions = archived && canMutate && !!onRestore && !!onRequestDelete && !!onConfirmDelete && !!onCancelDelete
  const { format: fmtMoney } = useWorkspaceCurrency()

  // Column sorting — defaults to shirt number ascending (unassigned last), the
  // order sporting directors expect when scanning a squad sheet. Clicking a
  // header toggles direction, mirroring the Dashboard's per-column sort.
  const [sortKey, setSortKey] = useState<RosterSortKey>('squadNumber')
  const [sortDir, setSortDir] = useState<RosterSortDir>('asc')
  const sortedPlayers = useMemo(() => {
    const dir = sortDir === 'asc' ? 1 : -1
    return [...players].sort((a, b) => {
      switch (sortKey) {
        case 'name':        return a.name.localeCompare(b.name) * dir
        case 'position':    return (a.position ?? '').localeCompare(b.position ?? '') * dir
        case 'wage':        return ((a.contract?.annualWagePence ?? 0) - (b.contract?.annualWagePence ?? 0)) * dir
        case 'book':        return ((a.contract?.bookValuePence ?? 0) - (b.contract?.bookValuePence ?? 0)) * dir
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
          const an = a.squadNumber ?? Infinity
          const bn = b.squadNumber ?? Infinity
          if (an !== bn) return (an - bn) * dir
          return a.name.localeCompare(b.name)
        }
      }
    })
  }, [players, sortKey, sortDir, archived])

  const handleSort = (f: RosterSortKey, d: RosterSortDir) => { setSortKey(f); setSortDir(d) }

  return (
    <Card className="overflow-hidden">
      <div className="overflow-x-auto">
      <table className="w-full min-w-[760px]">
        <thead className="border-b border-slate-100">
          <tr>
            <SortableTh field="squadNumber" label="#"            align="right" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
            <SortableTh field="name"        label={t('roster.th.name')}        sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
            <SortableTh field="position"    label={t('roster.th.position')}    sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
            <SortableTh field="wage"        label={t('roster.th.wage')} align="right"  sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
            <SortableTh field="book"        label={t('roster.th.book')} align="right"  sortKey={sortKey} sortDir={sortDir} onSort={handleSort} info={<BookValueInfo />} />
            <SortableTh field="contractEnd" label={t('roster.th.contractEnd')}  sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
            <SortableTh field="expiry"      label={archived ? t('roster.th.archived') : t('roster.th.expiry')} align="right" sortKey={sortKey} sortDir={sortDir} onSort={handleSort} />
            {showActions && <Th align="right">{t('roster.th.actions')}</Th>}
          </tr>
        </thead>
        <tbody>
          {sortedPlayers.map((p) => (
            <tr
              key={p.id}
              onClick={() => onRowClick(p)}
              className={cn(
                'group border-b border-slate-100 last:border-0 transition-colors',
                !archived && 'hover:bg-violet-50/60 cursor-pointer'
              )}
            >
              <td className="px-5 py-3.5 text-right text-[13px] num text-slate-500 tabular-nums w-12">
                {p.squadNumber ?? '—'}
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
                      fmtMoney(p.contract.annualWagePence)
                    )}
                  </td>
                )
              })()}
              {(() => {
                const needsFee = flagZeroWage && !archived && !!p.contract && p.contract.bookValuePence === 0
                return (
                  <td className="px-5 py-3.5 text-[13px] num text-right text-slate-700">
                    {!p.contract ? (
                      '—'
                    ) : needsFee ? (
                      <span className="inline-flex items-center justify-end gap-1.5 text-slate-400">
                        {fmtMoney(0)}
                        <FinancialWarning />
                      </span>
                    ) : (
                      fmtMoney(p.contract.bookValuePence)
                    )}
                  </td>
                )
              })()}
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
      </div>
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
type RosterSortKey = 'squadNumber' | 'name' | 'position' | 'wage' | 'book' | 'contractEnd' | 'expiry'
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

// "49" → "4 years 1 month" — years lead, months only when non-zero, singular/plural correct.
function formatExpiryLabel(months: number, t: TFunction): string {
  const years = Math.floor(months / 12)
  const rem = months % 12
  if (years === 0) return t('dashboard.expiry.months', { count: rem })
  const yearPart = t('dashboard.expiry.years', { count: years })
  if (rem === 0) return yearPart
  return `${yearPart} ${t('dashboard.expiry.months', { count: rem })}`
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
        {formatExpiryLabel(months, t)}
      </span>
    )
  }
  return <span className="text-slate-500 whitespace-nowrap">{formatExpiryLabel(months, t)}</span>
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
          <p className="text-[13px] text-slate-600">
            <Trans
              i18nKey="roster.csv.instructions"
              components={{
                c0: <code className="text-[12px] bg-slate-100 px-1.5 py-0.5 rounded" />,
                c1: <code className="text-[12px] bg-slate-100 px-1.5 py-0.5 rounded" />,
                c2: <code className="text-[12px] bg-slate-100 px-1.5 py-0.5 rounded" />,
                c3: <code className="text-[12px] bg-slate-100 px-1.5 py-0.5 rounded" />,
                c4: <code className="text-[12px] bg-slate-100 px-1.5 py-0.5 rounded" />,
              }}
            />
          </p>
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
        <select value={position} onChange={(e) => setPosition(e.target.value as PlayerPosition)} className={cellInput}>
          {POSITIONS.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
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
          placeholder={t('roster.csv.dobPlaceholder')}
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
        <DatePicker value={startDate} onChange={setStartDate} placeholder={t('roster.csv.startPlaceholder')} />
      </td>
      <td className="px-2 py-2 align-top">
        <DatePicker value={endDate} onChange={setEndDate} placeholder={t('roster.csv.endPlaceholder')} />
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
  const [name, setName] = useState('')
  const [position, setPosition] = useState<PlayerPosition>('MID')
  const [squadNumber, setSquadNumber] = useState(NaN)
  const [nationality, setNationality] = useState<string | null>(null)
  const [dateOfBirth, setDateOfBirth] = useState('')
  const [transferPounds, setTransferPounds] = useState(NaN)
  const [weeklyWagePounds, setWeeklyWagePounds] = useState(NaN)
  const [agentPounds, setAgentPounds] = useState(NaN)
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [joinedDate, setJoinedDate] = useState('')
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
        ...(Number.isFinite(squadNumber) && squadNumber >= 1 ? { squadNumber } : {}),
        ...(cleanNationality ? { nationality: cleanNationality } : {}),
        ...(dateOfBirth ? { dateOfBirth } : {}),
        ...(joinedDate ? { joinedDate } : {}),
        transferFeePence: (isFinite(transferPounds) ? transferPounds : 0) * 100,
        annualWagePence:  (isFinite(weeklyWagePounds) ? weeklyWagePounds : 0) * 52 * 100,
        agentFeePence:    (isFinite(agentPounds) ? agentPounds : 0) * 100,
        startDate,
        endDate,
      }
      await api.roster.createPlayer(payload)
      onCreated()
    } catch (e) {
      setError(e instanceof Error ? e.message : t('roster.form.failCreatePlayer'))
      setSaving(false)
    }
  }

  return (
    <ModalShell onClose={onClose} title={t('roster.manual.title')}>
      <form onSubmit={submit} className="px-5 pb-5 space-y-4 max-h-[80vh] overflow-y-auto overflow-x-visible">
        <Field label={t('roster.form.name')}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={80}
            className={fieldClass}
          />
        </Field>

        <div className="grid grid-cols-[1fr_1fr] gap-4">
          <Field label={t('roster.form.position')}>
            <select value={position} onChange={(e) => setPosition(e.target.value as PlayerPosition)} className={fieldClass}>
              {POSITIONS.map((p) => <option key={p} value={p}>{t(`common.positions.${p}`)}</option>)}
            </select>
          </Field>
          <Field label={t('roster.form.squadNumberOptional')}>
            <NumericInput value={squadNumber} onChange={setSquadNumber} className={fieldClass} placeholder={t('roster.form.squadNumberPlaceholder')} />
          </Field>
        </div>
        <Field label={t('roster.form.nationalityOptional')}>
          <CountryPicker value={nationality} onChange={setNationality} placeholder={t('roster.form.selectCountry')} />
        </Field>

        <Field
          label={
            <span className="flex items-center justify-between">
              <span>{t('roster.form.dobOptional')}</span>
              {computedAge != null && (
                <span className="text-[11px] font-normal text-slate-500 normal-case tracking-normal">
                  {t('roster.form.age')} <span className="num text-slate-700 font-medium">{computedAge}</span>
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
            placeholder={t('roster.form.selectDob')}
          />
        </Field>

        <div className="grid grid-cols-3 gap-4">
          <Field label={t('roster.form.transferFee')}>
            <PoundInput value={transferPounds} onChange={setTransferPounds} />
          </Field>
          <Field label={t('roster.form.weeklyWage')}>
            <PoundInput value={weeklyWagePounds} onChange={setWeeklyWagePounds} />
          </Field>
          <Field label={t('roster.form.agentFee')}>
            <PoundInput value={agentPounds} onChange={setAgentPounds} />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label={t('roster.form.contractStart')}>
            <DatePicker value={startDate} onChange={setStartDate} required placeholder={t('roster.form.selectStartDate')} />
          </Field>
          <Field label={t('roster.form.contractEnd')}>
            <DatePicker value={endDate} onChange={setEndDate} required placeholder={t('roster.form.selectEndDate')} />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field
            label={
              <span className="inline-flex items-center gap-1.5">
                {t('roster.form.joinedOptional')}
                <InfoTooltip text={t('roster.form.joinedTooltip')} />
              </span>
            }
          >
            <DatePicker value={joinedDate} onChange={setJoinedDate} placeholder={t('roster.form.joinedDefaultPlaceholder')} />
          </Field>
        </div>

        {error && (
          <div className="border border-red-200 bg-red-50 rounded-lg px-4 py-3 text-[13px] text-red-700">
            {error}
          </div>
        )}

        <div className="flex items-center justify-end gap-3 pt-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? <Spinner size={14} /> : null}
            {saving ? t('common.saving') : t('roster.form.addPlayer')}
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
  const [transferPounds, setTransferPounds] = useState(c ? c.transferFeePence / 100 : NaN)
  const [weeklyWagePounds, setWeeklyWagePounds] = useState(c ? Math.round(c.annualWagePence / 52 / 100) : NaN)
  const [agentPounds, setAgentPounds] = useState(c ? c.agentFeePence / 100 : NaN)
  const [startDate, setStartDate] = useState(c?.startDate ?? '')
  const [endDate, setEndDate] = useState(c?.endDate ?? '')

  // Carried Book Value override (advanced, progressively disclosed). An imported
  // extension block (EXTENSION phase, no fee, no override) is flagged for audit
  // and auto-reveals; an already-set override stays revealed too.
  const needsBookValueAudit =
    !!c && c.phaseType === 'EXTENSION' && c.carriedBookValuePence == null && c.transferFeePence === 0
  const [carriedPounds, setCarriedPounds] = useState(
    c && c.carriedBookValuePence != null ? c.carriedBookValuePence / 100 : NaN,
  )
  const [showCarried, setShowCarried] = useState(
    !!c && (c.carriedBookValuePence != null || needsBookValueAudit),
  )
  const [saving, setSaving] = useState(false)
  const [archiving, setArchiving] = useState(false)
  const [confirmArchive, setConfirmArchive] = useState(false)
  const [error, setError] = useState('')

  // Contract ledger (all phases) + extension wizard state.
  const [phases, setPhases] = useState<ContractPhase[]>([])
  const [extendOpen, setExtendOpen] = useState(false)

  const reloadPhases = () => {
    api.roster
      .playerPhases(player.id)
      .then((r) => setPhases(r.phases))
      .catch(() => { /* ledger is supplementary — silent on failure */ })
  }

  useEffect(() => {
    if (!c) return
    let cancelled = false
    api.roster
      .playerPhases(player.id)
      .then((r) => { if (!cancelled) setPhases(r.phases) })
      .catch(() => { /* ledger is supplementary — silent on failure */ })
    return () => { cancelled = true }
  }, [player.id, c])

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
        const contractPatch: Parameters<typeof api.roster.updateContract>[1] = {}
        const transferPence = (isFinite(transferPounds) ? transferPounds : 0) * 100
        const annualWagePence = (isFinite(weeklyWagePounds) ? weeklyWagePounds : 0) * 52 * 100
        const agentPence = (isFinite(agentPounds) ? agentPounds : 0) * 100

        if (transferPence !== c.transferFeePence)   contractPatch.transferFeePence = transferPence
        if (annualWagePence !== c.annualWagePence)  contractPatch.annualWagePence = annualWagePence
        if (agentPence !== c.agentFeePence)         contractPatch.agentFeePence = agentPence
        if (startDate !== c.startDate)              contractPatch.startDate = startDate
        if (endDate !== c.endDate)                  contractPatch.endDate = endDate

        // Carried Book Value override: a number when revealed & filled, else null
        // (hidden or cleared reverts to standard transfer-fee amortisation).
        const nextCarried =
          showCarried && Number.isFinite(carriedPounds) && carriedPounds >= 0
            ? Math.round(carriedPounds * 100)
            : null
        if (nextCarried !== c.carriedBookValuePence) contractPatch.carriedBookValuePence = nextCarried

        if (Object.keys(contractPatch).length > 0) {
          await api.roster.updateContract(c.id, contractPatch)
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

  return (
    <>
    <ModalShell onClose={onClose} title={t('roster.edit.title', { name: player.name })}>
      <form onSubmit={save} className="px-5 pb-5 space-y-4 max-h-[80vh] overflow-y-auto overflow-x-visible">
        <Field label={t('roster.form.name')}>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={80}
            className={fieldClass}
          />
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label={t('roster.form.position')}>
            <select value={position} onChange={(e) => setPosition(e.target.value as PlayerPosition)} className={fieldClass}>
              {POSITIONS.map((p) => <option key={p} value={p}>{t(`common.positions.${p}`)}</option>)}
            </select>
          </Field>
          <Field label={t('roster.form.squadNumber')}>
            <NumericInput value={squadNumber} onChange={setSquadNumber} className={fieldClass} placeholder={t('roster.form.squadNumberPlaceholder')} />
          </Field>
        </div>
        <Field label={t('roster.form.nationality')}>
          <CountryPicker value={nationality} onChange={setNationality} placeholder={t('roster.form.selectCountry')} />
        </Field>

        <Field
          label={
            <span className="flex items-center justify-between">
              <span>{t('roster.form.dobOptional')}</span>
              {computedAge != null && (
                <span className="text-[11px] font-normal text-slate-500 normal-case tracking-normal">
                  {t('roster.form.age')} <span className="num text-slate-700 font-medium">{computedAge}</span>
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
            placeholder={t('roster.form.selectDob')}
          />
        </Field>

        {c && (
          <>
            <div className="border-t border-slate-100 pt-4">
              <div className="meta-label mb-3">{t('roster.edit.contract')}</div>
              <div className="grid grid-cols-3 gap-4">
                <Field label={t('roster.form.transferFee')}>
                  <PoundInput
                    value={transferPounds}
                    onChange={setTransferPounds}
                    invalid={!Number.isFinite(transferPounds) || transferPounds === 0}
                  />
                </Field>
                <Field label={t('roster.form.weeklyWage')}>
                  <PoundInput
                    value={weeklyWagePounds}
                    onChange={setWeeklyWagePounds}
                    invalid={!Number.isFinite(weeklyWagePounds) || weeklyWagePounds === 0}
                  />
                </Field>
                <Field label={t('roster.form.agentFee')}>
                  <PoundInput value={agentPounds} onChange={setAgentPounds} />
                </Field>
              </div>

              <CarriedBookValueField
                show={showCarried}
                needsAudit={needsBookValueAudit}
                valuePounds={carriedPounds}
                onReveal={() => setShowCarried(true)}
                onChange={setCarriedPounds}
                onHide={() => { setShowCarried(false); setCarriedPounds(NaN) }}
              />

              <div className="grid grid-cols-2 gap-4 mt-4">
                <Field
                  label={
                    <span className="inline-flex items-center gap-1.5">
                      {t('roster.form.contractStart')}
                      {player.joinedDate && player.joinedDate !== startDate && (
                        <InfoTooltip
                          text={t('roster.edit.extStartTooltip', { date: formatDate(player.joinedDate) })}
                        />
                      )}
                    </span>
                  }
                >
                  <DatePicker value={startDate} onChange={setStartDate} required placeholder={t('roster.form.selectStartDate')} />
                </Field>
                <Field label={t('roster.form.contractEnd')}>
                  <DatePicker value={endDate} onChange={setEndDate} required placeholder={t('roster.form.selectEndDate')} />
                </Field>
              </div>

              <div className="grid grid-cols-2 gap-4 mt-4">
                <Field
                  label={
                    <span className="inline-flex items-center gap-1.5">
                      {t('roster.form.joined')}
                      <InfoTooltip text={t('roster.form.joinedTooltipEdit')} />
                    </span>
                  }
                >
                  <DatePicker value={joinedDate} onChange={setJoinedDate} placeholder={t('roster.form.selectJoinDate')} />
                </Field>
              </div>

              <p className="mt-2 text-[12px] text-slate-500">
                {t('roster.edit.currentBookValue', { value: fmtMoney(c.bookValuePence) })}
              </p>

              {/* Contract ledger — only meaningful once there's history beyond
                  the initial signing. The current phase is always shown above. */}
              {phases.length > 1 && (
                <div className="mt-4">
                  <div className="meta-label mb-2">{t('roster.edit.contractPhases')}</div>
                  <ContractLedger phases={phases} kind="player" canEdit={can.mutateRoster} onChanged={reloadPhases} />
                </div>
              )}

              {can.mutateRoster && (
                <div className="mt-4">
                  <Button type="button" variant="outline" onClick={() => setExtendOpen(true)}>
                    <ExtendIcon /> {t('roster.edit.logExtension')}
                  </Button>
                </div>
              )}
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
                <span className="text-[13px] text-slate-700">{t('roster.edit.archivePrompt', { name: player.name })}</span>
                <Button type="button" variant="destructive" onClick={archive} disabled={archiving}>
                  {archiving ? <Spinner size={14} /> : null}
                  {archiving ? t('roster.edit.archiving') : t('roster.edit.confirm')}
                </Button>
                <Button type="button" variant="ghost" onClick={() => setConfirmArchive(false)} disabled={archiving}>
                  {t('common.cancel')}
                </Button>
              </div>
            ) : (
              <Button type="button" variant="ghost" className="text-red-600 hover:text-red-700 hover:bg-red-50" onClick={() => setConfirmArchive(true)}>
                {t('roster.edit.archivePlayer')}
              </Button>
            )
          ) : <div />}
          <div className="flex items-center gap-3">
            <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
              {t('roster.form.close')}
            </Button>
            {can.mutateRoster && (
              <Button type="submit" disabled={saving}>
                {saving ? <Spinner size={14} /> : null}
                {saving ? t('common.saving') : t('roster.edit.saveChanges')}
              </Button>
            )}
          </div>
        </div>
      </form>
    </ModalShell>

    {extendOpen && c && (
      <ExtendContractWizard
        subjectLabel={player.name}
        currentEndDate={c.endDate}
        currentWeeklyWagePence={Math.round(c.annualWagePence / 52)}
        onClose={() => setExtendOpen(false)}
        submit={(input) => api.roster.extendPlayer(player.id, input)}
        onExtended={onSaved}
      />
    )}
    </>
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

        <div className="flex items-center gap-8">
          <div className="text-right">
            <div className="meta-label">{t('roster.manager.annualWage')}</div>
            <div className="num text-[13px] mt-0.5 whitespace-nowrap text-slate-900">
              {!c ? (
                '—'
              ) : needsWage ? (
                <span className="inline-flex items-center justify-end gap-1.5 text-slate-400">
                  {fmtMoney(0)}
                  <FinancialWarning />
                </span>
              ) : (
                fmtMoney(c.annualWagePence)
              )}
            </div>
          </div>
        </div>
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
  const [nationality, setNationality] = useState<string | null>(null)
  const [compPounds, setCompPounds] = useState(NaN)
  const [weeklyWagePounds, setWeeklyWagePounds] = useState(NaN)
  const [agentPounds, setAgentPounds] = useState(NaN)
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      const cleanNationality = nationality?.trim() ?? ''
      const payload: ManagerInput = {
        name: name.trim(),
        ...(cleanNationality ? { nationality: cleanNationality } : {}),
        compensationFeePence: (isFinite(compPounds) ? compPounds : 0) * 100,
        annualWagePence: (isFinite(weeklyWagePounds) ? weeklyWagePounds : 0) * 52 * 100,
        agentFeePence: (isFinite(agentPounds) ? agentPounds : 0) * 100,
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
    <ModalShell onClose={onClose} title={t('roster.manager.addCoach')}>
      <form onSubmit={submit} className="px-5 pb-5 space-y-4 max-h-[80vh] overflow-y-auto overflow-x-visible">
        <Field label={t('roster.form.name')}>
          <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} className={fieldClass} />
        </Field>
        <Field label={t('roster.form.nationality')}>
          <CountryPicker value={nationality} onChange={setNationality} placeholder={t('roster.form.selectCountry')} />
        </Field>
        <div className="grid grid-cols-3 gap-4">
          <Field label={t('roster.form.compFee')}>
            <PoundInput value={compPounds} onChange={setCompPounds} />
          </Field>
          <Field label={t('roster.form.weeklyWage')}>
            <PoundInput value={weeklyWagePounds} onChange={setWeeklyWagePounds} />
          </Field>
          <Field label={t('roster.form.agentFee')}>
            <PoundInput value={agentPounds} onChange={setAgentPounds} />
          </Field>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Field label={t('roster.form.contractStart')}>
            <DatePicker value={startDate} onChange={setStartDate} required placeholder={t('roster.form.selectStartDate')} />
          </Field>
          <Field label={t('roster.form.contractEnd')}>
            <DatePicker value={endDate} onChange={setEndDate} required placeholder={t('roster.form.selectEndDate')} />
          </Field>
        </div>
        {error && (
          <div className="border border-red-200 bg-red-50 rounded-lg px-4 py-3 text-[13px] text-red-700">{error}</div>
        )}
        <div className="flex items-center justify-end gap-3 pt-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>{t('common.cancel')}</Button>
          <Button type="submit" disabled={saving}>
            {saving ? <Spinner size={14} /> : null}
            {saving ? t('common.saving') : t('roster.manager.addCoach')}
          </Button>
        </div>
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
  const [weeklyWagePounds, setWeeklyWagePounds] = useState(c ? Math.round(c.annualWagePence / 52 / 100) : NaN)
  const [agentPounds, setAgentPounds] = useState(c ? c.agentFeePence / 100 : NaN)
  const [startDate, setStartDate] = useState(c?.startDate ?? '')
  const [endDate, setEndDate] = useState(c?.endDate ?? '')
  const [saving, setSaving] = useState(false)
  const [removing, setRemoving] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [extendOpen, setExtendOpen] = useState(false)
  const [phases, setPhases] = useState<ContractPhase[]>(manager.phases)
  const [error, setError] = useState('')

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
      const compPence = (isFinite(compPounds) ? compPounds : 0) * 100
      const annualWagePence = (isFinite(weeklyWagePounds) ? weeklyWagePounds : 0) * 52 * 100
      const agentPence = (isFinite(agentPounds) ? agentPounds : 0) * 100

      if (c) {
        const patch: Parameters<typeof api.roster.updateManagerContract>[1] = {}
        if (compPence !== c.feePence) patch.feePence = compPence
        if (annualWagePence !== c.annualWagePence) patch.annualWagePence = annualWagePence
        if (agentPence !== c.agentFeePence) patch.agentFeePence = agentPence
        if (startDate !== c.startDate) patch.startDate = startDate
        if (endDate !== c.endDate) patch.endDate = endDate
        if (Object.keys(patch).length > 0) {
          await api.roster.updateManagerContract(c.id, patch)
        }
      } else if (startDate || endDate || isFinite(weeklyWagePounds) || isFinite(compPounds) || isFinite(agentPounds)) {
        // No contract yet (a template-imported coach with no Transfermarkt data).
        // The CFO has started filling it in — create the INITIAL phase so the
        // manager begins counting toward SCR. All three are required to seed it.
        if (!startDate || !endDate) {
          throw new Error(t('roster.manager.needDates'))
        }
        if (!isFinite(weeklyWagePounds) || weeklyWagePounds <= 0) {
          throw new Error(t('roster.manager.needWage'))
        }
        const input: ManagerContractInput = {
          compensationFeePence: compPence,
          annualWagePence,
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

  return (
    <>
    <ModalShell onClose={onClose} title={t('roster.manager.editTitle', { name: manager.name })}>
      <form onSubmit={save} className="px-5 pb-5 space-y-4 max-h-[80vh] overflow-y-auto overflow-x-visible">
        <Field label={t('roster.form.name')}>
          <input value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} className={fieldClass} />
        </Field>
        <Field label={t('roster.form.nationality')}>
          <CountryPicker value={nationality} onChange={setNationality} placeholder={t('roster.form.selectCountry')} />
        </Field>

        <div className="border-t border-slate-100 pt-4">
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
              {t('roster.manager.noContractBody')}
            </p>
          )}
          <div className="grid grid-cols-3 gap-4">
            <Field label={t('roster.form.compFee')}>
              <PoundInput value={compPounds} onChange={setCompPounds} />
            </Field>
            <Field label={t('roster.form.weeklyWage')}>
              <PoundInput value={weeklyWagePounds} onChange={setWeeklyWagePounds} />
            </Field>
            <Field label={t('roster.form.agentFee')}>
              <PoundInput value={agentPounds} onChange={setAgentPounds} />
            </Field>
          </div>
          <div className="grid grid-cols-2 gap-4 mt-4">
            <Field label={t('roster.form.contractStart')}>
              <DatePicker value={startDate} onChange={setStartDate} required={!!c} placeholder={t('roster.form.selectStartDate')} />
            </Field>
            <Field label={t('roster.form.contractEnd')}>
              <DatePicker value={endDate} onChange={setEndDate} required={!!c} placeholder={t('roster.form.selectEndDate')} />
            </Field>
          </div>
          {c && (
            <p className="mt-2 text-[12px] text-slate-500">
              {t('roster.manager.currentBookValue', { value: fmtMoney(c.bookValuePence) })}
              {c.feePence > 0 && (
                <> · {t('roster.manager.amortised', { value: fmtMoney(annualAmortisation(c.feePence, c.contractLengthYears)) })}</>
              )}
            </p>
          )}

          {c && phases.length > 1 && (
            <div className="mt-4">
              <div className="meta-label mb-2">{t('roster.manager.contractPhases')}</div>
              <ContractLedger phases={phases} kind="manager" canEdit={can.mutateRoster} onChanged={reloadPhases} />
            </div>
          )}

          {c && can.mutateRoster && (
            <div className="mt-4">
              <Button type="button" variant="outline" onClick={() => setExtendOpen(true)}>
                <ExtendIcon /> {t('roster.edit.logExtension')}
              </Button>
            </div>
          )}
        </div>

        {error && (
          <div className="border border-red-200 bg-red-50 rounded-lg px-4 py-3 text-[13px] text-red-700">{error}</div>
        )}

        <div className="flex items-center justify-between gap-3 pt-3 border-t border-slate-100">
          {can.mutateRoster ? (
            confirmRemove ? (
              <div className="flex items-center gap-2">
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
            <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>{t('roster.form.close')}</Button>
            {can.mutateRoster && (
              <Button type="submit" disabled={saving}>
                {saving ? <Spinner size={14} /> : null}
                {saving ? t('common.saving') : t('roster.edit.saveChanges')}
              </Button>
            )}
          </div>
        </div>
      </form>
    </ModalShell>

    {extendOpen && c && (
      <ExtendContractWizard
        subjectLabel={manager.name}
        currentEndDate={c.endDate}
        currentWeeklyWagePence={Math.round(c.annualWagePence / 52)}
        onClose={() => setExtendOpen(false)}
        submit={(input) => api.roster.extendManager(manager.id, input)}
        onExtended={onSaved}
      />
    )}
    </>
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
          <DatePicker value={startDate} onChange={setStartDate} required placeholder={t('roster.phase.startDate')} />
        </Field>
        <Field label={t('roster.phase.end')}>
          <DatePicker value={endDate} onChange={setEndDate} required placeholder={t('roster.phase.endDate')} />
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

// ---------------------------------------------------------------------------
// Extend Contract wizard — supersedes the current phase. Shared by player +
// manager (the `submit` callback targets the right endpoint).
// ---------------------------------------------------------------------------
function ExtendContractWizard({
  subjectLabel,
  currentEndDate,
  currentWeeklyWagePence,
  onClose,
  submit,
  onExtended,
}: {
  subjectLabel: string
  currentEndDate: string
  currentWeeklyWagePence: number
  onClose: () => void
  submit: (input: ExtendContractInput) => Promise<unknown>
  onExtended: () => void
}) {
  const { t } = useTranslation()
  // The extension begins exactly when the current deal expires — it's derived
  // from the current contract's end date, never picked by hand. (Previously a
  // free date field let you "extend" a deal from an arbitrary, even already-
  // past, date.) New wage seeds from the current wage so a "same terms, longer
  // deal" renewal is a one-field change.
  const effectiveDate = currentEndDate
  const [newEndDate, setNewEndDate] = useState('')
  const [weeklyWagePounds, setWeeklyWagePounds] = useState(Math.round(currentWeeklyWagePence / 100))
  const [agentPounds, setAgentPounds] = useState(NaN)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const go = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmitting(true)
    setError('')
    try {
      const input: ExtendContractInput = {
        effectiveDate,
        newEndDate,
        newWeeklyWagePence: (isFinite(weeklyWagePounds) ? weeklyWagePounds : 0) * 100,
        newAgentFeePence: (isFinite(agentPounds) ? agentPounds : 0) * 100,
      }
      await submit(input)
      onExtended()
    } catch (err) {
      setError(err instanceof Error ? err.message : t('roster.extension.failLog'))
      setSubmitting(false)
    }
  }

  return (
    <ModalShell onClose={onClose} title={t('roster.extension.title', { name: subjectLabel })}>
      <form onSubmit={go} className="px-5 pb-5 space-y-4">
        <div className="rounded-lg bg-violet-50/70 border border-violet-100 px-4 py-3 text-[12.5px] text-slate-600">
          <Trans
            i18nKey="roster.extension.intro"
            values={{ date: formatDate(effectiveDate) }}
            components={{ d: <span className="num font-medium text-slate-800" /> }}
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label={t('roster.extension.effectiveDate')}>
            {/* Auto-set to the current contract's expiry — not editable. */}
            <div className="w-full px-3 py-2 text-[14px] rounded-lg border border-slate-200 bg-slate-50 text-slate-500 num cursor-not-allowed flex items-center justify-between">
              <span>{formatDate(effectiveDate)}</span>
              <span className="text-[10.5px] uppercase tracking-wide text-slate-400 not-italic">{t('roster.extension.atExpiry')}</span>
            </div>
          </Field>
          <Field
            label={
              <span className="flex items-center gap-1.5">
                <span>{t('roster.extension.newEndDate')}</span>
                <InfoTooltip text={t('roster.extension.newEndTooltip')} />
              </span>
            }
          >
            <DatePicker value={newEndDate} onChange={setNewEndDate} required min={effectiveDate} placeholder={t('roster.form.selectEndDate')} />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label={t('roster.extension.newWeeklyWage')}>
            <PoundInput value={weeklyWagePounds} onChange={setWeeklyWagePounds} />
          </Field>
          <Field label={t('roster.extension.newAgentFees')}>
            <PoundInput value={agentPounds} onChange={setAgentPounds} />
          </Field>
        </div>

        {error && (
          <div className="border border-red-200 bg-red-50 rounded-lg px-4 py-3 text-[13px] text-red-700">{error}</div>
        )}

        <div className="flex items-center justify-end gap-3 pt-2">
          <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>{t('common.cancel')}</Button>
          <Button type="submit" disabled={submitting}>
            {submitting ? <Spinner size={14} /> : null}
            {submitting ? t('roster.extension.logging') : t('roster.extension.logExtension')}
          </Button>
        </div>
      </form>
    </ModalShell>
  )
}

// Small hover/focus tooltip for an info icon. Bubble is absolutely positioned
// above the icon with a high z-index so it escapes the field row; the wizard
// modal has enough headroom that it won't clip.
// Net Book Value explainer shown beside the "Book Value" column header. Richer
// than InfoTooltip (title + body + formula). Rendered through a portal to <body>
// and positioned off the icon's screen rect so the table's overflow clipping
// can't hide it. Hover-only, keyboard-focusable for a11y.
function BookValueInfo() {
  const { t } = useTranslation()
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
      className="relative inline-flex items-center align-middle"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      <svg
        width="13"
        height="13"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        tabIndex={0}
        className="text-slate-400 hover:text-slate-600 focus:text-slate-600 outline-none cursor-help"
        aria-label={t('roster.nbv.ariaHow')}
      >
        <circle cx="12" cy="12" r="10" />
        <path d="M12 16v-4M12 8h.01" />
      </svg>
      {coords &&
        createPortal(
          <span
            role="tooltip"
            className="pointer-events-none fixed z-[1000] -translate-y-full rounded-lg bg-slate-900 px-3 py-2.5 text-left font-normal normal-case leading-relaxed text-white shadow-lg"
            style={{ width: 300, top: coords.top - 8, right: coords.right }}
          >
            <span className="block text-[12px] font-semibold mb-1">{t('roster.nbv.title')}</span>
            <span className="block text-[11.5px] text-slate-200">
              {t('roster.nbv.body')}
            </span>
            <span className="mt-2 block rounded bg-slate-800 px-2 py-1 text-[11px] font-medium text-white">
              {t('roster.nbv.formula')}
            </span>
          </span>,
          document.body,
        )}
    </span>
  )
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
}: {
  onClose: () => void
  title: string
  children: React.ReactNode
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
        className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-[2px] overscroll-contain"
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

// Progressive-disclosure control for the Carried Book Value override. Hidden by
// default behind a subtle "Advanced" link; once revealed it shows a £ input
// with an info tooltip. When `needsAudit` is set (an imported extension block
// with no fee basis) it auto-reveals and flags an amber warning so the CFO
// knows to enter the value.
function CarriedBookValueField({
  show,
  needsAudit,
  valuePounds,
  onReveal,
  onChange,
  onHide,
}: {
  show: boolean
  needsAudit: boolean
  valuePounds: number
  onReveal: () => void
  onChange: (n: number) => void
  onHide: () => void
}) {
  const { t } = useTranslation()
  const { symbol } = useWorkspaceCurrency()
  if (!show) {
    return (
      <button
        type="button"
        onClick={onReveal}
        className={cn(
          'mt-2 inline-flex items-center gap-1 text-[11px] normal-case tracking-normal transition-colors',
          needsAudit
            ? 'font-medium text-amber-600 hover:text-amber-700'
            : 'text-slate-400 hover:text-slate-600',
        )}
      >
        {needsAudit && <AlertTriangle size={11} strokeWidth={2} className="text-amber-500" />}
        {needsAudit ? t('roster.nbv.setCarried') : t('roster.nbv.advanced')}
      </button>
    )
  }

  return (
    <div
      className={cn(
        'mt-3 rounded-lg border p-3',
        needsAudit ? 'border-amber-300 bg-amber-50/60' : 'border-slate-200 bg-slate-50/60',
      )}
    >
      <Field
        label={
          <span className="inline-flex items-center gap-1.5">
            {needsAudit && <AlertTriangle size={13} strokeWidth={2} className="text-amber-500" />}
            {t('roster.nbv.carriedLabel', { symbol })}
            <InfoTooltip text={t('roster.nbv.carriedTooltip')} />
          </span>
        }
      >
        <PoundInput value={valuePounds} onChange={onChange} />
      </Field>
      {needsAudit && (
        <p className="mt-2 text-[11.5px] leading-snug text-amber-700">
          {t('roster.nbv.carriedAudit')}
        </p>
      )}
      <button
        type="button"
        onClick={onHide}
        className="mt-2 text-[11.5px] font-medium text-slate-500 hover:text-slate-700"
      >
        {t('roster.nbv.useStandard')}
      </button>
    </div>
  )
}
