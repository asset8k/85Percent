import type { AmortisationEntry } from '@85percent/shared'

/**
 * Regulatory amortisation cap (the "Chelsea Rule").
 *
 * UEFA / PSR cap the amortisation period of a registration (transfer + agent
 * fee) at 5 years regardless of the contract length. So an £100M player on an
 * 8-year deal is amortised over 5 years (£20M/yr), not 8 (£12.5M/yr), and the
 * book value reaches zero at the 5-year mark — there is nothing left to carry
 * into the back end of the deal.
 *
 * This is the denominator used everywhere a fee is spread across years.
 */
export const AMORTISATION_CAP_YEARS = 5

/**
 * The number of years a fee is actually amortised over: the contract length
 * capped at AMORTISATION_CAP_YEARS, floored at 1 so a zero/negative length
 * never divides by zero.
 */
export function amortisationPeriodYears(contractLengthYears: number): number {
  const len = contractLengthYears > 0 ? contractLengthYears : 1
  return Math.min(len, AMORTISATION_CAP_YEARS)
}

// Whole-month count between two dates. Day-of-month ignored — straight-line
// amortisation for SCR uses month boundaries, not calendar-day precision.
// This means a transfer on Feb 29 (leap year) and one on Feb 28 (non-leap)
// produce identical schedules — what the regulations require.
function monthsBetween(from: Date, to: Date): number {
  return (to.getUTCFullYear() - from.getUTCFullYear()) * 12 +
         (to.getUTCMonth() - from.getUTCMonth())
}

// The date on which a fee is fully amortised: the earlier of the contract end
// and start + AMORTISATION_CAP_YEARS. Beyond this point book value is zero.
function amortisationEndDate(startDate: Date, endDate: Date): Date {
  const capped = new Date(Date.UTC(
    startDate.getUTCFullYear() + AMORTISATION_CAP_YEARS,
    startDate.getUTCMonth(),
    startDate.getUTCDate(),
  ))
  return capped.getTime() < endDate.getTime() ? capped : endDate
}

// Coerce a bigint|number into a number (pence).
function toNumber(v: bigint | number): number {
  return typeof v === 'bigint' ? Number(v) : v
}

/**
 * The fee an SCR calculation should amortise for a contract phase.
 *
 * Normally this is the transfer fee. But when a player signed an extension
 * mid-tenure and we lack the historical phases to amortise the original fee
 * from scratch (e.g. a Transfermarkt snapshot), the CFO records the exact
 * remaining Net Book Value at the moment of the extension as a
 * **Carried Book Value override**. When that override is present (non-null) it
 * REPLACES the transfer fee as the principal — the original fee is ignored and
 * the carried NBV is amortised over the extension phase instead.
 *
 * Returns the override when non-null, otherwise the transfer fee. Pure.
 */
export function effectiveFeePence(
  transferFeePence: bigint | number,
  carriedBookValuePence?: bigint | number | null,
): number {
  if (carriedBookValuePence != null) return toNumber(carriedBookValuePence)
  return toNumber(transferFeePence)
}

/**
 * Current book value of a transfer/compensation fee, straight-line amortised
 * over the contract's date range **capped at 5 years** (AMORTISATION_CAP_YEARS).
 * Returns 0 once fully amortised (at the capped end date) or once asOf is at/past
 * it. Returns the full fee if asOf is before the start date (book value is
 * locked in at purchase).
 *
 * When `carriedBookValuePence` is supplied (non-null) it OVERRIDES the transfer
 * fee: the carried Net Book Value becomes the principal that is amortised over
 * this phase (start → capped end). Used for extension blocks where the original
 * fee is unknown. See effectiveFeePence.
 *
 * All monetary values in pence. Pure function — pass asOf explicitly in tests.
 */
export function currentBookValuePence(
  transferFeePence: bigint | number,
  startDate: Date,
  endDate: Date,
  asOf: Date = new Date(),
  carriedBookValuePence?: bigint | number | null,
): number {
  const fee = effectiveFeePence(transferFeePence, carriedBookValuePence)
  if (fee === 0) return 0

  // Amortise over the capped window, not the full contract length.
  const cappedEnd = amortisationEndDate(startDate, endDate)
  const totalMonths = monthsBetween(startDate, cappedEnd)
  if (totalMonths <= 0) return 0

  // Clamp asOf to [startDate, cappedEnd]
  if (asOf.getTime() <= startDate.getTime()) return fee
  if (asOf.getTime() >= cappedEnd.getTime()) return 0

  const remainingMonths = monthsBetween(asOf, cappedEnd)
  return Math.floor(fee * (remainingMonths / totalMonths))
}

/**
 * A single amortisable contract phase. `feePence` is the capitalised
 * registration cost (a player's transfer fee or a manager's compensation fee).
 */
export interface AmortisableContract {
  feePence: bigint | number
  startDate: Date
  endDate: Date
}

/**
 * Carried book value of a contract on a given date — the exact remaining value
 * of the capitalised fee when, e.g., a new extension is signed mid-deal.
 *
 * This is the principal that gets carried into an EXTENSION phase: the old
 * deal's unamortised book value becomes the starting fee of the new phase,
 * which is then re-amortised over the new (capped) duration.
 *
 * Respects the 5-year amortisation cap. Pure function.
 */
export function calculateRemainingBookValue(
  contract: AmortisableContract,
  targetDate: Date
): number {
  return currentBookValuePence(
    contract.feePence,
    contract.startDate,
    contract.endDate,
    targetDate
  )
}

/**
 * Generate a year-by-year amortisation schedule for a transfer.
 * Transfer fee is spread equally over the amortisation period — the contract
 * length capped at 5 years (AMORTISATION_CAP_YEARS, the "Chelsea Rule"). An
 * 8-year deal therefore produces a 5-entry schedule that fully amortises the
 * fee by year 5, matching the SCR squad-cost denominator.
 * All monetary values in pence.
 */
export function generateAmortisationSchedule(
  transferFee: number,
  contractLengthYears: number,
  startSeason: string
): AmortisationEntry[] {
  // Cap the spread period at 5 years so the schedule agrees with SCR math.
  const amortYears = amortisationPeriodYears(contractLengthYears)
  const annualAmortisation = Math.floor(transferFee / amortYears)
  const schedule: AmortisationEntry[] = []

  const [startYearStr] = startSeason.split('-')
  const startYear = parseInt(startYearStr ?? '2026', 10)

  let remainingValue = transferFee
  const fullYears = Math.floor(amortYears)
  const partialYear = amortYears - fullYears

  for (let i = 0; i < fullYears; i++) {
    const seasonStart = startYear + i
    const seasonEnd = (seasonStart + 1).toString().slice(-2)
    const season = `${seasonStart}-${seasonEnd}`
    remainingValue -= annualAmortisation
    schedule.push({
      season,
      amortisationAmount: annualAmortisation,
      remainingBookValue: Math.max(0, remainingValue),
    })
  }

  // Handle partial year (e.g. 3.5 year contract)
  if (partialYear > 0.01) {
    const partialAmount = Math.floor(transferFee * partialYear / amortYears)
    const seasonStart = startYear + fullYears
    const seasonEnd = (seasonStart + 1).toString().slice(-2)
    const season = `${seasonStart}-${seasonEnd}`
    remainingValue -= partialAmount
    schedule.push({
      season,
      amortisationAmount: partialAmount,
      remainingBookValue: Math.max(0, remainingValue),
    })
  }

  return schedule
}
