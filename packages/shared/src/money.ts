/** Convert pounds (display value) to pence (storage integer) */
export function poundsToPence(pounds: number): number {
  return Math.round(pounds * 100)
}

/** Convert pence (storage integer) to pounds (display value) */
export function penceToPounds(pence: number): number {
  return pence / 100
}

/** Format pence as a human-readable GBP string e.g. £1,250,000 */
export function formatPence(pence: number, options?: { decimals?: boolean }): string {
  const pounds = penceToPounds(pence)
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    minimumFractionDigits: options?.decimals ? 2 : 0,
    maximumFractionDigits: options?.decimals ? 2 : 0,
  }).format(pounds)
}

/** Format a ratio (0–1) as a percentage string e.g. 85.4% */
export function formatRatio(ratio: number, decimals = 1): string {
  return `${(ratio * 100).toFixed(decimals)}%`
}

/** Weekly wage in pounds → annual wage in pence */
export function weeklyWageToAnnualPence(weeklyWagePounds: number): number {
  return poundsToPence(weeklyWagePounds * 52)
}
