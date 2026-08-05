/** Formats an SCR ratio (for example 1.023) as a displayed percentage. */
export function formatPercentage(value: number, digits = 1): string {
  return `${(value * 100).toFixed(digits)}%`
}

/** Formats an already percentage-point delta (for example 6.6) consistently. */
export function formatPercentagePointDelta(value: number, digits = 1): string {
  return `${value >= 0 ? '+' : ''}${value.toFixed(digits)} pp`
}
