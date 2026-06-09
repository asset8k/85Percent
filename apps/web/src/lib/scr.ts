/**
 * Client-side SCR utilities (MVP 2.0).
 *
 * Drives the Dashboard SCR card and the TopBar pill. Composes engine pure
 * functions — no I/O, no API calls. Inputs are: financials response + included
 * scenarios (each containing an ordered list of actions).
 *
 * Replaces the MVP 1.0 simulation-delta model.
 */

import type { ComplianceStatus } from '@85percent/shared'
import type { ScenarioActionInput, ScenarioActionType } from '@85percent/engine'
import { applyScenarioActions } from '@85percent/engine'
import type { ClubFinancialsResponse, ScenarioDetail, ScenarioAction } from '@/lib/api'

// ---------------------------------------------------------------------------
// Action payload normalisation
// ---------------------------------------------------------------------------
// API stores payloads as free JSON. We narrow into the engine's typed input here.

function asNumber(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v
  return undefined
}

export function actionToEngineInput(action: ScenarioAction): ScenarioActionInput {
  const p = (action.payload ?? {}) as Record<string, unknown>
  return {
    actionType: action.actionType as ScenarioActionType,
    transferFeePence:                asNumber(p['transferFeePence']),
    contractLengthYears:             asNumber(p['contractLengthYears']),
    annualWagePence:                 asNumber(p['annualWagePence']),
    agentFeePence:                   asNumber(p['agentFeePence']),
    saleProceedsPence:               asNumber(p['saleProceedsPence']),
    playerBookValuePence:            asNumber(p['playerBookValuePence']),
    annualWageReliefPence:           asNumber(p['annualWageReliefPence']),
    annualAmortisationReliefPence:   asNumber(p['annualAmortisationReliefPence']),
    loanFeeReceivedPence:            asNumber(p['loanFeeReceivedPence']),
    loanLengthYears:                 asNumber(p['loanLengthYears']),
    annualWageCoveredPence:          asNumber(p['annualWageCoveredPence']),
    isIncluded: true,
  }
}

// ---------------------------------------------------------------------------
// SCR status from a ratio + allowance
// ---------------------------------------------------------------------------
// EFL/PL: Red Threshold ratio = green ratio + allowance ratio (additive).
// For 30% allowance: red ratio = 0.85 + 0.30 = 1.15 (115% of revenue).

export function statusFromRatio(ratio: number, allowanceRatio: number): ComplianceStatus {
  const greenRatio = 0.85
  const redRatio = greenRatio + allowanceRatio
  if (ratio > redRatio) return 'red'
  if (ratio > greenRatio) return 'amber'
  return 'green'
}

// ---------------------------------------------------------------------------
// Active Baseline
// ---------------------------------------------------------------------------

export interface ActiveBaseline {
  includedCount: number
  /** Baseline squad costs in pence: derived from contracts + included scenario deltas. */
  baselineSquadCosts: number
  /** Revenue used as the SCR denominator: footballRelatedRevenue + ownerEquity1yr + included revenue deltas. */
  adjustedRevenue: number
  ratio: number
  status: ComplianceStatus
}

/**
 * Compute the Active Baseline — the SCR position the user is treating as
 * "their current reality" given which scenarios are toggled on.
 *
 * @param financials       — club financials (from the API, with derived squadCosts)
 * @param scenarios        — full list of saved scenarios with their actions loaded
 * @param excludeScenarioId — optional: skip this scenario when computing (used by
 *   the detail view's "before this scenario" gauge)
 */
export function computeActiveBaseline(
  financials: ClubFinancialsResponse,
  scenarios: ScenarioDetail[],
  excludeScenarioId?: string
): ActiveBaseline {
  const included = scenarios.filter((s) => s.isIncluded && s.id !== excludeScenarioId)

  // Flatten all actions across all included scenarios — the engine handles them
  // in one pass. Order across scenarios is meaningless (commutative).
  const actions: ScenarioActionInput[] = included.flatMap((s) =>
    s.actions.map(actionToEngineInput)
  )

  const ownerEquity = financials.ownerEquityUsed1yr ?? 0
  const baseline = {
    squadCostsPence: financials.currentSquadCosts,
    revenuePence: financials.footballRelatedRevenue + ownerEquity,
  }

  const projection = applyScenarioActions(baseline, actions)
  const ratio = projection.projectedRevenuePence === 0
    ? 0
    : projection.projectedSquadCostsPence / projection.projectedRevenuePence

  return {
    includedCount: included.length,
    baselineSquadCosts: projection.projectedSquadCostsPence,
    adjustedRevenue: projection.projectedRevenuePence,
    ratio,
    status: statusFromRatio(ratio, financials.currentAllowanceRatio),
  }
}

/**
 * Project the SCR if the user toggled this single scenario on (with all
 * already-included scenarios still on). Used on the ScenariosPage to show
 * "what does THIS scenario do" in a comparison card.
 *
 * Returns the baseline excluding this scenario AND the baseline including it,
 * so the UI can show before / after.
 */
export interface ScenarioImpact {
  before: ActiveBaseline
  after: ActiveBaseline
}

export function computeScenarioImpact(
  financials: ClubFinancialsResponse,
  allScenarios: ScenarioDetail[],
  scenario: ScenarioDetail
): ScenarioImpact {
  // BEFORE = baseline as if this scenario were excluded
  const before = computeActiveBaseline(financials, allScenarios, scenario.id)

  // AFTER = baseline + this scenario's actions (regardless of its is_included flag)
  const ownerEquity = financials.ownerEquityUsed1yr ?? 0
  const actions: ScenarioActionInput[] = scenario.actions.map(actionToEngineInput)
  const projection = applyScenarioActions(
    { squadCostsPence: before.baselineSquadCosts, revenuePence: before.adjustedRevenue },
    actions
  )

  const ratio = projection.projectedRevenuePence === 0
    ? 0
    : projection.projectedSquadCostsPence / projection.projectedRevenuePence

  // Show one more in the "after" count when this scenario isn't already on
  const after: ActiveBaseline = {
    includedCount: scenario.isIncluded ? before.includedCount : before.includedCount + 1,
    baselineSquadCosts: projection.projectedSquadCostsPence,
    adjustedRevenue: projection.projectedRevenuePence,
    ratio,
    status: statusFromRatio(ratio, financials.currentAllowanceRatio),
  }

  return { before, after }
}

/**
 * Helper: dry-run a *prospective* set of actions against the baseline (without
 * needing to save the scenario). Used by the Scenario Builder while the user
 * is editing.
 */
export function computeDryRun(
  financials: ClubFinancialsResponse,
  alreadyIncludedScenarios: ScenarioDetail[],
  draftActions: ScenarioActionInput[]
): ScenarioImpact {
  const before = computeActiveBaseline(financials, alreadyIncludedScenarios)

  const projection = applyScenarioActions(
    { squadCostsPence: before.baselineSquadCosts, revenuePence: before.adjustedRevenue },
    draftActions
  )
  const ratio = projection.projectedRevenuePence === 0
    ? 0
    : projection.projectedSquadCostsPence / projection.projectedRevenuePence

  return {
    before,
    after: {
      includedCount: before.includedCount + 1,
      baselineSquadCosts: projection.projectedSquadCostsPence,
      adjustedRevenue: projection.projectedRevenuePence,
      ratio,
      status: statusFromRatio(ratio, financials.currentAllowanceRatio),
    },
  }
}

// ---------------------------------------------------------------------------
// Per-scenario money impact
// ---------------------------------------------------------------------------
// "How much is this scenario worth?" — its standalone effect on the SCR
// position, in money. The engine's cost/revenue deltas are additive (each
// action shifts squad costs / revenue by a fixed sum, independent of the
// baseline), so a scenario's impact is a stable property: we read it by
// applying its actions to the settings baseline and diffing.
//
//   costDeltaPence     — change in annual squad costs (+ adds cost)
//   revenueDeltaPence  — change in SCR revenue        (+ adds revenue)
//   headroomDeltaPence — change in headroom to the Green threshold. This is the
//                        single "worth" figure: + frees room (helps compliance),
//                        − consumes room. Folds both cost and revenue in via
//                        Green = revenue × 0.85, so it answers "net SCR effect".

const GREEN_RATIO = 0.85

export interface ScenarioMoneyImpact {
  costDeltaPence: number
  revenueDeltaPence: number
  headroomDeltaPence: number
}

export function scenarioMoneyImpact(
  financials: ClubFinancialsResponse,
  scenario: ScenarioDetail,
): ScenarioMoneyImpact {
  const ownerEquity = financials.ownerEquityUsed1yr ?? 0
  const base = {
    squadCostsPence: financials.currentSquadCosts,
    revenuePence: financials.footballRelatedRevenue + ownerEquity,
  }
  const actions: ScenarioActionInput[] = scenario.actions.map(actionToEngineInput)
  const projection = applyScenarioActions(base, actions)

  const costDeltaPence = projection.projectedSquadCostsPence - base.squadCostsPence
  const revenueDeltaPence = projection.projectedRevenuePence - base.revenuePence
  // Δheadroom = Green(rev_after) − cost_after − (Green(rev_before) − cost_before)
  //           = GREEN_RATIO·Δrevenue − Δcost
  const headroomDeltaPence = Math.round(GREEN_RATIO * revenueDeltaPence) - costDeltaPence

  return { costDeltaPence, revenueDeltaPence, headroomDeltaPence }
}

// ---------------------------------------------------------------------------
// Thresholds (in pence) given a financials snapshot.
// Replaces inline math in pages so the gauge always renders consistently.
// ---------------------------------------------------------------------------
export function computeThresholds(adjustedRevenue: number, allowanceRatio: number) {
  const greenRatio = 0.85
  const green = Math.floor(adjustedRevenue * greenRatio)
  // Additive: Red = revenue × (85% + allowance%). For 30% allowance → 115% of revenue.
  const red   = Math.floor(adjustedRevenue * (greenRatio + allowanceRatio))
  return { greenPence: green, redPence: red }
}
