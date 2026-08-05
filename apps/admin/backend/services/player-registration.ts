import {
  calculateRegistrationCost,
  type AmortisationTreatment,
  type ContractPhaseInput,
  type RegistrationAssetInput,
} from '@85percent/engine'

export interface ContractRow {
  id: string
  player_id: string
  transfer_fee: number | string
  carried_book_value: number | string | null
  annual_wage: number | string
  agent_fee: number | string
  start_date: string
  end_date: string
  contract_length_years: number | string
  is_active: boolean
  phase_type: string
  amortisation_treatment?: string | null
  extension_signed_date?: string | null
  superseded_at?: string | null
  created_at?: string
}

export interface RegistrationAssetRow {
  player_id: string
  acquisition_fee: number | string
  acquisition_agent_fee: number | string
  acquisition_date: string
  carrying_value: number | string | null
}

export interface ResolvedPlayerContract {
  row: ContractRow
  transferFeePence: number
  acquisitionAgentFeePence: number
  acquisitionDate: string
  carriedBookValuePence: number | null
  accountingBasis: 'ACQUISITION_COST' | 'CURRENT_BOOK_VALUE'
  bookValuePence: number
  annualAmortisationPence: number
  annualisedAgentFeePence: number
  totalAnnualCostPence: number
  phaseStatus: 'ACTIVE' | 'SCHEDULED' | 'COMPLETED' | 'ARCHIVED'
  hasRegistrationAsset: boolean
}

function toPhase(row: ContractRow): ContractPhaseInput {
  return {
    id: row.id,
    startDate: String(row.start_date).slice(0, 10),
    endDate: String(row.end_date).slice(0, 10),
    annualWagePence: Number(row.annual_wage),
    agentFeePence: Number(row.agent_fee),
    isArchived: row.is_active === false,
    amortisationTreatment: row.amortisation_treatment === 'SPREAD_REMAINING_BOOK_VALUE'
      ? 'SPREAD_REMAINING_BOOK_VALUE'
      : 'CONTINUE_CURRENT_SCHEDULE',
    extensionSignedDate: row.extension_signed_date == null
      ? null
      : String(row.extension_signed_date).slice(0, 10),
  }
}

/** Resolves the current phase and registration cost for one player at read time. */
export function resolvePlayerContract(
  rows: ContractRow[],
  asset: RegistrationAssetRow | null | undefined,
  asOfDate: Date,
): ResolvedPlayerContract | null {
  const phases = rows.map(toPhase)
  const fallback = [...rows].sort((a, b) => String(a.start_date).localeCompare(String(b.start_date)))[0]
  if (!fallback) return null

  const registrationAsset: RegistrationAssetInput = asset
    ? {
        acquisitionFeePence: Number(asset.acquisition_fee),
        acquisitionAgentFeePence: Number(asset.acquisition_agent_fee),
        acquisitionDate: String(asset.acquisition_date).slice(0, 10),
        carryingValuePence: asset.carrying_value == null ? null : Number(asset.carrying_value),
      }
    : {
        acquisitionFeePence: Number(fallback.transfer_fee),
        acquisitionAgentFeePence: Number(fallback.agent_fee),
        acquisitionDate: String(fallback.start_date).slice(0, 10),
        carryingValuePence: fallback.carried_book_value == null ? null : Number(fallback.carried_book_value),
      }

  const result = calculateRegistrationCost(registrationAsset, phases, asOfDate)
  if (!result.activePhase) return null
  const row = rows.find((candidate) => candidate.id === result.activePhase!.id)
  if (!row) return null
  const hasRegistrationAsset =
    registrationAsset.acquisitionFeePence > 0 ||
    registrationAsset.acquisitionAgentFeePence > 0 ||
    registrationAsset.carryingValuePence != null

  return {
    row,
    transferFeePence: registrationAsset.acquisitionFeePence,
    acquisitionAgentFeePence: registrationAsset.acquisitionAgentFeePence,
    acquisitionDate: registrationAsset.acquisitionDate,
    // Preserve the imported source separately from the calculated live book
    // value. Conflating them let the edit form overwrite an acquisition asset
    // merely by rendering it.
    carriedBookValuePence: registrationAsset.carryingValuePence ?? null,
    accountingBasis: registrationAsset.carryingValuePence != null
      ? 'CURRENT_BOOK_VALUE'
      : 'ACQUISITION_COST',
    bookValuePence: result.carryingValuePence,
    annualAmortisationPence: result.annualAmortisationPence,
    annualisedAgentFeePence: result.annualisedAgentFeePence,
    totalAnnualCostPence: result.totalAnnualCostPence,
    phaseStatus: result.activePhase.status,
    hasRegistrationAsset,
  }
}

export function phaseStatusForRow(row: ContractRow, rows: ContractRow[], asOfDate: Date) {
  const asset: RegistrationAssetInput = {
    acquisitionFeePence: 0,
    acquisitionAgentFeePence: 0,
    acquisitionDate: String(row.start_date).slice(0, 10),
  }
  return calculateRegistrationCost(asset, rows.map(toPhase), asOfDate).phases.find((phase) => phase.id === row.id)?.status ?? 'ARCHIVED'
}

export function treatmentForRow(row: ContractRow): AmortisationTreatment {
  return row.amortisation_treatment === 'SPREAD_REMAINING_BOOK_VALUE'
    ? 'SPREAD_REMAINING_BOOK_VALUE'
    : 'CONTINUE_CURRENT_SCHEDULE'
}
