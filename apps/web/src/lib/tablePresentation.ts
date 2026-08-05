import type { TFunction } from 'i18next'

/** Shared language for operational roster data and dashboard analysis. */
export const TABLE_COLUMN_LABELS = {
  squadNumber: '#',
  name: 'Name',
  position: 'Position',
  weeklyWage: 'Weekly wage',
  annualWage: 'Annual wage',
  amortisation: 'Amortisation',
  agentFees: 'Agent fees',
  annualCost: 'Annual cost',
  contractEnd: 'Contract end',
  timeLeft: 'Time left',
} as const

export function formatSquadNumber(squadNumber: number | null | undefined): string {
  return squadNumber == null ? '—' : String(squadNumber)
}

export function formatTableMoney(pence: number, format: (value: number) => string): string {
  return format(pence)
}

export function formatTimeLeft(months: number, t: TFunction): string {
  const years = Math.floor(months / 12)
  const remainingMonths = months % 12
  if (years === 0) return t('dashboard.expiry.months', { count: remainingMonths })
  const yearsLabel = t('dashboard.expiry.years', { count: years })
  if (remainingMonths === 0) return yearsLabel
  return `${yearsLabel} ${t('dashboard.expiry.months', { count: remainingMonths })}`
}
