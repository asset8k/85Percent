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
