import type { ClubFinancials } from '@headroom/shared'

export interface Thresholds {
  greenThreshold: number
  redThreshold: number
}

/**
 * Calculate the Green and Red compliance thresholds for a club.
 * Green = revenue × greenThresholdRatio (e.g. 85%)
 * Red   = Green × (1 + allowanceRatio)
 * All values in pence.
 */
export function calculateThresholds(financials: ClubFinancials): Thresholds {
  const { footballRelatedRevenue, currentAllowanceRatio, leagueConfig, ownerEquityUsedCurrentSeason } = financials
  // Owner equity injection counts as revenue under EFL SCR rules
  const adjustedRevenue = footballRelatedRevenue + (ownerEquityUsedCurrentSeason ?? 0)
  const greenThreshold = Math.floor(adjustedRevenue * leagueConfig.greenThresholdRatio)
  const redThreshold = Math.floor(greenThreshold * (1 + currentAllowanceRatio))
  return { greenThreshold, redThreshold }
}
