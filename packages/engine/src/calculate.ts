import type { ClubFinancials, TransferInput, SCRResult } from '@headroom/shared'
import { calculateThresholds } from './thresholds.js'
import { determineStatus } from './status.js'
import { calculateLevy } from './levy.js'
import { calculatePointsDeduction } from './points.js'
import { generateAmortisationSchedule, amortisationPeriodYears } from './amortisation.js'

/**
 * Core SCR calculation engine.
 *
 * Pure function — no side effects, no I/O.
 * All monetary values in pence throughout.
 */
export function calculateSCR(
  financials: ClubFinancials,
  transfer: TransferInput,
  currentSeason = '2026-27'
): SCRResult {
  const { leagueConfig, footballRelatedRevenue, currentSquadCosts } = financials
  // Owner equity injection counts as revenue under EFL SCR rules
  const revenueBase = footballRelatedRevenue + (financials.ownerEquityUsedCurrentSeason ?? 0)

  // — Current position (before transfer) —
  const thresholds = calculateThresholds(financials)
  const currentSCRRatio = currentSquadCosts / revenueBase
  const currentStatus = determineStatus(currentSquadCosts, thresholds)

  const type = transfer.transactionType ?? 'buy'
  // Legacy stored simulations used playerSaleProceeds on a 'buy' before transactionType existed
  const hasLegacySale = !transfer.transactionType &&
    (transfer.playerSaleProceeds != null || transfer.playerSaleBookValue != null)

  // ─── Per-type cost & revenue calculations ────────────────────────────────

  let annualAmortisation = 0
  let annualAgentFeeImpact = 0
  let netPlayerSaleImpact = 0   // revenue uplift from a sale or loan fee received
  let totalAnnualCostImpact = 0 // positive = more squad cost; negative = cost relief
  let rawRevenueDelta = 0       // change to footballRelatedRevenue (before equity)

  if (type === 'buy') {
    // Registration fees amortise over min(contractLength, 5) — the Chelsea Rule.
    const amortYears = amortisationPeriodYears(transfer.contractLengthYears)
    annualAmortisation = transfer.transferFee > 0
      ? Math.floor(transfer.transferFee / amortYears)
      : 0
    annualAgentFeeImpact = transfer.agentFee > 0
      ? Math.floor(transfer.agentFee / amortYears)
      : 0
    totalAnnualCostImpact = annualAmortisation + transfer.annualWage + annualAgentFeeImpact
    if (hasLegacySale) {
      netPlayerSaleImpact = Math.max(0, (transfer.playerSaleProceeds ?? 0) - (transfer.playerSaleBookValue ?? 0))
      rawRevenueDelta = netPlayerSaleImpact
    }

  } else if (type === 'sell') {
    const proceeds = transfer.saleProceeds ?? 0
    const bookVal = transfer.playerBookValue ?? 0
    netPlayerSaleImpact = Math.max(0, proceeds - bookVal)
    rawRevenueDelta = netPlayerSaleImpact
    const wageRelief = transfer.annualWageRelief ?? 0
    const amortRelief = transfer.annualAmortisationRelief ?? 0
    totalAnnualCostImpact = -(wageRelief + amortRelief)

  } else if (type === 'loan_in') {
    // transferFee holds the loan fee; contractLengthYears holds the loan duration
    annualAmortisation = transfer.transferFee > 0
      ? Math.floor(transfer.transferFee / transfer.contractLengthYears)
      : 0
    totalAnnualCostImpact = annualAmortisation + transfer.annualWage

  } else if (type === 'loan_out') {
    const feeReceived = transfer.loanFeeReceived ?? 0
    const loanYears = transfer.loanLengthYears ?? 1
    const annualFeeIncome = feeReceived > 0 ? Math.floor(feeReceived / loanYears) : 0
    netPlayerSaleImpact = annualFeeIncome
    rawRevenueDelta = annualFeeIncome
    totalAnnualCostImpact = -(transfer.annualWageCovered ?? 0)

  }

  // ─── Projected position (after transfer) ─────────────────────────────────
  // Pass raw footballRelatedRevenue + delta to calculateThresholds so it can apply equity correctly
  const projectedThresholds = calculateThresholds({
    ...financials,
    footballRelatedRevenue: footballRelatedRevenue + rawRevenueDelta,
  })

  const adjustedRevenue = revenueBase + rawRevenueDelta
  const projectedSquadCosts = currentSquadCosts + totalAnnualCostImpact
  const projectedSCRRatio = projectedSquadCosts / adjustedRevenue
  const projectedStatus = determineStatus(projectedSquadCosts, projectedThresholds)

  const headroomRemaining = projectedThresholds.greenThreshold - projectedSquadCosts
  const redThresholdHeadroom = projectedThresholds.redThreshold - projectedSquadCosts

  // ─── Sanctions ────────────────────────────────────────────────────────────
  let projectedLevy: number | undefined
  let projectedPointsDeduction: number | undefined

  if (projectedStatus === 'amber' || projectedStatus === 'red') {
    projectedLevy = calculateLevy(
      projectedSquadCosts,
      projectedThresholds.greenThreshold,
      adjustedRevenue,
      leagueConfig.greenThresholdRatio
    )
  }
  if (projectedStatus === 'red') {
    projectedPointsDeduction = calculatePointsDeduction(
      projectedSquadCosts,
      projectedThresholds.redThreshold,
      leagueConfig.pointsDeductionPerUnit,
      leagueConfig.pointsDeductionBasePoints
    )
  }

  // ─── Amortisation schedule (buy only; loan_in shows loan fee schedule) ────
  const showSchedule = type === 'buy' || type === 'loan_in' || !transfer.transactionType
  const amortisationSchedule = showSchedule
    ? generateAmortisationSchedule(transfer.transferFee, transfer.contractLengthYears, currentSeason)
    : []

  return {
    currentSCRRatio,
    currentGreenThreshold: thresholds.greenThreshold,
    currentRedThreshold: thresholds.redThreshold,
    currentStatus,

    annualAmortisation,
    annualAgentFeeImpact,
    netPlayerSaleImpact,
    totalAnnualCostImpact,

    projectedSquadCosts,
    projectedSCRRatio,
    projectedStatus,
    headroomRemaining,
    redThresholdHeadroom,

    projectedLevy,
    projectedPointsDeduction,

    amortisationSchedule,
  }
}
