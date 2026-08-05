/**
 * Canonical server-side roster cost derivation.
 *
 * Server consumers load the same active, tenant-scoped records here and pass
 * them to the calculation engine. This avoids parallel interpretations of
 * wages, fee amortisation, carried values, and head-coach costs.
 */

import { calculateSquadCosts, resolveContractPhases, type ContractInput, type ManagerCostInput } from '@85percent/engine'
import { supabase } from '../lib/supabase'
import { resolvePlayerContract, type ContractRow, type RegistrationAssetRow } from './player-registration'

export interface DerivedRosterSquadCosts {
  totalPence: number
  playerContractCount: number
  headCoachIncluded: boolean
}

async function activeHeadCoachCost(clubId: string, asOf: Date): Promise<ManagerCostInput | null> {
  const { data: manager, error: managerError } = await supabase
    .from('managers')
    .select('id')
    .eq('club_id', clubId)
    .eq('is_active', true)
    .maybeSingle()
  if (managerError) throw managerError
  if (!manager) return null

  const { data: contracts, error: contractError } = await supabase
    .from('manager_contracts')
    .select('id, compensation_fee, annual_wage, agent_fee, contract_length_years, start_date, end_date')
    .eq('club_id', clubId)
    .eq('manager_id', manager.id)
  if (contractError) throw contractError
  const activeId = resolveContractPhases((contracts ?? []).map((contract) => ({
    id: String(contract.id),
    startDate: String(contract.start_date).slice(0, 10),
    endDate: String(contract.end_date).slice(0, 10),
    annualWagePence: Number(contract.annual_wage),
    agentFeePence: Number(contract.agent_fee),
  })), asOf).find((phase) => phase.status === 'ACTIVE')?.id
  const contract = (contracts ?? []).find((candidate) => String(candidate.id) === activeId)
  if (!contract) return null

  return {
    managerId: String(manager.id),
    compensationFeePence: Number(contract.compensation_fee),
    annualWagePence: Number(contract.annual_wage),
    agentFeePence: Number(contract.agent_fee),
    contractLengthYears: Number(contract.contract_length_years),
  }
}

export async function deriveRosterSquadCosts(
  clubId: string,
  asOfDate: Date,
): Promise<DerivedRosterSquadCosts> {
  const { data: contracts, error } = await supabase
    .from('contracts')
    .select('id, player_id, transfer_fee, carried_book_value, annual_wage, agent_fee, start_date, end_date, contract_length_years, is_active, phase_type, amortisation_treatment, extension_signed_date')
    .eq('club_id', clubId)
    .eq('is_active', true)
  if (error) throw error

  const playerIds = [...new Set((contracts ?? []).map((contract) => String(contract.player_id)))]
  const { data: assets, error: assetsError } = playerIds.length === 0
    ? { data: [], error: null }
    : await supabase
      .from('player_registration_assets')
      .select('player_id, acquisition_fee, acquisition_agent_fee, acquisition_date, carrying_value')
      .eq('club_id', clubId)
      .in('player_id', playerIds)
  if (assetsError) throw assetsError

  const rowsByPlayer = new Map<string, ContractRow[]>()
  for (const contract of contracts ?? []) {
    const row = contract as ContractRow
    const rows = rowsByPlayer.get(row.player_id) ?? []
    rows.push(row)
    rowsByPlayer.set(row.player_id, rows)
  }
  const assetsByPlayer = new Map((assets ?? []).map((asset) => [String(asset.player_id), asset as RegistrationAssetRow]))
  const playerContracts: ContractInput[] = [...rowsByPlayer.entries()].flatMap(([playerId, rows]) => {
    const current = resolvePlayerContract(rows, assetsByPlayer.get(playerId), asOfDate)
    return current ? [{
      playerId,
      transferFeePence: current.transferFeePence,
      carriedBookValuePence: current.carriedBookValuePence,
      annualWagePence: Number(current.row.annual_wage),
      agentFeePence: Number(current.row.agent_fee),
      contractLengthYears: Number(current.row.contract_length_years),
      annualAmortisationOverridePence: current.annualAmortisationPence,
      annualisedAgentFeeOverridePence: current.annualisedAgentFeePence,
    }] : []
  })
  const manager = await activeHeadCoachCost(clubId, asOfDate)
  const { totalSquadCostsPence } = calculateSquadCosts(playerContracts, manager)

  return {
    totalPence: totalSquadCostsPence,
    playerContractCount: playerContracts.length,
    headCoachIncluded: manager != null,
  }
}
