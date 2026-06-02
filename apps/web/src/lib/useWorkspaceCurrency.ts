/**
 * useWorkspaceCurrency — single source of truth for the active workspace
 * currency on the frontend.
 *
 * Every monetary figure is entered, stored, and run through the FFP engine in
 * one base currency; this hook exposes that currency plus ready-made helpers so
 * forms and tables render the correct symbol (£ / € / $) without each call site
 * re-deriving it. Changing the currency in Settings updates the club store,
 * which re-renders every consumer of this hook instantly.
 *
 * There is NO conversion anywhere — `format` simply re-labels the same integer
 * minor-unit ("pence") value with the active symbol.
 */

import { useCallback } from 'react'
import { currencySymbol, formatMoney, type Currency } from '@headroom/shared'
import { useClubStore } from '@/stores/club'

export interface WorkspaceCurrency {
  /** The active currency code (GBP / EUR / USD). */
  currency: Currency
  /** The display symbol for the active currency (£ / € / $). */
  symbol: string
  /** Format a minor-unit (pence) integer in the active currency. */
  format: (pence: number, options?: { decimals?: boolean }) => string
}

export function useWorkspaceCurrency(): WorkspaceCurrency {
  const currency = useClubStore((s) => s.baseCurrency)
  const format = useCallback(
    (pence: number, options?: { decimals?: boolean }) => formatMoney(pence, currency, options),
    [currency],
  )
  return { currency, symbol: currencySymbol(currency), format }
}
