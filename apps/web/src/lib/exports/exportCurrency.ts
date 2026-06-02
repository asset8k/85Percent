/**
 * Active currency for the export pipeline (PDF + Excel).
 *
 * Exports run outside React, so they can't read the workspace-currency hook.
 * Instead each export entry point (exportSquadPDF / exportComparisonPDF /
 * exportAmortisationXLSX) calls `setExportCurrency(currency)` up-front with the
 * value the calling component pulled from `useWorkspaceCurrency`. The shared
 * money helpers then read this module-level value. Exports are synchronous and
 * never overlap, so a single module-level slot is safe.
 *
 * As everywhere else: there is NO conversion — the same integer pence values
 * are simply rendered with the active currency's symbol/format.
 */

import { currencySymbol, formatMoney, type Currency } from '@headroom/shared'

let activeCurrency: Currency = 'GBP'

export function setExportCurrency(currency: Currency): void {
  activeCurrency = currency
}

export function exportCurrency(): Currency {
  return activeCurrency
}

/** Active export symbol (£ / € / $). */
export function exportSymbol(): string {
  return currencySymbol(activeCurrency)
}

/** Format pence in the active export currency, e.g. "£14,820,000". */
export function exportMoney(pence: number, options?: { decimals?: boolean }): string {
  return formatMoney(pence, activeCurrency, options)
}

/** SheetJS number format for money columns, e.g. "£#,##0;[Red]−£#,##0". */
export function exportMoneyFormat(): string {
  const s = exportSymbol()
  return `${s}#,##0;[Red]−${s}#,##0`
}
