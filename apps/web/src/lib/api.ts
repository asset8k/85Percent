import { supabase } from './supabase'
import type {
  PlayerWithContract,
  RosterStagingRow,
  ManualPlayerInput,
  ContractPatchInput,
  ScenarioActionType,
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

// ---------------------------------------------------------------------------
// Response shapes
// ---------------------------------------------------------------------------

export interface ClubFinancialsResponse {
  id: string
  clubId: string
  season: string
  footballRelatedRevenue: number
  /** MVP 2.0: derived live from active contracts (no longer a stored aggregate). */
  currentSquadCosts: number
  /** Number of active contracts contributing to currentSquadCosts. */
  contractCount: number
  currentAllowanceRatio: number
  ownerEquityUsed1yr: number | null
  ownerEquityUsed3yr: number | null
}

export interface ScenarioActionPayload {
  // Server-side payload is a free object — we narrow at the engine layer.
  [key: string]: unknown
}

export interface ScenarioAction {
  id: string
  scenarioId: string
  actionType: ScenarioActionType
  payload: ScenarioActionPayload
  playerId: string | null
  orderIndex: number
  createdAt: string
}

export interface ScenarioSummary {
  id: string
  clubId: string
  createdBy: string
  season: string
  name: string
  isIncluded: boolean
  createdAt: string
  updatedAt: string
  user?: { fullName: string; email: string }
  actionCount?: number
}

export interface ScenarioDetail extends ScenarioSummary {
  actions: ScenarioAction[]
}

export interface ScenarioListResponse {
  scenarios: ScenarioSummary[]
  total: number
  page: number
  limit: number
}

export interface CreateScenarioPayload {
  name: string
  season?: string
  isIncluded?: boolean
  actions: Array<{
    actionType: ScenarioActionType
    payload: ScenarioActionPayload
    playerId?: string | null
  }>
}

// ---------------------------------------------------------------------------
export const api = {
  club: {
    get: () => apiFetch<{ id: string; name: string; shortName: string; leagueId: string }>('/club'),
    getFinancials: (season?: string) =>
      apiFetch<ClubFinancialsResponse>(`/club/financials${season ? `?season=${season}` : ''}`),
    updateFinancials: (data: {
      season: string
      footballRelatedRevenuePounds: number
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
  scenarios: {
    create: (payload: CreateScenarioPayload) =>
      apiFetch<{ id: string; name: string; isIncluded: boolean; actionCount: number }>('/scenarios', {
        method: 'POST',
        body: JSON.stringify(payload),
      }),
    list: (page = 1, limit = 50) =>
      apiFetch<ScenarioListResponse>(`/scenarios?page=${page}&limit=${limit}`),
    get: (id: string) => apiFetch<ScenarioDetail>(`/scenarios/${id}`),
    update: (id: string, patch: { name?: string; isIncluded?: boolean }) =>
      apiFetch<{ success: boolean; name?: string; isIncluded?: boolean }>(`/scenarios/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),
    delete: (id: string) =>
      apiFetch<{ success: boolean }>(`/scenarios/${id}`, { method: 'DELETE' }),
  },
}
