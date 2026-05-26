import { calculateSCR } from '@headroom/engine'
import { LEAGUE_CONFIGS } from '@headroom/shared'
import type { ClubFinancials, ComplianceStatus, TransferInput, SCRResult } from '@headroom/shared'
import type { ClubFinancialsResponse } from '@/lib/api'
import type { StoredSimulation } from '@/stores/club'

const SEASON = '2026-27'

// Build the engine-shaped financials from the API response.
// Caller decides what squadCosts to inject — usually the active baseline.
export function toEngineFinancials(
  f: ClubFinancialsResponse,
  leagueId: string,
  squadCostsOverride?: number
): ClubFinancials {
  const leagueConfig = LEAGUE_CONFIGS[leagueId]
  if (!leagueConfig) throw new Error(`Unknown league: ${leagueId}`)
  return {
    clubId: f.clubId,
    season: f.season,
    leagueConfig,
    footballRelatedRevenue: f.footballRelatedRevenue,
    currentSquadCosts: squadCostsOverride ?? f.currentSquadCosts,
    currentAllowanceRatio: f.currentAllowanceRatio,
    ownerEquityUsedCurrentSeason: f.ownerEquityUsed1yr ?? undefined,
    ownerEquityUsedThreeYear: f.ownerEquityUsed3yr ?? undefined,
  }
}

// Annual squad-cost delta from a single transaction.
export function costDeltaForSim(sim: StoredSimulation, financials: ClubFinancialsResponse, leagueId: string): number {
  const engineFin = toEngineFinancials(financials, leagueId, financials.currentSquadCosts)
  const result = calculateSCR(engineFin, sim.transferInput as TransferInput, sim.season || SEASON)
  return result.totalAnnualCostImpact
}

// Annual revenue delta from a single transaction (counts toward Green Threshold).
// Sell:    profit on sale (proceeds − book value, floored at 0) booked in year 1
// LoanOut: loan fee received, pro-rated across loan length
// Otherwise: 0
function revenueDeltaForSim(sim: StoredSimulation): number {
  const t = sim.transferInput as Record<string, unknown> | null
  if (!t) return 0
  const txType = t['transactionType'] as string | undefined
  if (txType === 'sell') {
    const proceeds = (t['saleProceeds'] as number) ?? 0
    const bookValue = (t['playerBookValue'] as number) ?? 0
    return Math.max(0, proceeds - bookValue)
  }
  if (txType === 'loan_out') {
    const fee = (t['loanFeeReceived'] as number) ?? 0
    const years = (t['loanLengthYears'] as number) ?? 1
    return years > 0 ? Math.round(fee / years) : 0
  }
  return 0
}

export interface ActiveBaseline {
  includedCount: number
  baselineSquadCosts: number     // = financials.currentSquadCosts + Σ included cost deltas
  adjustedRevenue: number        // = revenue + ownerEquity1yr + Σ included revenue deltas
  ratio: number                  // baselineSquadCosts / adjustedRevenue
  status: ComplianceStatus
}

export function computeActiveBaseline(
  financials: ClubFinancialsResponse,
  leagueId: string,
  simulations: StoredSimulation[],
  excludeSimId?: string
): ActiveBaseline {
  const included = simulations.filter((s) => s.isIncluded && s.id !== excludeSimId)
  const costDeltasSum = included
    .map((s) => costDeltaForSim(s, financials, leagueId))
    .reduce((a, b) => a + b, 0)
  const revenueDeltasSum = included.map(revenueDeltaForSim).reduce((a, b) => a + b, 0)
  const baselineSquadCosts = financials.currentSquadCosts + costDeltasSum
  const adjustedRevenue =
    financials.footballRelatedRevenue + (financials.ownerEquityUsed1yr ?? 0) + revenueDeltasSum
  const ratio = adjustedRevenue === 0 ? 0 : baselineSquadCosts / adjustedRevenue
  // EFL: Red Threshold = Green Threshold × (1 + allowance) — multiplicative, not additive.
  // For 30% allowance, red boundary is 0.85 × 1.30 = 1.105 (110.5%), not 1.15 (115%).
  const allowance = financials.currentAllowanceRatio
  const greenRatio = 0.85
  const redRatio = greenRatio * (1 + allowance)
  const status: ComplianceStatus =
    ratio > redRatio ? 'red' : ratio > greenRatio ? 'amber' : 'green'

  return {
    includedCount: included.length,
    baselineSquadCosts,
    adjustedRevenue,
    ratio,
    status,
  }
}

// Detail-view BEFORE/AFTER recompute (per the literal spec).
//
// BEFORE = baseline excluding this sim   (= Active Baseline − X when checked, = Active Baseline when unchecked)
// AFTER  = baseline excluding this sim + this sim's deltas
//        (= Active Baseline when checked, = Active Baseline + X when unchecked)
//
// Numerically these collapse to the same gauges in both states — by design, per the spec.
export function computeBeforeAfter(
  sim: StoredSimulation,
  financials: ClubFinancialsResponse,
  leagueId: string,
  allSimulations: StoredSimulation[]
): SCRResult {
  const baselineWithoutThisSim = computeActiveBaseline(financials, leagueId, allSimulations, sim.id)
  const ownerEquity = financials.ownerEquityUsed1yr ?? 0
  const adjustedFinancials: ClubFinancialsResponse = {
    ...financials,
    footballRelatedRevenue: baselineWithoutThisSim.adjustedRevenue - ownerEquity,
    currentSquadCosts: baselineWithoutThisSim.baselineSquadCosts,
  }
  const engineFin = toEngineFinancials(adjustedFinancials, leagueId)
  return calculateSCR(engineFin, sim.transferInput as TransferInput, sim.season || SEASON)
}
