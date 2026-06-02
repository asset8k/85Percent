import type { Currency } from './types.js'

/**
 * Display symbol for each supported currency. The minor unit ("pence") is a
 * misnomer for EUR/USD but the storage model is identical: an integer 1/100th
 * of the major unit, in whatever currency the workspace runs in.
 */
export const CURRENCY_SYMBOLS: Record<Currency, string> = {
  GBP: '£',
  EUR: '€',
  USD: '$',
}

/** Intl locale used to format each currency's grouping/decimal style. */
const CURRENCY_LOCALES: Record<Currency, string> = {
  GBP: 'en-GB',
  EUR: 'en-IE',
  USD: 'en-US',
}

/** The symbol (£ / € / $) for a currency. Defaults to £ for safety. */
export function currencySymbol(currency: Currency = 'GBP'): string {
  return CURRENCY_SYMBOLS[currency] ?? CURRENCY_SYMBOLS.GBP
}

/** Convert pounds (display value) to pence (storage integer) */
export function poundsToPence(pounds: number): number {
  return Math.round(pounds * 100)
}

/** Convert pence (storage integer) to pounds (display value) */
export function penceToPounds(pence: number): number {
  return pence / 100
}

/**
 * Format minor units (pence) as a currency string e.g. £1,250,000 / €1,250,000.
 * The number is treated as-is in the given currency — there is NO conversion.
 */
export function formatMoney(
  pence: number,
  currency: Currency = 'GBP',
  options?: { decimals?: boolean },
): string {
  const major = penceToPounds(pence)
  return new Intl.NumberFormat(CURRENCY_LOCALES[currency] ?? 'en-GB', {
    style: 'currency',
    currency,
    minimumFractionDigits: options?.decimals ? 2 : 0,
    maximumFractionDigits: options?.decimals ? 2 : 0,
  }).format(major)
}

/**
 * Format pence as a human-readable GBP string e.g. £1,250,000.
 * Back-compat wrapper around {@link formatMoney} — prefer formatMoney with the
 * workspace currency for anything user-facing.
 */
export function formatPence(pence: number, options?: { decimals?: boolean }): string {
  return formatMoney(pence, 'GBP', options)
}

/** Format a ratio (0–1) as a percentage string e.g. 85.4% */
export function formatRatio(ratio: number, decimals = 1): string {
  return `${(ratio * 100).toFixed(decimals)}%`
}

/** Weekly wage in pounds → annual wage in pence */
export function weeklyWageToAnnualPence(weeklyWagePounds: number): number {
  return poundsToPence(weeklyWagePounds * 52)
}
