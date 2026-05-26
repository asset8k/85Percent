/**
 * Calculate points deduction for breaching the Red Threshold.
 *
 * Formula: 6 + floor(spendAboveRedThreshold / £6.5M)
 * Minimum: 6 points
 *
 * All monetary values in pence.
 */
export function calculatePointsDeduction(
  squadCosts: number,
  redThreshold: number,
  pointsDeductionPerUnit: number,
  basePoints: number
): number {
  const spendAboveRed = squadCosts - redThreshold
  if (spendAboveRed <= 0) return 0
  return basePoints + Math.floor(spendAboveRed / pointsDeductionPerUnit)
}
