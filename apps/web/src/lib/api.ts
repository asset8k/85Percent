import { supabase } from './supabase'
import type {
  SCRResult,
  PlayerWithContract,
  RosterStagingRow,
  ManualPlayerInput,
  ContractPatchInput,
} from '@headroom/shared'

const BASE = '/api'

async function getAuthToken(): Promise<string> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  if (!token) throw new Error('Not authenticated')
  return token
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await getAuthToken()
  const headers: HeadersInit = { Authorization: `Bearer ${token}` }
  if (init?.body != null) headers['Content-Type'] = 'application/json'
  const res = await fetch(`${BASE}${path}`, { ...init, headers: { ...headers, ...init?.headers } })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error((err as { error: string }).error ?? `API error ${res.status}`)
  }
  return res.json() as Promise<T>
}

export interface ClubFinancialsResponse {
  id: string
  clubId: string
  season: string
  footballRelatedRevenue: number
  currentSquadCosts: number
  currentAllowanceRatio: number
  ownerEquityUsed1yr: number | null
  ownerEquityUsed3yr: number | null
}

export interface SimulationResponse {
  id: string
  clubId: string
  createdBy: string
  season: string
  label: string | null
  transferInput: unknown
  isIncluded: boolean
  createdAt: string
  user?: { fullName: string; email: string }
}

export interface SimulationListResponse {
  simulations: SimulationResponse[]
  total: number
  page: number
  limit: number
}

export interface CreateSimulationPayload {
  transactionType: 'buy' | 'sell' | 'loan_in' | 'loan_out'
  season?: string
  label?: string
  baselineSquadCostsPence?: number
  baselineRevenuePence?: number

  // BUY & LOAN_IN
  transferFee?: number
  contractLengthYears?: number
  annualWage?: number
  agentFee?: number

  // SELL
  saleProceeds?: number
  playerBookValue?: number
  annualWageRelief?: number
  annualAmortisationRelief?: number

  // LOAN_OUT
  loanFeeReceived?: number
  loanLengthYears?: number
  annualWageCovered?: number
}

export const api = {
  club: {
    get: () => apiFetch<{ id: string; name: string; shortName: string; leagueId: string }>('/club'),
    getFinancials: (season?: string) =>
      apiFetch<ClubFinancialsResponse>(`/club/financials${season ? `?season=${season}` : ''}`),
    updateFinancials: (data: {
      season: string
      footballRelatedRevenuePounds: number
      currentSquadCostsPounds: number
      currentAllowanceRatio: number
      ownerEquityUsedCurrentSeasonPounds?: number
      ownerEquityUsedThreeYearPounds?: number
    }) =>
      apiFetch<{ success: boolean; id: string }>('/club/financials', {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    getLeagueConfig: () => apiFetch<Record<string, unknown>>('/club/league-config'),
  },
  simulations: {
    create: (payload: CreateSimulationPayload) =>
      apiFetch<{ id: string; scrResult: SCRResult; label: string; isIncluded: boolean }>('/simulations', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    list: (page = 1, limit = 20) =>
      apiFetch<SimulationListResponse>(`/simulations?page=${page}&limit=${limit}`),
    get: (id: string) => apiFetch<SimulationResponse>(`/simulations/${id}`),
    updateLabel: (id: string, label: string) =>
      apiFetch<{ success: boolean }>(`/simulations/${id}/label`, {
        method: 'PATCH',
        body: JSON.stringify({ label }),
      }),
    setInclusion: (id: string, isIncluded: boolean) =>
      apiFetch<{ success: boolean; isIncluded: boolean }>(`/simulations/${id}/inclusion`, {
        method: 'PATCH',
        body: JSON.stringify({ isIncluded }),
      }),
    delete: (id: string) =>
      apiFetch<{ success: boolean }>(`/simulations/${id}`, { method: 'DELETE' }),
  },
  roster: {
    list: () => apiFetch<{ players: PlayerWithContract[] }>('/roster'),
    listArchived: () => apiFetch<{ players: PlayerWithContract[] }>('/roster/archived'),
    parseCsv: (csvText: string) =>
      apiFetch<{
        rows: RosterStagingRow[]
        summary: { total: number; ok: number; error: number }
      }>('/roster/parse', {
        method: 'POST',
        body: JSON.stringify({ csvText }),
      }),
    commit: (rows: NonNullable<RosterStagingRow['parsed']>[]) =>
      apiFetch<{ playersCreated: number; contractsCreated: number }>('/roster/commit', {
        method: 'POST',
        body: JSON.stringify({ rows }),
      }),
    createPlayer: (input: ManualPlayerInput) =>
      apiFetch<{ playerId: string; contractId: string }>('/roster/player', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    updatePlayer: (id: string, patch: { name?: string; position?: 'GK' | 'DEF' | 'MID' | 'FWD'; nationality?: string | null }) =>
      apiFetch<{ success: boolean }>(`/roster/player/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),
    updateContract: (id: string, patch: ContractPatchInput) =>
      apiFetch<{ success: boolean; bookValuePence: number }>(`/roster/contract/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),
    archivePlayer: (id: string) =>
      apiFetch<{ success: boolean; archivedAt: string }>(`/roster/player/${id}/archive`, {
        method: 'POST',
      }),
  },
}
