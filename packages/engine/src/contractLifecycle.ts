import { AMORTISATION_CAP_YEARS } from './amortisation.js'

export type ContractPhaseStatus = 'ACTIVE' | 'SCHEDULED' | 'COMPLETED' | 'ARCHIVED'
export type AmortisationTreatment = 'CONTINUE_CURRENT_SCHEDULE' | 'SPREAD_REMAINING_BOOK_VALUE'

export interface RegistrationAssetInput {
  acquisitionFeePence: number
  /**
   * Directly attributable fees paid when the registration was acquired. They
   * are annualised alongside the initial contract phase, not added to the
   * registration principal.
   */
  acquisitionAgentFeePence: number
  acquisitionDate: string
  /** Known carrying value when the original acquisition cost is unavailable. */
  carryingValuePence?: number | null
}

export interface ContractPhaseInput {
  id: string
  startDate: string
  endDate: string
  annualWagePence: number
  agentFeePence: number
  isArchived?: boolean
  amortisationTreatment?: AmortisationTreatment | null
  /**
   * Date on which an extension was agreed. A re-spread uses the carrying
   * value at this date, while the phase's start date controls when its wage
   * becomes active.
   */
  extensionSignedDate?: string | null
}

export interface ResolvedContractPhase extends ContractPhaseInput {
  status: ContractPhaseStatus
}

export interface RegistrationCostResult {
  activePhase: ResolvedContractPhase | null
  phases: ResolvedContractPhase[]
  carryingValuePence: number
  annualAmortisationPence: number
  annualisedAgentFeePence: number
  totalAnnualCostPence: number
}

interface Schedule {
  principalPence: number
  startDate: Date
  endDate: Date
}

function date(value: string): Date {
  return new Date(`${value.slice(0, 10)}T00:00:00Z`)
}

function monthsBetween(from: Date, to: Date): number {
  return (to.getUTCFullYear() - from.getUTCFullYear()) * 12
    + to.getUTCMonth() - from.getUTCMonth()
}

/**
 * Contracts use inclusive end dates. A deal from 01 Jul to 30 Jun therefore
 * spans a full twelve months, even though a direct month subtraction returns
 * eleven. Keep that convention separate from point-in-time book-value maths,
 * which deliberately uses elapsed days.
 */
function contractMonths(start: Date, end: Date): number {
  const exclusiveEnd = new Date(end.getTime())
  exclusiveEnd.setUTCDate(exclusiveEnd.getUTCDate() + 1)
  return monthsBetween(start, exclusiveEnd)
}

function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000))
}

function cappedEnd(start: Date, end: Date): Date {
  const cap = new Date(Date.UTC(
    start.getUTCFullYear() + AMORTISATION_CAP_YEARS,
    start.getUTCMonth(),
    start.getUTCDate(),
  ))
  return cap.getTime() < end.getTime() ? cap : end
}

function remaining(schedule: Schedule, asOf: Date): number {
  const end = cappedEnd(schedule.startDate, schedule.endDate)
  const totalDays = daysBetween(schedule.startDate, end)
  if (schedule.principalPence <= 0 || totalDays <= 0) return 0
  if (asOf.getTime() <= schedule.startDate.getTime()) return schedule.principalPence
  if (asOf.getTime() >= end.getTime()) return 0
  // Carrying value is a point-in-time measure. Use elapsed calendar days so a
  // signing on 1 July has only one month of amortisation on 5 August, rather
  // than rounding the calculation to a reporting-period month or year.
  const remainingDays = daysBetween(asOf, end)
  return Math.floor(schedule.principalPence * (remainingDays / totalDays))
}

function annualCharge(schedule: Schedule, asOf: Date): number {
  const end = cappedEnd(schedule.startDate, schedule.endDate)
  if (asOf.getTime() >= end.getTime()) return 0
  const totalMonths = contractMonths(schedule.startDate, end)
  return totalMonths > 0 ? Math.floor(schedule.principalPence * 12 / totalMonths) : 0
}

/**
 * Resolves contract status from dates on every read. Stored flags only express
 * manual archival; no background worker is required to activate a renewal.
 */
export function resolveContractPhases(
  phases: ContractPhaseInput[],
  asOfDate: Date,
): ResolvedContractPhase[] {
  const sorted = [...phases].sort((a, b) => date(a.startDate).getTime() - date(b.startDate).getTime())
  let activeId: string | null = null
  for (const phase of sorted) {
    if (phase.isArchived) continue
    const start = date(phase.startDate)
    const end = date(phase.endDate)
    // A contract dated 30 June remains in force for that reporting date. The
    // next calendar day is the first date on which a succeeding phase can take
    // over or the contract becomes completed.
    if (start.getTime() <= asOfDate.getTime() && end.getTime() >= asOfDate.getTime()) activeId = phase.id
  }

  return sorted.map((phase) => {
    if (phase.isArchived) return { ...phase, status: 'ARCHIVED' }
    const start = date(phase.startDate)
    const end = date(phase.endDate)
    if (phase.id === activeId) return { ...phase, status: 'ACTIVE' }
    if (start.getTime() > asOfDate.getTime()) return { ...phase, status: 'SCHEDULED' }
    if (end.getTime() <= asOfDate.getTime() || activeId != null) return { ...phase, status: 'COMPLETED' }
    return { ...phase, status: 'SCHEDULED' }
  })
}

/**
 * Computes the registration asset independently from the currently applicable
 * wage phase. A renewal can optionally re-spread the carrying value at its
 * signed date; otherwise the original capped schedule continues unchanged.
 */
export function calculateRegistrationCost(
  asset: RegistrationAssetInput,
  phases: ContractPhaseInput[],
  asOfDate: Date,
): RegistrationCostResult {
  const resolved = resolveContractPhases(phases, asOfDate)
  const activePhase = resolved.find((phase) => phase.status === 'ACTIVE') ?? null
  const initial = [...phases].sort((a, b) => date(a.startDate).getTime() - date(b.startDate).getTime())[0]
  // The registration asset is independent from contractual fees. Treating the
  // acquisition agent fee as principal both obscures the accounting basis and
  // makes it easy to double count it when the initial phase also has an agent
  // fee. Carrying value is an explicit imported substitute only when the
  // original acquisition cost is unavailable.
  const principalPence = asset.carryingValuePence ?? asset.acquisitionFeePence
  let schedule: Schedule = {
    principalPence: Math.max(0, principalPence),
    startDate: date(asset.acquisitionDate),
    endDate: date(initial?.endDate ?? asset.acquisitionDate),
  }

  // A signed extension changes the registration schedule immediately, even
  // though its wage phase remains scheduled until the existing deal expires.
  // Resolve accounting decisions by their signed date, not wage start date.
  for (const phase of [...phases].sort((a, b) => {
    const aEffective = date(a.extensionSignedDate ?? a.startDate).getTime()
    const bEffective = date(b.extensionSignedDate ?? b.startDate).getTime()
    return aEffective - bEffective || date(a.startDate).getTime() - date(b.startDate).getTime()
  })) {
    const signedDate = date(phase.extensionSignedDate ?? phase.startDate)
    if (phase.isArchived || phase.id === initial?.id || signedDate.getTime() > asOfDate.getTime()) continue
    if (phase.amortisationTreatment === 'SPREAD_REMAINING_BOOK_VALUE') {
      schedule = {
        principalPence: remaining(schedule, signedDate),
        startDate: signedDate,
        endDate: date(phase.endDate),
      }
    }
  }

  const phaseAgentFee = activePhase
    ? activePhase.id === initial?.id
      ? Math.max(0, asset.acquisitionAgentFeePence || activePhase.agentFeePence)
      : Math.max(0, activePhase.agentFeePence)
    : 0
  const phaseMonths = activePhase
    ? contractMonths(date(activePhase.startDate), cappedEnd(date(activePhase.startDate), date(activePhase.endDate)))
    : 0
  const annualisedAgentFeePence = phaseMonths > 0 ? Math.floor(phaseAgentFee * 12 / phaseMonths) : 0
  const annualAmortisationPence = annualCharge(schedule, asOfDate)

  return {
    activePhase,
    phases: resolved,
    carryingValuePence: remaining(schedule, asOfDate),
    annualAmortisationPence,
    annualisedAgentFeePence,
    totalAnnualCostPence: (activePhase?.annualWagePence ?? 0) + annualAmortisationPence + annualisedAgentFeePence,
  }
}
