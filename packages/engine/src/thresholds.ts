import type { ClubFinancials } from '@headroom/shared'

export interface Thresholds {
  greenThreshold: number
  redThreshold: number
}

/**
 * Calculate the Green and Red compliance thresholds for a club.
 * Green = revenue × greenThresholdRatio                          (e.g. 85%)
 * Red   = revenue × (greenThresholdRatio + allowanceRatio)       (e.g. 85% + 30% = 115%)
 *
 * The allowance is ADDITIVE on top of the baseline cap — the Red Threshold is
 * "Green % + allowance %" of revenue, NOT Green amount × (1 + allowance).
 * For £50M revenue and 30% allowance: red = £57.5M (115%), not £55.25M (110.5%).
 * All values in pence.
 */
export function calculateThresholds(financials: ClubFinancials): Thresholds {
  const { footballRelatedRevenue, currentAllowanceRatio, leagueConfig, ownerEquityUsedCurrentSeason } = financials
  // Owner equity injection counts as revenue under EFL SCR rules
  const adjustedRevenue = footballRelatedRevenue + (ownerEquityUsedCurrentSeason ?? 0)
  const greenThreshold = Math.floor(adjustedRevenue * leagueConfig.greenThresholdRatio)
  const redThreshold = Math.floor(adjustedRevenue * (leagueConfig.greenThresholdRatio + currentAllowanceRatio))
  return { greenThreshold, redThreshold }
}
