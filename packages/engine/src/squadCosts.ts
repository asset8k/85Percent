/**
 * Squad-cost aggregation (MVP 2.0).
 *
 * Pure functions — no I/O, no DB calls. Takes contracts (already loaded by the
 * caller from the DB) and returns the totals + per-player breakdown that drive
 * the Dashboard and feed `calculateSCR`.
 *
 * Conventions:
 * - All monetary values in pence.
 * - Agent fees are spread evenly across the contract length (regulatory).
 * - Transfer fees are also spread (straight-line amortisation).
 * - Both fees are amortised over min(contractLength, 5) years — the UEFA/PSR
 *   cap (the "Chelsea Rule"). See AMORTISATION_CAP_YEARS in amortisation.ts.
 * - We compute `contractLengthYears` from the date range when the caller
 *   supplies one; this is the SCR-correct denominator (not whatever decimal
 *   was stored at insert time).
 * - SCR squad costs include the Head Coach / Manager: their wage, amortised
 *   compensation fee, and amortised agent fee are added to the player totals.
 */

import { amortisationPeriodYears } from './amortisation.js'

export interface ContractInput {
  /** Application-level identifier — typically the player id (for breakdown rows). */
  playerId: string
  /** Total transfer fee in pence (0 for free transfers). */
  transferFeePence: number
  /** Annual wage in pence per year. */
  annualWagePence: number
  /** One-off agent fee in pence. */
  agentFeePence: number
  /** Contract length expressed in years (may be fractional, e.g. 3.5). */
  contractLengthYears: number
}

/**
 * The active Head Coach / Manager. Their compensation fee (the fee paid to
 * another club to release them) is the manager's equivalent of a transfer fee
 * and is amortised the same way — capped at 5 years.
 */
export interface ManagerCostInput {
  /** Manager id (used as the breakdown row identifier). */
  managerId: string
  /** Compensation fee paid to poach the manager, in pence (0 if a free hire). */
  compensationFeePence: number
  annualWagePence: number
  agentFeePence: number
  contractLengthYears: number
}

export interface PlayerCostBreakdown {
  playerId: string
  wagePence: number
  amortisationPence: number
  /**
   * Annualised agent fee — agentFee / min(contractLength, 5).
   * UI must surface this as "Annualised Agent Fee" with a tooltip, NOT
   * "Agent Fee", because the user's own books may show the fee paid 100%
   * up-front. The SCR engine amortises by regulation.
   */
  annualisedAgentFeePence: number
  totalAnnualCostPence: number
  /** True for the Head Coach / Manager row so the UI can label it distinctly. */
  isManager?: boolean
}

export interface SquadCostsResult {
  totalSquadCostsPence: number
  breakdown: PlayerCostBreakdown[]
}

// Annual SCR cost of a single capitalised registration: wage + amortised fee
// + amortised agent fee, with both fees spread over the capped period.
function annualCost(input: {
  feePence: number
  annualWagePence: number
  agentFeePence: number
  contractLengthYears: number
}): { amortisationPence: number; annualisedAgentFeePence: number; totalAnnualCostPence: number } {
  const amortYears = amortisationPeriodYears(input.contractLengthYears)
  const amortisationPence = input.feePence > 0 ? Math.floor(input.feePence / amortYears) : 0
  const annualisedAgentFeePence = input.agentFeePence > 0 ? Math.floor(input.agentFeePence / amortYears) : 0
  const totalAnnualCostPence = input.annualWagePence + amortisationPence + annualisedAgentFeePence
  return { amortisationPence, annualisedAgentFeePence, totalAnnualCostPence }
}

/**
 * Sum per-player annual SCR cost across all supplied contracts, plus the active
 * Manager when one is supplied.
 *
 * Returns the aggregate plus a row per player (and a final manager row, flagged
 * with isManager) so the Dashboard table can render without recomputing. Order
 * of player breakdown rows is preserved from input; the manager row is appended.
 */
export function calculateSquadCosts(
  contracts: ContractInput[],
  manager?: ManagerCostInput | null
): SquadCostsResult {
  const breakdown: PlayerCostBreakdown[] = contracts.map((c) => {
    const { amortisationPence, annualisedAgentFeePence, totalAnnualCostPence } = annualCost({
      feePence: c.transferFeePence,
      annualWagePence: c.annualWagePence,
      agentFeePence: c.agentFeePence,
      contractLengthYears: c.contractLengthYears,
    })
    return {
      playerId: c.playerId,
      wagePence: c.annualWagePence,
      amortisationPence,
      annualisedAgentFeePence,
      totalAnnualCostPence,
    }
  })

  if (manager) {
    const { amortisationPence, annualisedAgentFeePence, totalAnnualCostPence } = annualCost({
      feePence: manager.compensationFeePence,
      annualWagePence: manager.annualWagePence,
      agentFeePence: manager.agentFeePence,
      contractLengthYears: manager.contractLengthYears,
    })
    breakdown.push({
      playerId: manager.managerId,
      wagePence: manager.annualWagePence,
      amortisationPence,
      annualisedAgentFeePence,
      totalAnnualCostPence,
      isManager: true,
    })
  }

  const totalSquadCostsPence = breakdown.reduce((s, row) => s + row.totalAnnualCostPence, 0)
  return { totalSquadCostsPence, breakdown }
}

// ---------------------------------------------------------------------------
// Multi-action scenario projection
// ---------------------------------------------------------------------------
// A scenario is an ordered list of actions applied to the baseline. Each
// action shifts either squad costs, revenue, or both. The aggregate output
// becomes the input to `calculateSCR`'s `currentSquadCosts` + `revenue`
// override, giving a single projected SCR for the entire plan.

export type ScenarioActionType = 'buy' | 'sell' | 'loan_in' | 'loan_out' | 'release'

export interface ScenarioActionInput {
  actionType: ScenarioActionType
  /** Disregards this action when false. Drives the "include in projection" toggle. */
  isIncluded?: boolean

  // BUY & LOAN_IN — incoming player
  transferFeePence?: number
  contractLengthYears?: number
  annualWagePence?: number
  agentFeePence?: number

  // SELL — outgoing permanent
  saleProceedsPence?: number
  playerBookValuePence?: number
  annualWageReliefPence?: number
  annualAmortisationReliefPence?: number

  // LOAN_OUT — outgoing temporary
  loanFeeReceivedPence?: number
  loanLengthYears?: number
  annualWageCoveredPence?: number

  // RELEASE — player walks (free transfer out, no income)
  // Uses the same wage/amortisation relief fields as 'sell' but with no proceeds.
  // (annualWageReliefPence + annualAmortisationReliefPence above are reused.)
}

export interface ScenarioBaseline {
  squadCostsPence: number
  revenuePence: number
}

export interface ScenarioProjection {
  projectedSquadCostsPence: number
  projectedRevenuePence: number
  /** Net delta vs baseline — useful for headline UI ("scenario adds £X to costs"). */
  costDeltaPence: number
  revenueDeltaPence: number
}

/**
 * Apply an ordered list of scenario actions to a baseline.
 *
 * Pure function. Each action is normalised to a (cost delta, revenue delta)
 * pair, then summed. Order doesn't matter mathematically (commutative), but
 * the caller may choose to track order for audit/display.
 */
export function applyScenarioActions(
  baseline: ScenarioBaseline,
  actions: ScenarioActionInput[]
): ScenarioProjection {
  let costDelta = 0
  let revenueDelta = 0

  for (const a of actions) {
    if (a.isIncluded === false) continue

    const years = a.contractLengthYears && a.contractLengthYears > 0 ? a.contractLengthYears : 1

    if (a.actionType === 'buy') {
      // Registration fees amortise over the capped period (min(length, 5)).
      const amortYears = amortisationPeriodYears(years)
      const amort = a.transferFeePence && a.transferFeePence > 0
        ? Math.floor(a.transferFeePence / amortYears)
        : 0
      const agent = a.agentFeePence && a.agentFeePence > 0
        ? Math.floor(a.agentFeePence / amortYears)
        : 0
      costDelta += amort + (a.annualWagePence ?? 0) + agent
    }

    else if (a.actionType === 'sell') {
      const wageRelief  = a.annualWageReliefPence ?? 0
      const amortRelief = a.annualAmortisationReliefPence ?? 0
      costDelta -= (wageRelief + amortRelief)
      const proceeds = a.saleProceedsPence ?? 0
      const bookVal  = a.playerBookValuePence ?? 0
      // Net profit on sale (only positive contributes to revenue per EFL rules)
      const saleProfit = Math.max(0, proceeds - bookVal)
      revenueDelta += saleProfit
    }

    else if (a.actionType === 'loan_in') {
      const loanYears = a.loanLengthYears && a.loanLengthYears > 0 ? a.loanLengthYears : years
      const annualLoanFee = a.transferFeePence && a.transferFeePence > 0
        ? Math.floor(a.transferFeePence / loanYears)
        : 0
      costDelta += annualLoanFee + (a.annualWagePence ?? 0)
    }

    else if (a.actionType === 'loan_out') {
      const wageCovered = a.annualWageCoveredPence ?? 0
      costDelta -= wageCovered
      const loanYears = a.loanLengthYears && a.loanLengthYears > 0 ? a.loanLengthYears : 1
      const annualLoanFee = a.loanFeeReceivedPence && a.loanFeeReceivedPence > 0
        ? Math.floor(a.loanFeeReceivedPence / loanYears)
        : 0
      revenueDelta += annualLoanFee
    }

    else if (a.actionType === 'release') {
      // Player walks with no proceeds. Costs go down (wage + amortisation),
      // revenue is unchanged.
      const wageRelief  = a.annualWageReliefPence ?? 0
      const amortRelief = a.annualAmortisationReliefPence ?? 0
      costDelta -= (wageRelief + amortRelief)
    }
  }

  return {
    projectedSquadCostsPence: baseline.squadCostsPence + costDelta,
    projectedRevenuePence:    baseline.revenuePence + revenueDelta,
    costDeltaPence: costDelta,
    revenueDeltaPence: revenueDelta,
  }
}
