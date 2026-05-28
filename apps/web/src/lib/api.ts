import { supabase } from './supabase'
import { useProgress } from '@/components/ui/progress-bar'
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

// Every API call ticks the global progress bar via a reference counter so the
// top sweep stays visible across overlapping fetches (e.g. roster + scenarios
// + financials all firing on page load) and only disappears when the last one
// resolves. start/done are paired in try/finally so errors still decrement.
async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const { start, done } = useProgress.getState()
  start()
  try {
    const token = await getAuthToken()
    const headers: HeadersInit = { Authorization: `Bearer ${token}` }
    if (init?.body != null) headers['Content-Type'] = 'application/json'
    const res = await fetch(`${BASE}${path}`, { ...init, headers: { ...headers, ...init?.headers } })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }))
      throw new Error((err as { error: string }).error ?? `API error ${res.status}`)
    }
    return (await res.json()) as T
  } finally {
    done()
  }
}

// ---------------------------------------------------------------------------
// Response shapes
// ---------------------------------------------------------------------------

export interface ClubFinancialsResponse {
  id: string
  clubId: string
  season: string
  footballRelatedRevenue: number
  /**
   * Effective squad costs used in all SCR math. Equals `derivedSquadCosts`
   * when `squadCostsMode === 'derived'` and `manualSquadCosts` when `'manual'`.
   */
  currentSquadCosts: number
  /** Number of active contracts contributing to the derived sum. */
  contractCount: number
  /** Source of currentSquadCosts. */
  squadCostsMode: 'derived' | 'manual'
  /** Live sum from active contracts — always present, regardless of mode. */
  derivedSquadCosts: number
  /** Persisted manual override value in pence. Null until the user sets one. */
  manualSquadCosts: number | null
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

// ---- SSR (Premier League only) -------------------------------------------

export interface WorkingCapitalRow {
  id: string
  yearMonth: string
  adjustedCashflowPence: number
  qualifyingFundsPence: number
  updatedAt: string
}
export interface WorkingCapitalMonthEval {
  yearMonth?: string
  monthlyHeadroomPence: number
  passing: boolean
}
export interface WorkingCapitalEvaluation {
  months: WorkingCapitalMonthEval[]
  failingMonthCount: number
  passing: boolean
  worstHeadroomPence: number
}
export interface WorkingCapitalResponse {
  season: string
  rows: WorkingCapitalRow[]
  evaluation: WorkingCapitalEvaluation
}

export interface LiquidityRow {
  id: string
  liquidAssetsPence: number
  liquidLiabilitiesPence: number
  squadMarketValuePence: number
  updatedAt: string
}
export interface LiquidityEvaluation {
  liquidityHeadroomPence: number
  passing: boolean
  effectiveLiquidAssetsPence: number
}
export interface LiquidityResponse {
  season: string
  row: LiquidityRow | null
  evaluation: LiquidityEvaluation | null
}

export interface EquityRow {
  id: string
  totalLiabilitiesPence: number
  adjustedAssetsPence: number
  updatedAt: string
}
export interface EquityEvaluation {
  ratio: number
  threshold: number
  passing: boolean
  marginPp: number
}
export interface EquityResponse {
  season: string
  row: EquityRow | null
  evaluation: EquityEvaluation | null
}

// ---- Invites + Team (Phase 5) ---------------------------------------------

export type InviteRole = 'cfo' | 'sporting_director' | 'finance_analyst'
export type InviteStatus = 'pending' | 'accepted' | 'expired'

export interface InviteRow {
  id: string
  clubId: string
  email: string
  role: InviteRole
  invitedBy: string
  expiresAt: string
  acceptedAt: string | null
  createdAt: string
  status?: InviteStatus
  token?: string  // present only on freshly-created or actively-pending rows
}

export interface InviteLookupResponse {
  email: string
  role: InviteRole
  clubName: string
  expiresAt: string
}

export interface TeamMember {
  id: string
  email: string
  fullName: string
  role: string
  createdAt: string
}

// ---- Audit log -------------------------------------------------------------

export interface AuditEntry {
  id: string
  userId: string
  tableName: string
  recordId: string
  action: 'create' | 'update' | 'delete'
  previousValue: unknown
  newValue: unknown
  createdAt: string
  user: { fullName: string; email: string } | null
}

export interface AuditListResponse {
  entries: AuditEntry[]
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
  me: {
    get: () => apiFetch<{ id: string; role: string; fullName: string; email: string }>('/me'),
  },
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
      squadCostsMode?: 'derived' | 'manual'
      manualSquadCostsPounds?: number
    }) =>
      apiFetch<{ success: boolean; id: string }>('/club/financials', {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    getLeagueConfig: () => apiFetch<Record<string, unknown>>('/club/league-config'),
    setLeague: (leagueId: 'efl-championship' | 'premier-league') =>
      apiFetch<{ success: boolean; leagueId: string }>('/club/league', {
        method: 'PATCH',
        body: JSON.stringify({ leagueId }),
      }),
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
    updatePlayer: (
      id: string,
      patch: {
        name?: string
        position?: 'GK' | 'DEF' | 'MID' | 'FWD'
        nationality?: string | null
        dateOfBirth?: string | null
      }
    ) =>
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
    restorePlayer: (id: string) =>
      apiFetch<{ success: boolean; reactivatedContractId: string | null }>(
        `/roster/player/${id}/restore`,
        { method: 'POST' }
      ),
    deletePlayer: (id: string) =>
      apiFetch<{ success: boolean }>(`/roster/player/${id}`, {
        method: 'DELETE',
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
  ssr: {
    getWorkingCapital: (season = '2026-27') =>
      apiFetch<WorkingCapitalResponse>(`/ssr/working-capital?season=${season}`),
    putWorkingCapital: (input: {
      season: string
      yearMonth: string
      adjustedCashflowPence: number
      qualifyingFundsPence: number
    }) =>
      apiFetch<{ success: boolean; id: string }>('/ssr/working-capital', {
        method: 'PUT',
        body: JSON.stringify(input),
      }),
    getLiquidity: (season = '2026-27') =>
      apiFetch<LiquidityResponse>(`/ssr/liquidity?season=${season}`),
    putLiquidity: (input: {
      season: string
      liquidAssetsPence: number
      liquidLiabilitiesPence: number
      squadMarketValuePence: number
    }) =>
      apiFetch<{ success: boolean; id: string }>('/ssr/liquidity', {
        method: 'PUT',
        body: JSON.stringify(input),
      }),
    getEquity: (season = '2026-27') =>
      apiFetch<EquityResponse>(`/ssr/equity?season=${season}`),
    putEquity: (input: {
      season: string
      totalLiabilitiesPence: number
      adjustedAssetsPence: number
    }) =>
      apiFetch<{ success: boolean; id: string }>('/ssr/equity', {
        method: 'PUT',
        body: JSON.stringify(input),
      }),
  },
  invites: {
    list: () => apiFetch<{ invites: InviteRow[] }>('/invites'),
    create: (input: { email: string; role: InviteRole }) =>
      apiFetch<{ id: string; email: string; role: InviteRole; token: string; expiresAt: string }>('/invites', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    revoke: (id: string) =>
      apiFetch<{ success: boolean }>(`/invites/${id}`, { method: 'DELETE' }),
    /** Public lookup — does NOT require auth. Used during signup. */
    lookup: async (token: string): Promise<InviteLookupResponse> => {
      const res = await fetch(`/api/invites/lookup?token=${encodeURIComponent(token)}`)
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: res.statusText }))
        throw new Error((body as { error?: string }).error ?? `Invite lookup failed: ${res.status}`)
      }
      return res.json()
    },
  },
  team: {
    list: () => apiFetch<{ members: TeamMember[] }>('/team'),
  },
  audit: {
    list: (params: {
      page?: number
      limit?: number
      from?: string
      to?: string
      user?: string
      table?: string
    } = {}) => {
      const q = new URLSearchParams()
      if (params.page  != null) q.set('page',  String(params.page))
      if (params.limit != null) q.set('limit', String(params.limit))
      if (params.from)          q.set('from',  params.from)
      if (params.to)            q.set('to',    params.to)
      if (params.user)          q.set('user',  params.user)
      if (params.table)         q.set('table', params.table)
      const qs = q.toString()
      return apiFetch<AuditListResponse>('/audit' + (qs ? '?' + qs : ''))
    },
  },
}
