/**
 * Roster cost projections for presentation.
 *
 * This module does not implement financial arithmetic. It prepares a single
 * normalized contract input for @85percent/engine and returns that engine's
 * breakdown for table rows and unsaved-form previews.
 */

import { amortisationPeriodYears, calculateSquadCosts } from '@85percent/engine'

export interface RosterCostPreviewInput {
  feePence: number
  carriedBookValuePence?: number | null
  annualWagePence: number
  agentFeePence: number
  startDate: string
  endDate: string
}

export interface RosterCostPreview {
  wagePence: number
  amortisationPence: number
  annualisedAgentFeePence: number
  totalAnnualCostPence: number
  contractLengthYears: number
  amortisationTermYears: number
}

export type WageFrequency = 'annual' | 'weekly'

export function annualWagePenceFromPounds(value: number, frequency: WageFrequency): number {
  if (!Number.isFinite(value) || value < 0) return 0
  return Math.round(value * (frequency === 'weekly' ? 52 : 1) * 100)
}

/**
 * Expresses the change in SCR percentage points caused by one annual squad
 * cost. The caller supplies the already-normalised football revenue from the
 * club financials response; no React component should perform this conversion
 * itself.
 */
export function estimateScrChangePoints(
  totalAnnualCostPence: number,
  footballRelatedRevenuePence: number | null | undefined,
): number | null {
  if (
    footballRelatedRevenuePence == null ||
    !Number.isFinite(footballRelatedRevenuePence) ||
    footballRelatedRevenuePence <= 0
  ) return null

  return (totalAnnualCostPence / footballRelatedRevenuePence) * 100
}

export function contractDurationYears(startDate: string, endDate: string): number | null {
  if (!startDate || !endDate) return null
  const start = new Date(`${startDate}T00:00:00Z`)
  const end = new Date(`${endDate}T00:00:00Z`)
  const milliseconds = end.getTime() - start.getTime()
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) return null
  return Math.round((milliseconds / (365.25 * 24 * 60 * 60 * 1000)) * 100) / 100
}

export function previewAnnualCost(input: RosterCostPreviewInput): RosterCostPreview | null {
  const contractLengthYears = contractDurationYears(input.startDate, input.endDate)
  if (contractLengthYears == null) return null

  const result = calculateSquadCosts([{
    playerId: 'preview',
    transferFeePence: Math.max(0, Math.round(input.feePence)),
    carriedBookValuePence: input.carriedBookValuePence ?? null,
    annualWagePence: Math.max(0, Math.round(input.annualWagePence)),
    agentFeePence: Math.max(0, Math.round(input.agentFeePence)),
    contractLengthYears,
  }]).breakdown[0]
  if (!result) return null

  return {
    ...result,
    contractLengthYears,
    amortisationTermYears: amortisationPeriodYears(contractLengthYears),
  }
}
