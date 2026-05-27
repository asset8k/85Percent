import type { AmortisationEntry } from '@headroom/shared'

// Whole-month count between two dates. Day-of-month ignored — straight-line
// amortisation for SCR uses month boundaries, not calendar-day precision.
// This means a transfer on Feb 29 (leap year) and one on Feb 28 (non-leap)
// produce identical schedules — what the regulations require.
function monthsBetween(from: Date, to: Date): number {
  return (to.getUTCFullYear() - from.getUTCFullYear()) * 12 +
         (to.getUTCMonth() - from.getUTCMonth())
}

/**
 * Current book value of a transfer fee, straight-line amortised over the
 * contract's full date range. Returns 0 once the contract is fully amortised
 * or the asOf date is at/past the end date. Returns the full fee if asOf is
 * before the start date (book value is locked in at purchase).
 *
 * All monetary values in pence. Pure function — pass asOf explicitly in tests.
 */
export function currentBookValuePence(
  transferFeePence: bigint | number,
  startDate: Date,
  endDate: Date,
  asOf: Date = new Date()
): number {
  const fee = typeof transferFeePence === 'bigint' ? Number(transferFeePence) : transferFeePence
  if (fee === 0) return 0

  const totalMonths = monthsBetween(startDate, endDate)
  if (totalMonths <= 0) return 0

  // Clamp asOf to [startDate, endDate]
  if (asOf.getTime() <= startDate.getTime()) return fee
  if (asOf.getTime() >= endDate.getTime())   return 0

  const remainingMonths = monthsBetween(asOf, endDate)
  return Math.floor(fee * (remainingMonths / totalMonths))
}

/**
 * Generate a year-by-year amortisation schedule for a transfer.
 * Transfer fee is spread equally over contract length.
 * All monetary values in pence.
 */
export function generateAmortisationSchedule(
  transferFee: number,
  contractLengthYears: number,
  startSeason: string
): AmortisationEntry[] {
  const annualAmortisation = Math.floor(transferFee / contractLengthYears)
  const schedule: AmortisationEntry[] = []

  const [startYearStr] = startSeason.split('-')
  const startYear = parseInt(startYearStr ?? '2026', 10)

  let remainingValue = transferFee
  const fullYears = Math.floor(contractLengthYears)
  const partialYear = contractLengthYears - fullYears

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
    const partialAmount = Math.floor(transferFee * partialYear / contractLengthYears)
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
