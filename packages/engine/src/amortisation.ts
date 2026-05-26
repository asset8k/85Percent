import type { AmortisationEntry } from '@headroom/shared'

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
