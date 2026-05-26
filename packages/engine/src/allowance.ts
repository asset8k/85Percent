/**
 * Update the club's allowance ratio after end-of-season Accounts Confirmation Test.
 *
 * Negative feedback: if SCR > greenThresholdRatio, allowance -= (SCR - greenThresholdRatio)
 * Positive feedback: if SCR <= greenThresholdRatio, allowance += feedbackLoopIncrement (max initialAllowanceRatio)
 * Allowance floor: 0
 */
export function calculateAllowanceUpdate(
  currentAllowance: number,
  scrRatio: number,
  greenThresholdRatio: number,
  feedbackLoopIncrement: number,
  initialAllowanceRatio: number
): number {
  if (scrRatio > greenThresholdRatio) {
    const breach = scrRatio - greenThresholdRatio
    return Math.max(0, currentAllowance - breach)
  }
  return Math.min(initialAllowanceRatio, currentAllowance + feedbackLoopIncrement)
}
