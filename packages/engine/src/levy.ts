/**
 * Calculate the financial levy for a club in the Amber zone.
 *
 * Formula: overspend × (SCR ratio - green threshold ratio)
 * Example: £250,000 overspend, SCR 89% → 250,000 × 0.04 = £10,000
 *
 * All monetary values in pence.
 */
export function calculateLevy(
  squadCosts: number,
  greenThreshold: number,
  footballRelatedRevenue: number,
  greenThresholdRatio: number
): number {
  const overspend = squadCosts - greenThreshold
  if (overspend <= 0) return 0
  const scrRatio = squadCosts / footballRelatedRevenue
  const overspendRatio = scrRatio - greenThresholdRatio
  if (overspendRatio <= 0) return 0
  return Math.floor(overspend * overspendRatio)
}
