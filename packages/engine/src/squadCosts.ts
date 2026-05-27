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
 * - We compute `contractLengthYears` from the date range when the caller
 *   supplies one; this is the SCR-correct denominator (not whatever decimal
 *   was stored at insert time).
 */

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

export interface PlayerCostBreakdown {
  playerId: string
  wagePence: number
  amortisationPence: number
  /**
   * Annualised agent fee — agentFee / contractLengthYears.
   * UI must surface this as "Annualised Agent Fee" with a tooltip, NOT
   * "Agent Fee", because the user's own books may show the fee paid 100%
   * up-front. The SCR engine amortises by regulation.
   */
  annualisedAgentFeePence: number
  totalAnnualCostPence: number
}

export interface SquadCostsResult {
  totalSquadCostsPence: number
  breakdown: PlayerCostBreakdown[]
}

/**
 * Sum per-player annual SCR cost across all supplied contracts.
 *
 * Returns the aggregate plus a row per player so the Dashboard table can
 * render without recomputing. Order of breakdown rows is preserved from input.
 */
export function calculateSquadCosts(contracts: ContractInput[]): SquadCostsResult {
  const breakdown: PlayerCostBreakdown[] = contracts.map((c) => {
    // Defensive: a zero-length contract shouldn't divide-by-zero. If the input
    // is invalid, fall back to a single-year amortisation so the player is
    // visible in the breakdown rather than silently corrupting the total.
    const years = c.contractLengthYears > 0 ? c.contractLengthYears : 1

    const amortisationPence = c.transferFeePence > 0
      ? Math.floor(c.transferFeePence / years)
      : 0

    const annualisedAgentFeePence = c.agentFeePence > 0
      ? Math.floor(c.agentFeePence / years)
      : 0

    const totalAnnualCostPence = c.annualWagePence + amortisationPence + annualisedAgentFeePence

    return {
      playerId: c.playerId,
      wagePence: c.annualWagePence,
      amortisationPence,
      annualisedAgentFeePence,
      totalAnnualCostPence,
    }
  })

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
      const amort = a.transferFeePence && a.transferFeePence > 0
        ? Math.floor(a.transferFeePence / years)
        : 0
      const agent = a.agentFeePence && a.agentFeePence > 0
        ? Math.floor(a.agentFeePence / years)
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
