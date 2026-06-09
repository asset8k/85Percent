/**
 * locale — locale-aware date & number formatting tied to the interface language.
 *
 * These helpers read the *current* i18next language so that switching the
 * Interface Language in Settings instantly re-localizes dates and plain numbers
 * (e.g. Spanish users see `02/01/2026` and `1.250.000`, French `02/01/2026` and
 * `1 250 000`). They deliberately do NOT touch currency: monetary values remain
 * formatted by the workspace base currency via `useWorkspaceCurrency` /
 * `formatMoney`, which must not change with the UI language.
 *
 * Functions read `i18n.language` at call time, so module-level (non-hook)
 * callers like the Calendar's date formatter pick up the active locale too.
 */

import i18n from '@/lib/i18n'

/** Map an interface language to the BCP-47 locale used by Intl formatters. */
const LANGUAGE_TO_LOCALE: Record<string, string> = {
  en: 'en-GB',
  es: 'es-ES',
  fr: 'fr-FR',
  it: 'it-IT',
}

/** The active Intl locale, derived from the current interface language. */
export function activeLocale(): string {
  const lng = (i18n.language || 'en').split('-')[0] ?? 'en'
  return LANGUAGE_TO_LOCALE[lng] ?? 'en-GB'
}

/**
 * Parse a server timestamp into the correct instant.
 *
 * Several columns are Postgres `TIMESTAMP(3)` (timestamp WITHOUT time zone),
 * which Supabase returns as a zone-less ISO-like string, e.g.
 * `"2026-06-09T14:30:00.123"`. The server stores these in UTC, but `new Date()`
 * parses a zone-less date-time as the viewer's LOCAL time — silently shifting
 * the instant by the browser's offset (so a UTC value renders as UTC wall-clock,
 * not the user's local time). This normalises such strings to UTC by appending
 * "Z"; strings that already carry a zone (`Z` or `±HH:MM`) and epoch numbers /
 * `Date`s pass through untouched.
 *
 * Use this (instead of `new Date(...)`) before formatting a server timestamp in
 * the user's LOCAL zone — i.e. format the result WITHOUT a `timeZone` option so
 * Intl uses the browser's setting.
 */
export function parseServerDate(value: string | number | Date): Date {
  if (value instanceof Date) return value
  if (typeof value === 'number') return new Date(value)
  const hasZone = /[zZ]$|[+-]\d{2}:?\d{2}$/.test(value)
  return new Date(hasZone ? value : value + 'Z')
}

/**
 * Format a date in the active locale. Accepts a `Date`, an epoch-ms number, or
 * an ISO string. Defaults to a numeric DD/MM/YYYY-style date, which Intl
 * localizes per language (US would flip to MM/DD/YYYY, but we only ship
 * European locales here).
 */
export function formatDate(
  value: Date | number | string,
  options: Intl.DateTimeFormatOptions = { day: '2-digit', month: '2-digit', year: 'numeric' },
): string {
  const date = value instanceof Date ? value : new Date(value)
  return new Intl.DateTimeFormat(activeLocale(), { timeZone: 'UTC', ...options }).format(date)
}

/** Format a plain (non-currency) number in the active locale. */
export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(activeLocale(), options).format(value)
}
