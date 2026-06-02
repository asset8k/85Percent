/**
 * ScenariosPage — MVP 2.0 multi-action plan workspace.
 *
 * Layout:
 * - Left rail (sticky): saved scenarios list with an "is included in baseline"
 *   toggle per row, click-to-load, delete.
 * - Right pane: the Scenario Builder — a draggable list of actions + a live
 *   "before / after" projection card. Save creates a new scenario; selecting
 *   a saved scenario loads its actions into the builder.
 *
 * All math is client-side via `applyScenarioActions` from @headroom/engine.
 * Server is just storage + audit.
 */

import { useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { api } from '@/lib/api'
import { useClubStore } from '@/stores/club'
import { Card } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/components/ui/badge'
import { Spinner } from '@/components/ui/spinner'
import { ScenariosSkeleton } from '@/components/ui/page-skeletons'
import { NumericInput } from '@/components/ui/numeric-input'
import { Switch } from '@/components/ui/switch'
import { AnimatedNumber } from '@/components/ui/animated-number'
import { toast } from '@/components/ui/toast'

function formatPenceNumber(pence: number, symbol = '£') {
  return symbol + Math.round(pence / 100).toLocaleString('en-GB')
}
import { ComplianceGauge } from '@/components/simulator/ComplianceGauge'
import { computeActiveBaseline, computeDryRun, computeThresholds, actionToEngineInput, scenarioMoneyImpact } from '@/lib/scr'
import { calculateSquadCosts, type ContractInput } from '@headroom/engine'
import type { ScenarioActionInput, ScenarioActionType } from '@headroom/engine'
import type { PlayerWithContract } from '@headroom/shared'
import { formatPence } from '@headroom/shared'
import { useWorkspaceCurrency } from '@/lib/useWorkspaceCurrency'
import type { ScenarioDetail, ScenarioAction, ClubFinancialsResponse } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useCan } from '@/lib/role'
import { exportComparisonPDF } from '@/lib/exports/comparisonPdf'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'

// ---------------------------------------------------------------------------
// Draft action shape used in the builder (client-only — never sent as-is)
// ---------------------------------------------------------------------------

type DraftAction = {
  id: string  // client-side uuid for dnd-kit key
  actionType: ScenarioActionType
  playerId: string | null
  // Numeric fields keyed in pounds for UI; converted to pence on save
  transferFeePounds?: number
  contractLengthYears?: number
  weeklyWagePounds?: number
  agentFeePounds?: number
  saleProceedsPounds?: number
  playerBookValuePounds?: number
  weeklyWageReliefPounds?: number
  annualAmortisationReliefPounds?: number
  loanFeeReceivedPounds?: number
  loanLengthYears?: number
  weeklyWageCoveredPounds?: number
}

function freshId(): string {
  // Minimal uuid — enough uniqueness for client-side dnd keys
  return Math.random().toString(36).slice(2) + Date.now().toString(36)
}

function newDraft(actionType: ScenarioActionType): DraftAction {
  return { id: freshId(), actionType, playerId: null }
}

const ACTION_LABEL: Record<ScenarioActionType, string> = {
  buy:      'Permanent Buy',
  sell:     'Permanent Sell',
  loan_in:  'Loan In',
  loan_out: 'Loan Out',
  release:  'Release',
}

const ACTION_COLOR: Record<ScenarioActionType, string> = {
  buy:      'text-violet-700 border-violet-200 bg-violet-50',
  loan_in:  'text-violet-700 border-violet-200 bg-violet-50',
  sell:     'text-green-700 border-green-200 bg-green-50',
  loan_out: 'text-green-700 border-green-200 bg-green-50',
  release:  'text-slate-600 border-slate-200 bg-slate-50',
}

// Convert a draft to the engine input (in pence).
function draftToEngine(d: DraftAction): ScenarioActionInput {
  const weeklyToPence = (w?: number) => (w && Number.isFinite(w)) ? Math.round(w * 52 * 100) : undefined
  const poundsToPence = (p?: number) => (p && Number.isFinite(p)) ? Math.round(p * 100) : undefined
  return {
    actionType: d.actionType,
    isIncluded: true,
    transferFeePence: poundsToPence(d.transferFeePounds),
    contractLengthYears: d.contractLengthYears,
    annualWagePence:    weeklyToPence(d.weeklyWagePounds),
    agentFeePence:      poundsToPence(d.agentFeePounds),
    saleProceedsPence:  poundsToPence(d.saleProceedsPounds),
    playerBookValuePence: poundsToPence(d.playerBookValuePounds),
    annualWageReliefPence: weeklyToPence(d.weeklyWageReliefPounds),
    annualAmortisationReliefPence: poundsToPence(d.annualAmortisationReliefPounds),
    loanFeeReceivedPence: poundsToPence(d.loanFeeReceivedPounds),
    loanLengthYears: d.loanLengthYears,
    annualWageCoveredPence: weeklyToPence(d.weeklyWageCoveredPounds),
  }
}

// And convert a saved ScenarioAction back into a draft (for editing).
function actionToDraft(a: ScenarioAction): DraftAction {
  const p = (a.payload ?? {}) as Record<string, unknown>
  const penceToPounds = (n: unknown) => typeof n === 'number' ? n / 100 : undefined
  const penceWeeklyToPounds = (n: unknown) => typeof n === 'number' ? Math.round(n / 52 / 100) : undefined
  return {
    id: a.id,
    actionType: a.actionType,
    playerId: a.playerId,
    transferFeePounds: penceToPounds(p['transferFeePence']),
    contractLengthYears: typeof p['contractLengthYears'] === 'number' ? p['contractLengthYears'] as number : undefined,
    weeklyWagePounds: penceWeeklyToPounds(p['annualWagePence']),
    agentFeePounds: penceToPounds(p['agentFeePence']),
    saleProceedsPounds: penceToPounds(p['saleProceedsPence']),
    playerBookValuePounds: penceToPounds(p['playerBookValuePence']),
    weeklyWageReliefPounds: penceWeeklyToPounds(p['annualWageReliefPence']),
    annualAmortisationReliefPounds: penceToPounds(p['annualAmortisationReliefPence']),
    loanFeeReceivedPounds: penceToPounds(p['loanFeeReceivedPence']),
    loanLengthYears: typeof p['loanLengthYears'] === 'number' ? p['loanLengthYears'] as number : undefined,
    weeklyWageCoveredPounds: penceWeeklyToPounds(p['annualWageCoveredPence']),
  }
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------
export function ScenariosPage() {
  const can = useCan()
  const { financials, scenarios, setScenarios, upsertScenario, removeScenario, setScenarioInclusion } = useClubStore()
  const [players, setPlayers] = useState<PlayerWithContract[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Builder state
  const [draftName, setDraftName] = useState('')
  const [draftActions, setDraftActions] = useState<DraftAction[]>([])
  const [editingScenarioId, setEditingScenarioId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [compareOpen, setCompareOpen] = useState(false)

  // Load roster + scenarios on mount. AppLayout also loads scenarios but its
  // useEffect may not have fired yet — be defensive.
  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const [roster, list] = await Promise.all([
          api.roster.list(),
          api.scenarios.list(1, 100),
        ])
        const details = await Promise.all(list.scenarios.map((s) => api.scenarios.get(s.id)))
        if (!cancelled) {
          setPlayers(roster.players)
          setScenarios(details)
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : 'Failed to load')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [setScenarios])

  // Derive baseline squad costs from the live roster (same math as Dashboard).
  const baselineSquadCostsPence = useMemo(() => {
    const inputs: ContractInput[] = players
      .filter((p) => p.contract)
      .map((p) => ({
        playerId: p.id,
        transferFeePence: p.contract!.transferFeePence,
        // Carried Book Value override replaces the transfer fee as the amortisation
        // principal when set — keeps the scenario baseline aligned with the
        // server-derived currentSquadCosts (and the Dashboard / TopBar pill).
        carriedBookValuePence: p.contract!.carriedBookValuePence,
        annualWagePence:  p.contract!.annualWagePence,
        agentFeePence:    p.contract!.agentFeePence,
        contractLengthYears: p.contract!.contractLengthYears,
      }))
    return calculateSquadCosts(inputs).totalSquadCostsPence
  }, [players])

  // Synthesise a "financials with derived squadCosts" for the scr helper
  const liveFinancials = useMemo(() => {
    if (!financials) return null
    return { ...financials, currentSquadCosts: baselineSquadCostsPence }
  }, [financials, baselineSquadCostsPence])

  // Dry-run the draft against the active baseline.
  const dryRun = useMemo(() => {
    if (!liveFinancials || draftActions.length === 0) return null
    // For the "before" baseline, exclude the scenario being edited (so it
    // doesn't double-count its own old actions when editing in place)
    const baselineScenarios = editingScenarioId
      ? scenarios.filter((s) => s.id !== editingScenarioId && s.isIncluded)
      : scenarios.filter((s) => s.isIncluded)
    const engineActions = draftActions.map(draftToEngine)
    return computeDryRun(liveFinancials, baselineScenarios, engineActions)
  }, [liveFinancials, scenarios, editingScenarioId, draftActions])

  const activeBaseline = useMemo(
    () => liveFinancials ? computeActiveBaseline(liveFinancials, scenarios) : null,
    [liveFinancials, scenarios]
  )

  const handleAddAction = (type: ScenarioActionType) => {
    setDraftActions((prev) => [...prev, newDraft(type)])
  }

  const handleUpdateAction = (id: string, patch: Partial<DraftAction>) => {
    setDraftActions((prev) => prev.map((a) => a.id === id ? { ...a, ...patch } : a))
  }

  const handleRemoveAction = (id: string) => {
    setDraftActions((prev) => prev.filter((a) => a.id !== id))
  }

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    setDraftActions((prev) => {
      const oldIdx = prev.findIndex((a) => a.id === active.id)
      const newIdx = prev.findIndex((a) => a.id === over.id)
      if (oldIdx === -1 || newIdx === -1) return prev
      return arrayMove(prev, oldIdx, newIdx)
    })
  }

  const handleLoadScenario = async (s: ScenarioDetail) => {
    setDraftName(s.name)
    setDraftActions(s.actions.map(actionToDraft))
    setEditingScenarioId(s.id)
  }

  const handleNewScenario = () => {
    setDraftName('')
    setDraftActions([])
    setEditingScenarioId(null)
  }

  const handleSave = async () => {
    if (!draftName.trim() || draftActions.length === 0) return
    setSaving(true)
    setError('')
    try {
      // If we're editing in-place we need to delete + recreate (no PATCH for
      // action lists in the API surface yet — keeps Phase 3 simple).
      if (editingScenarioId) {
        await api.scenarios.delete(editingScenarioId)
        removeScenario(editingScenarioId)
      }
      const result = await api.scenarios.create({
        name: draftName.trim(),
        actions: draftActions.map((d) => {
          const engine = draftToEngine(d)
          // Strip isIncluded before sending — it's an in-engine flag, not stored
          const { isIncluded, ...payload } = engine
          void isIncluded
          return {
            actionType: d.actionType,
            playerId: d.playerId,
            payload: payload as Record<string, unknown>,
          }
        }),
      })
      // Reload the full detail so we have ids + actionCount
      const detail = await api.scenarios.get(result.id)
      upsertScenario(detail)
      // Reset builder
      setDraftName('')
      setDraftActions([])
      setEditingScenarioId(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save scenario')
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteScenario = async (id: string) => {
    try {
      await api.scenarios.delete(id)
      removeScenario(id)
      if (editingScenarioId === id) handleNewScenario()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete')
    }
  }

  const handleToggleInclude = async (id: string, next: boolean) => {
    setScenarioInclusion(id, next) // optimistic
    try {
      await api.scenarios.update(id, { isIncluded: next })
    } catch {
      setScenarioInclusion(id, !next) // rollback
    }
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )

  if (loading) return <ScenariosSkeleton />

  if (!liveFinancials) {
    return (
      <div>
        <PageHeader onNew={handleNewScenario} onCompare={() => setCompareOpen(true)} canCompare={scenarios.length >= 2} />
        <Card className="p-12 text-center">
          <p className="text-[15px] font-medium text-slate-900">Club setup required</p>
          <p className="text-[13px] text-slate-500 mt-2">Configure your club financials before building scenarios.</p>
        </Card>
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        onNew={handleNewScenario}
        onCompare={() => setCompareOpen(true)}
        canCompare={scenarios.length >= 2}
      />

      <div className="grid grid-cols-[320px_1fr] gap-5">
        {/* Saved scenarios rail */}
        <aside className="flex flex-col gap-3">
          <Card className="p-5">
            <div className="flex items-center justify-between mb-3">
              <div className="meta-label">Saved Scenarios</div>
              <span className="text-[11px] text-slate-400 num">{scenarios.length}</span>
            </div>
            {scenarios.length === 0 ? (
              <p className="text-[12px] text-slate-500">
                Build a plan on the right and save it to compare later.
              </p>
            ) : (
              <>
                <ul className="flex flex-col gap-2">
                  {scenarios.map((s) => (
                    <ScenarioListItem
                      key={s.id}
                      scenario={s}
                      financials={liveFinancials}
                      isEditing={editingScenarioId === s.id}
                      canToggle={can.toggleActiveBaseline}
                      onLoad={() => handleLoadScenario(s)}
                      onDelete={() => handleDeleteScenario(s.id)}
                      onToggle={(v) => handleToggleInclude(s.id, v)}
                    />
                  ))}
                </ul>
                <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-[11px] text-slate-500">
                  <span>
                    <span className="num text-slate-700 font-medium">
                      {scenarios.filter((s) => s.isIncluded).length}
                    </span>{' '}
                    of <span className="num">{scenarios.length}</span> in active plan
                  </span>
                  {activeBaseline && (
                    <span className="num text-slate-400">
                      {(activeBaseline.ratio * 100).toFixed(1)}% SCR
                    </span>
                  )}
                </div>
              </>
            )}
          </Card>
        </aside>

        {/* Builder */}
        <div className="flex flex-col gap-5">
          {error && (
            <Card className="p-4 border-red-200 bg-red-50">
              <p className="text-[13px] text-red-700">{error}</p>
            </Card>
          )}

          {/* Name + save bar */}
          <Card className="p-5">
            <div className="flex items-center gap-3">
              <input
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                placeholder={editingScenarioId ? 'Scenario name' : 'New scenario — e.g. "January window plan A"'}
                maxLength={100}
                className="flex-1 px-3 py-2 text-[14px] rounded-lg border border-slate-200 bg-white focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500"
              />
              <Button
                onClick={handleSave}
                disabled={!draftName.trim() || draftActions.length === 0 || saving}
              >
                {saving ? <Spinner size={14} /> : null}
                {saving ? 'Saving…' : editingScenarioId ? 'Save changes' : 'Save scenario'}
              </Button>
              {editingScenarioId && (
                <Button variant="ghost" onClick={handleNewScenario}>New</Button>
              )}
            </div>
          </Card>

          {/* Live projection */}
          {dryRun && (
            <Card className="p-6">
              <ProjectionPanel
                dryRun={dryRun}
                financials={liveFinancials}
                // Plan-status context — drives the header pill + inline switch.
                // When editing a saved scenario we know its current inclusion;
                // for a fresh draft we surface a 'Draft — save to include' chip.
                editingScenario={
                  editingScenarioId
                    ? scenarios.find((s) => s.id === editingScenarioId) ?? null
                    : null
                }
                canToggle={can.toggleActiveBaseline}
                onToggleInclude={handleToggleInclude}
                otherIncludedCount={
                  scenarios.filter(
                    (s) => s.isIncluded && s.id !== editingScenarioId,
                  ).length
                }
              />
            </Card>
          )}

          {/* Action list */}
          <Card className="p-5">
            <div className="flex items-center justify-between mb-4 flex-wrap gap-3">
              <div className="flex items-center gap-3">
                <span className="inline-block w-1 h-5 rounded-full bg-violet-600" />
                <div>
                  <h3 className="text-[15px] font-semibold text-slate-900 leading-tight">Plan Actions</h3>
                  <p className="text-[12px] text-slate-500 mt-0.5">
                    Stack incoming + outgoing transfers. Drag rows to reorder; the projection recomputes live.
                  </p>
                </div>
              </div>
              <ActionAdder onAdd={handleAddAction} />
            </div>

            {draftActions.length === 0 ? (
              <div className="border-2 border-dashed border-slate-200 rounded-xl p-10 text-center">
                <p className="text-[14px] text-slate-700 font-medium">No actions yet</p>
                <p className="text-[12px] text-slate-500 mt-1.5">
                  Add a buy, sell, loan, or release using the buttons above.
                </p>
              </div>
            ) : (
              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                <SortableContext items={draftActions.map((a) => a.id)} strategy={verticalListSortingStrategy}>
                  <ul className="flex flex-col gap-3">
                    {draftActions.map((action, idx) => (
                      <SortableActionRow
                        key={action.id}
                        action={action}
                        index={idx}
                        roster={players}
                        onUpdate={(patch) => handleUpdateAction(action.id, patch)}
                        onRemove={() => handleRemoveAction(action.id)}
                      />
                    ))}
                  </ul>
                </SortableContext>
              </DndContext>
            )}
          </Card>
        </div>
      </div>

      <AnimatePresence>
        {compareOpen && (
          <CompareModal
            scenarios={scenarios}
            financials={liveFinancials}
            clubName={useClubStore.getState().clubName ?? 'Headroom FC'}
            onClose={() => setCompareOpen(false)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

// ---------------------------------------------------------------------------
// PageHeader
// ---------------------------------------------------------------------------
function PageHeader({
  onNew, onCompare, canCompare,
}: { onNew: () => void; onCompare: () => void; canCompare: boolean }) {
  return (
    <div className="mb-6 flex items-center gap-3">
      <span className="inline-block w-1.5 h-7 rounded-full bg-violet-600" />
      <div className="flex-1">
        <h1 className="text-[24px] font-bold text-slate-900 tracking-tight leading-none">
          Scenarios
        </h1>
        <p className="text-[13px] text-slate-500 mt-1.5">
          Multi-action transfer plans. Stack buys, sells, loans, releases and see the net SCR impact.
        </p>
      </div>
      <Button variant="outline" onClick={onCompare} disabled={!canCompare}>
        Compare A vs B
      </Button>
      <Button onClick={onNew}>New scenario</Button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Saved scenario list row
//
// Layout: violet left-edge accent (when in plan) + name/meta clickable area +
// switch + delete icon. The accent makes the in-plan state visible at a glance
// without reading the switch state. Switch carries the tooltip explaining the
// action — "include in active baseline" was confusing as a tick.
// ---------------------------------------------------------------------------
function ScenarioListItem({
  scenario, financials, isEditing, canToggle, onLoad, onDelete, onToggle,
}: {
  scenario: ScenarioDetail
  financials: ClubFinancialsResponse | null
  isEditing: boolean
  canToggle: boolean
  onLoad: () => void
  onDelete: () => void
  onToggle: (v: boolean) => void
}) {
  const { format: fmtMoney, symbol } = useWorkspaceCurrency()
  const [deleting, setDeleting] = useState(false)
  const inPlan = scenario.isIncluded
  const actionCount = scenario.actionCount ?? scenario.actions.length
  // Per-scenario SCR worth: its net effect on headroom to the Green threshold.
  // + (green) frees room; − (red) consumes it. Needs the loaded action detail.
  const impact = financials && scenario.actions.length > 0
    ? scenarioMoneyImpact(financials, scenario)
    : null

  return (
    <li
      className={cn(
        'relative rounded-lg border transition-colors overflow-hidden',
        // Bold violet accent for in-plan rows. Editing state stacks on top
        // (slightly stronger background so the editing row is identifiable
        // even when both rows are in-plan).
        inPlan
          ? isEditing
            ? 'border-violet-300 bg-violet-50/70'
            : 'border-violet-200 bg-violet-50/40 hover:border-violet-300'
          : isEditing
          ? 'border-violet-300 bg-violet-50/60'
          : 'border-slate-200 hover:border-slate-300',
      )}
    >
      {/* Left-edge accent bar */}
      <span
        className={cn(
          'absolute left-0 top-0 bottom-0 w-1 transition-colors',
          inPlan ? 'bg-violet-600' : 'bg-transparent',
        )}
        aria-hidden="true"
      />
      <div className="group flex items-center gap-2 pl-3.5 pr-2 py-2.5">
        <button onClick={onLoad} className="flex-1 text-left min-w-0">
          <div className="text-[13px] font-medium text-slate-900 truncate">{scenario.name}</div>
          <div className="flex items-center gap-1.5 mt-1 min-w-0">
            <span className="text-[11px] text-slate-500 whitespace-nowrap">
              {actionCount} {actionCount === 1 ? 'action' : 'actions'}
            </span>
            {impact && (
              <>
                <span className="text-slate-300" aria-hidden>·</span>
                <span
                  title={
                    `Net SCR headroom: ${signedPence(impact.headroomDeltaPence, fmtMoney)}\n` +
                    `Squad costs: ${signedPence(-impact.costDeltaPence, fmtMoney)} room` +
                    (impact.revenueDeltaPence !== 0 ? `\nRevenue: ${signedPence(impact.revenueDeltaPence, fmtMoney)}` : '')
                  }
                  className={cn(
                    'text-[11px] font-semibold num whitespace-nowrap',
                    impact.headroomDeltaPence >= 0 ? 'text-green-700' : 'text-red-700',
                  )}
                >
                  {compactSignedPence(impact.headroomDeltaPence, symbol)}
                </span>
              </>
            )}
          </div>
        </button>
        {canToggle ? (
          <Switch
            checked={inPlan}
            onChange={onToggle}
            size="sm"
            tooltip={
              inPlan
                ? 'Remove from active plan'
                : 'Add to active plan — applies this scenario to your dashboard SCR'
            }
            aria-label={inPlan ? 'Remove from active plan' : 'Include in active plan'}
          />
        ) : (
          // Read-only switch for Finance Analyst — visual matches but cannot
          // be flipped (we render a disabled Switch so the affordance still
          // reads as a toggle to the user, not as something they should click).
          <Switch
            checked={inPlan}
            onChange={() => undefined}
            disabled
            size="sm"
            aria-label="Active plan (read-only)"
          />
        )}
        <button
          onClick={async (e) => {
            e.stopPropagation()
            setDeleting(true)
            try { await onDelete() } finally { setDeleting(false) }
          }}
          disabled={deleting}
          className="text-slate-300 hover:text-red-600 p-1.5 rounded-md hover:bg-red-50 transition-all opacity-60 group-hover:opacity-100 focus-visible:opacity-100"
          aria-label="Delete scenario"
        >
          {deleting ? <Spinner size={11} /> : (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 6h18" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
            </svg>
          )}
        </button>
      </div>
    </li>
  )
}

// ---------------------------------------------------------------------------
// Action adder dropdown
// ---------------------------------------------------------------------------
function ActionAdder({ onAdd }: { onAdd: (t: ScenarioActionType) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="relative">
      <Button variant="outline" onClick={() => setOpen((v) => !v)}>
        <span>Add action</span>
        <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M3 4l3 4 3-4" />
        </svg>
      </Button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-1 z-20 bg-white border border-slate-200 rounded-lg shadow-md p-1 min-w-[180px]">
            {(['buy', 'sell', 'loan_in', 'loan_out', 'release'] as ScenarioActionType[]).map((t) => (
              <button
                key={t}
                onClick={() => { onAdd(t); setOpen(false) }}
                className="w-full text-left px-3 py-2 text-[13px] text-slate-700 hover:bg-violet-50 hover:text-violet-700 rounded"
              >
                {ACTION_LABEL[t]}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Sortable action row — the meat of the builder
// ---------------------------------------------------------------------------
function SortableActionRow({
  action, index, roster, onUpdate, onRemove,
}: {
  action: DraftAction
  index: number
  roster: PlayerWithContract[]
  onUpdate: (patch: Partial<DraftAction>) => void
  onRemove: () => void
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: action.id })
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={cn(
        'border rounded-lg bg-white',
        ACTION_COLOR[action.actionType].split(' ').find((c) => c.startsWith('border-')) ?? 'border-slate-200'
      )}
    >
      <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100">
        <button
          {...attributes}
          {...listeners}
          className="text-slate-400 hover:text-slate-700 cursor-grab active:cursor-grabbing"
          aria-label="Drag to reorder"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
            <circle cx="8" cy="6" r="1.5" /><circle cx="16" cy="6" r="1.5" />
            <circle cx="8" cy="12" r="1.5" /><circle cx="16" cy="12" r="1.5" />
            <circle cx="8" cy="18" r="1.5" /><circle cx="16" cy="18" r="1.5" />
          </svg>
        </button>
        <span className={cn(
          'inline-block text-[11px] font-medium px-2 py-0.5 rounded-md whitespace-nowrap',
          ACTION_COLOR[action.actionType]
        )}>
          {index + 1}. {ACTION_LABEL[action.actionType]}
        </span>
        <div className="flex-1" />
        <button
          onClick={onRemove}
          className="text-slate-400 hover:text-red-600 p-1 -m-1"
          aria-label="Remove action"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 6L6 18" /><path d="M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div className="p-4">
        <ActionFields action={action} roster={roster} onUpdate={onUpdate} />
      </div>
    </li>
  )
}

// ---------------------------------------------------------------------------
// Per-type form fields
// ---------------------------------------------------------------------------
function ActionFields({
  action, roster, onUpdate,
}: {
  action: DraftAction
  roster: PlayerWithContract[]
  onUpdate: (patch: Partial<DraftAction>) => void
}) {
  const usesRoster = action.actionType === 'sell' || action.actionType === 'release' || action.actionType === 'loan_out'

  // When a player is picked for a sell/release/loan_out, auto-fill the relief
  // fields from their contract.
  const onPickPlayer = (id: string | null) => {
    if (!id) {
      onUpdate({ playerId: null })
      return
    }
    const player = roster.find((p) => p.id === id)
    if (!player || !player.contract) {
      onUpdate({ playerId: id })
      return
    }
    const c = player.contract
    const weeklyWageRelief = Math.round(c.annualWagePence / 52 / 100)
    const yearsRemain = Math.max(0.25, c.contractLengthYears)
    const annualAmortRelief = Math.round(c.transferFeePence / yearsRemain / 100)
    onUpdate({
      playerId: id,
      weeklyWageReliefPounds: weeklyWageRelief,
      weeklyWageCoveredPounds: weeklyWageRelief, // sensible default for loan_out too
      annualAmortisationReliefPounds: annualAmortRelief,
      playerBookValuePounds: Math.round(c.bookValuePence / 100),
    })
  }

  if (action.actionType === 'buy') {
    return (
      <div className="grid grid-cols-2 gap-4">
        <Field label="Transfer Fee (£)">
          <PoundInput value={action.transferFeePounds ?? NaN} onChange={(n) => onUpdate({ transferFeePounds: n })} />
        </Field>
        <Field label="Contract length (years)">
          <NumericInput
            value={action.contractLengthYears ?? NaN}
            onChange={(n) => onUpdate({ contractLengthYears: n })}
            className={inputBase}
            placeholder="4"
          />
        </Field>
        <Field label="Weekly wage (£)">
          <PoundInput value={action.weeklyWagePounds ?? NaN} onChange={(n) => onUpdate({ weeklyWagePounds: n })} />
        </Field>
        <Field label="Agent fee (£)">
          <PoundInput value={action.agentFeePounds ?? NaN} onChange={(n) => onUpdate({ agentFeePounds: n })} />
        </Field>
      </div>
    )
  }

  if (action.actionType === 'sell') {
    return (
      <div className="space-y-4">
        {usesRoster && <PlayerPicker roster={roster} value={action.playerId} onChange={onPickPlayer} />}
        <div className="grid grid-cols-2 gap-4">
          <Field label="Sale proceeds (£)">
            <PoundInput value={action.saleProceedsPounds ?? NaN} onChange={(n) => onUpdate({ saleProceedsPounds: n })} />
          </Field>
          <Field label="Book value (£)" helper="Auto-filled from contract">
            <PoundInput value={action.playerBookValuePounds ?? NaN} onChange={(n) => onUpdate({ playerBookValuePounds: n })} />
          </Field>
          <Field label="Weekly wage relief (£)" helper="Wage saved on sale">
            <PoundInput value={action.weeklyWageReliefPounds ?? NaN} onChange={(n) => onUpdate({ weeklyWageReliefPounds: n })} />
          </Field>
          <Field label="Annual amortisation relief (£)" helper="Remaining amortisation removed">
            <PoundInput value={action.annualAmortisationReliefPounds ?? NaN} onChange={(n) => onUpdate({ annualAmortisationReliefPounds: n })} />
          </Field>
        </div>
      </div>
    )
  }

  if (action.actionType === 'loan_in') {
    return (
      <div className="grid grid-cols-2 gap-4">
        <Field label="Loan fee paid (£)">
          <PoundInput value={action.transferFeePounds ?? NaN} onChange={(n) => onUpdate({ transferFeePounds: n })} />
        </Field>
        <Field label="Loan length (years)">
          <NumericInput
            value={action.loanLengthYears ?? NaN}
            onChange={(n) => onUpdate({ loanLengthYears: n })}
            className={inputBase}
            placeholder="1"
          />
        </Field>
        <Field label="Weekly wage contribution (£)">
          <PoundInput value={action.weeklyWagePounds ?? NaN} onChange={(n) => onUpdate({ weeklyWagePounds: n })} />
        </Field>
      </div>
    )
  }

  if (action.actionType === 'loan_out') {
    return (
      <div className="space-y-4">
        {usesRoster && <PlayerPicker roster={roster} value={action.playerId} onChange={onPickPlayer} />}
        <div className="grid grid-cols-2 gap-4">
          <Field label="Loan fee received (£)">
            <PoundInput value={action.loanFeeReceivedPounds ?? NaN} onChange={(n) => onUpdate({ loanFeeReceivedPounds: n })} />
          </Field>
          <Field label="Loan length (years)">
            <NumericInput
              value={action.loanLengthYears ?? NaN}
              onChange={(n) => onUpdate({ loanLengthYears: n })}
              className={inputBase}
              placeholder="1"
            />
          </Field>
          <Field label="Weekly wage covered (£)" helper="Wage paid by receiving club">
            <PoundInput value={action.weeklyWageCoveredPounds ?? NaN} onChange={(n) => onUpdate({ weeklyWageCoveredPounds: n })} />
          </Field>
        </div>
      </div>
    )
  }

  // release
  return (
    <div className="space-y-4">
      {usesRoster && <PlayerPicker roster={roster} value={action.playerId} onChange={onPickPlayer} />}
      <div className="grid grid-cols-2 gap-4">
        <Field label="Weekly wage relief (£)">
          <PoundInput value={action.weeklyWageReliefPounds ?? NaN} onChange={(n) => onUpdate({ weeklyWageReliefPounds: n })} />
        </Field>
        <Field label="Annual amortisation relief (£)">
          <PoundInput value={action.annualAmortisationReliefPounds ?? NaN} onChange={(n) => onUpdate({ annualAmortisationReliefPounds: n })} />
        </Field>
      </div>
    </div>
  )
}

function PlayerPicker({
  roster, value, onChange,
}: { roster: PlayerWithContract[]; value: string | null; onChange: (id: string | null) => void }) {
  const { format: fmtMoney } = useWorkspaceCurrency()
  return (
    <Field label="Player from roster">
      <select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || null)}
        className={inputBase}
      >
        <option value="">— select a player —</option>
        {roster.filter((p) => p.contract).map((p) => (
          <option key={p.id} value={p.id}>
            {p.name} ({p.position ?? '—'}) — {fmtMoney(p.contract!.annualWagePence)} / yr
          </option>
        ))}
      </select>
    </Field>
  )
}

// ---------------------------------------------------------------------------
// Projection panel (live before/after)
// ---------------------------------------------------------------------------
function ProjectionPanel({
  dryRun,
  financials,
  editingScenario,
  canToggle,
  onToggleInclude,
  otherIncludedCount,
}: {
  dryRun: ReturnType<typeof computeDryRun>
  financials: ClubFinancialsResponse
  /** The currently-loaded saved scenario, if any. Null for fresh drafts. */
  editingScenario: ScenarioDetail | null
  canToggle: boolean
  onToggleInclude: (id: string, next: boolean) => void
  /** Number of OTHER included scenarios feeding the baseline tile. */
  otherIncludedCount: number
}) {
  const { symbol } = useWorkspaceCurrency()
  const fmtMoneyNum = (pence: number) => formatPenceNumber(pence, symbol)
  const { before, after } = dryRun
  const thresholds = computeThresholds(after.adjustedRevenue, financials.currentAllowanceRatio)
  const currentPct = before.ratio * 100
  const projectedPct = after.ratio * 100
  const greenPct = 85
  const redPct = after.adjustedRevenue > 0 ? (thresholds.redPence / after.adjustedRevenue) * 100 : 85

  const status = after.status
  // Three-state plan status: included | excluded | draft (not saved yet).
  const planState: 'included' | 'excluded' | 'draft' =
    !editingScenario ? 'draft' : editingScenario.isIncluded ? 'included' : 'excluded'

  const colorMap = {
    green: 'text-green-700 bg-green-50 border-green-200',
    amber: 'text-amber-700 bg-amber-50 border-amber-200',
    red:   'text-red-700 bg-red-50 border-red-200',
  }

  // Baseline subtitle — what's actually contributing to the "before" number.
  const baselineSubtitle =
    otherIncludedCount === 0
      ? 'Roster only'
      : `Roster + ${otherIncludedCount} other ${otherIncludedCount === 1 ? 'scenario' : 'scenarios'}`

  return (
    <div>
      <div className="flex items-start justify-between gap-3 mb-4 flex-wrap">
        <div className="flex items-center gap-3">
          <span className="inline-block w-1 h-5 rounded-full bg-violet-600" />
          <div>
            <h3 className="text-[15px] font-semibold text-slate-900 leading-tight">Live Projection</h3>
            <p className="text-[12px] text-slate-500 mt-0.5">
              What this plan does to your active baseline.
            </p>
          </div>
        </div>
        <PlanStatusChip
          state={planState}
          canToggle={canToggle}
          onToggle={(next) => {
            if (editingScenario) onToggleInclude(editingScenario.id, next)
          }}
        />
      </div>

      <div className="grid grid-cols-2 gap-4 mb-5">
        {/* Active Baseline tile — neutral white card, always */}
        <div className="rounded-xl border border-slate-200 bg-white p-5">
          <div className="meta-label">Active Baseline</div>
          <div className="mt-2">
            <AnimatedNumber
              value={currentPct}
              decimals={1}
              suffix="%"
              className="num text-[28px] font-semibold text-slate-900 leading-none"
            />
          </div>
          <div className="text-[11px] text-slate-400 mt-2 num">
            Costs: <AnimatedNumber value={before.baselineSquadCosts} format={fmtMoneyNum} />
          </div>
          <div className="text-[11px] text-slate-500 mt-1.5">{baselineSubtitle}</div>
        </div>

        {/* With this plan tile — violet ring when this scenario is currently
            in the active plan (i.e. this number is what's driving the top-bar
            SCR), neutral when it's hypothetical. Status border color (green/
            amber/red) still indicates SCR compliance on the left edge. */}
        <div
          className={cn(
            'rounded-xl border p-5 border-l-4 relative',
            colorMap[status],
            planState === 'included' && 'ring-2 ring-violet-400 ring-offset-2 ring-offset-white',
          )}
        >
          <div className="meta-label">With this plan</div>
          <div className="mt-2">
            <AnimatedNumber
              value={projectedPct}
              decimals={1}
              suffix="%"
              className="num text-[28px] font-semibold leading-none"
            />
          </div>
          <div className="text-[11px] text-slate-500 mt-2 num">
            Costs: <AnimatedNumber value={after.baselineSquadCosts} format={fmtMoneyNum} />
          </div>
          <div className="mt-3 flex items-center gap-2 flex-wrap">
            <StatusBadge status={status}>
              {status === 'green' ? 'Compliant' : status === 'amber' ? 'Levy Zone' : 'Points Risk'}
            </StatusBadge>
            {planState === 'included' && (
              <span className="inline-flex items-center gap-1 text-[10.5px] font-medium text-violet-700">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 6 9 17l-5-5" />
                </svg>
                Currently driving SCR
              </span>
            )}
            {planState === 'excluded' && (
              <span className="text-[10.5px] text-slate-500">
                Hypothetical — flip the switch to apply
              </span>
            )}
            {planState === 'draft' && (
              <span className="text-[10.5px] text-slate-500">
                Save the scenario to add it to your active plan
              </span>
            )}
          </div>
        </div>
      </div>

      <ComplianceGauge
        currentPct={currentPct}
        projectedPct={projectedPct}
        greenPct={greenPct}
        redPct={redPct}
      />
    </div>
  )
}

// Status chip + inline switch above the projection tiles. Communicates which
// of three states the loaded scenario sits in, and lets the user flip the
// include state from here without scrolling back to the saved-scenarios rail.
function PlanStatusChip({
  state,
  canToggle,
  onToggle,
}: {
  state: 'included' | 'excluded' | 'draft'
  canToggle: boolean
  onToggle: (next: boolean) => void
}) {
  if (state === 'included') {
    return (
      <div className="inline-flex items-center gap-2.5 rounded-full bg-violet-50 border border-violet-200 pl-3 pr-2 py-1">
        <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-violet-700">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-violet-600" />
          In active plan
        </span>
        <Switch
          checked={true}
          onChange={onToggle}
          disabled={!canToggle}
          size="sm"
          tooltip={canToggle ? 'Remove from active plan' : undefined}
          aria-label="Remove from active plan"
        />
      </div>
    )
  }
  if (state === 'excluded') {
    return (
      <div className="inline-flex items-center gap-2.5 rounded-full bg-slate-50 border border-slate-200 pl-3 pr-2 py-1">
        <span className="inline-flex items-center gap-1.5 text-[12px] font-medium text-slate-600">
          <span className="inline-block w-1.5 h-1.5 rounded-full bg-slate-400" />
          Not in plan
        </span>
        <Switch
          checked={false}
          onChange={onToggle}
          disabled={!canToggle}
          size="sm"
          tooltip={canToggle ? 'Include in active plan — applies this plan to your dashboard SCR' : undefined}
          aria-label="Include in active plan"
        />
      </div>
    )
  }
  // Draft state — no switch (nothing to toggle until saved)
  return (
    <div className="inline-flex items-center gap-2 rounded-full bg-slate-50 border border-slate-200 px-3 py-1.5">
      <span className="inline-block w-1.5 h-1.5 rounded-full bg-slate-400" />
      <span className="text-[12px] font-medium text-slate-600">Draft — save to include</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Compare modal
// ---------------------------------------------------------------------------
function CompareModal({
  scenarios, financials, clubName, onClose,
}: {
  scenarios: ScenarioDetail[]
  financials: ClubFinancialsResponse
  clubName: string
  onClose: () => void
}) {
  const { format: fmtMoney, currency } = useWorkspaceCurrency()
  const [aId, setAId] = useState<string>(scenarios[0]?.id ?? '')
  const [bId, setBId] = useState<string>(scenarios[1]?.id ?? '')

  const a = scenarios.find((s) => s.id === aId)
  const b = scenarios.find((s) => s.id === bId)

  // Project each scenario on its own against the baseline-without-any-included-scenarios.
  // This isolates each plan's impact for an apples-to-apples comparison.
  const baselineNoScenarios = useMemo(
    () => computeActiveBaseline({ ...financials, ownerEquityUsed1yr: financials.ownerEquityUsed1yr ?? 0 }, []),
    [financials]
  )

  const project = (sc?: ScenarioDetail) => {
    if (!sc) return null
    return computeDryRun(financials, [], sc.actions.map(actionToEngineInput) as never).after
    // Actually computeDryRun needs draftActions in the engine shape — but we
    // already have engine-typed ScenarioActionInputs from actionToEngineInput.
  }

  const projA = a ? project(a) : null
  const projB = b ? project(b) : null
  const baseRatio = baselineNoScenarios.ratio * 100

  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.18 }}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-[2px]"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0, transition: { duration: 0.12 } }}
        transition={{ duration: 0.16, ease: 'easeOut' }}
        className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl border border-slate-200 overflow-hidden"
      >
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <h2 className="text-[16px] font-semibold text-slate-900">Compare scenarios</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 p-1 -m-1" aria-label="Close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 6L6 18" /><path d="M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="p-5 grid grid-cols-2 gap-5">
          <CompareColumn label="Scenario A" scenarios={scenarios} selectedId={aId} onChange={setAId} projection={projA} baseRatio={baseRatio} financials={financials} />
          <CompareColumn label="Scenario B" scenarios={scenarios} selectedId={bId} onChange={setBId} projection={projB} baseRatio={baseRatio} financials={financials} />
        </div>
        {projA && projB && (
          <div className="px-5 pb-5">
            <Card className="p-5 bg-slate-50 border-slate-200">
              <div className="flex items-center justify-between mb-2">
                <div className="meta-label">Delta — B vs A</div>
                {a && b && (
                  <button
                    onClick={() => exportComparisonPDF({
                      clubName,
                      financials,
                      scenarioA: a,
                      scenarioB: b,
                      currency,
                    })}
                    className="text-[12px] font-medium text-violet-600 hover:text-violet-700"
                  >
                    Export comparison PDF
                  </button>
                )}
              </div>
              <div className="grid grid-cols-3 gap-4">
                <Stat label="ΔSCR" value={`${((projB.ratio - projA.ratio) * 100).toFixed(2)} pp`} />
                <Stat label="ΔCosts" value={signedPence(projB.baselineSquadCosts - projA.baselineSquadCosts, fmtMoney)} />
                <Stat label="ΔRevenue" value={signedPence(projB.adjustedRevenue - projA.adjustedRevenue, fmtMoney)} />
              </div>
            </Card>
          </div>
        )}
      </motion.div>
    </motion.div>
  )
}

function CompareColumn({
  label, scenarios, selectedId, onChange, projection, baseRatio, financials,
}: {
  label: string
  scenarios: ScenarioDetail[]
  selectedId: string
  onChange: (id: string) => void
  projection: ReturnType<typeof computeActiveBaseline> | null
  baseRatio: number
  financials: ClubFinancialsResponse
}) {
  void financials
  const { format: fmtMoney } = useWorkspaceCurrency()
  return (
    <div className="space-y-4">
      <div>
        <div className="meta-label mb-1.5">{label}</div>
        <select value={selectedId} onChange={(e) => onChange(e.target.value)} className={inputBase}>
          <option value="">— select —</option>
          {scenarios.map((s) => (
            <option key={s.id} value={s.id}>{s.name}</option>
          ))}
        </select>
      </div>
      {projection && (
        <Card className="p-4">
          <div className="meta-label">Projected SCR</div>
          <div className="num text-[28px] font-semibold leading-none mt-2 text-slate-900">{(projection.ratio * 100).toFixed(1)}%</div>
          <div className="text-[11px] text-slate-500 mt-2 num">
            Δ vs baseline: <span className={projection.ratio * 100 - baseRatio >= 0 ? 'text-red-700' : 'text-green-700'}>
              {(projection.ratio * 100 - baseRatio).toFixed(2)} pp
            </span>
          </div>
          <div className="text-[11px] text-slate-400 mt-3 num">
            Costs: {fmtMoney(projection.baselineSquadCosts)}<br />
            Revenue: {fmtMoney(projection.adjustedRevenue)}
          </div>
        </Card>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="meta-label">{label}</div>
      <div className="num text-[18px] font-semibold text-slate-900 mt-1.5">{value}</div>
    </div>
  )
}

// `fmt` is the workspace-currency formatter (from useWorkspaceCurrency); falls
// back to GBP. Zero renders via fmt too so the symbol matches ("€0").
function signedPence(p: number, fmt: (n: number) => string = formatPence): string {
  if (p === 0) return fmt(0)
  if (p > 0) return '+' + fmt(p)
  return '−' + fmt(Math.abs(p))
}

// Compact signed money for tight chips: "+£8.2M", "−€450K", "$0". Symbol from
// the active workspace currency (defaults to £).
function compactSignedPence(pence: number, symbol = '£'): string {
  const pounds = Math.round(pence / 100)
  if (pounds === 0) return `${symbol}0`
  const sign = pounds > 0 ? '+' : '−'
  const abs = Math.abs(pounds)
  if (abs >= 1_000_000) return `${sign}${symbol}${(abs / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000) return `${sign}${symbol}${(abs / 1_000).toFixed(0)}K`
  return `${sign}${symbol}${abs}`
}

// ---------------------------------------------------------------------------
// Field + input primitives (local to this page)
// ---------------------------------------------------------------------------
const inputBase =
  'w-full px-3 py-2 text-[14px] rounded-lg border border-slate-200 bg-white focus:outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500 transition-colors'

function Field({ label, helper, children }: { label: string; helper?: string; children: React.ReactNode }) {
  // String labels carry a "(£)" money hint; swap it for the workspace symbol so
  // every field re-labels instantly when the currency changes.
  const { symbol } = useWorkspaceCurrency()
  const rendered = symbol !== '£' ? label.replaceAll('£', symbol) : label
  return (
    <label className="block">
      <span className="meta-label block mb-1.5">{rendered}</span>
      {children}
      {helper && <span className="block text-[11px] text-slate-400 mt-1">{helper}</span>}
    </label>
  )
}

function PoundInput({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  const { symbol } = useWorkspaceCurrency()
  return (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-[14px]">{symbol}</span>
      <NumericInput value={value} onChange={onChange} className={inputBase + ' pl-7 num'} placeholder="0" />
    </div>
  )
}
