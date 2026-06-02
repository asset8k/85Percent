import { supabase } from './supabase'
import { useProgress } from '@/components/ui/progress-bar'
import type {
  PlayerWithContract,
  RosterStagingRow,
  ManualPlayerInput,
  ContractPatchInput,
  ScenarioActionType,
  ManagerWithContract,
  ManagerInput,
  ManagerContractInput,
  ExtendContractInput,
  PhasePatchInput,
  ContractPhase,
  Currency,
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

// Public (unauthenticated) POST — login, 2FA, and password-recovery endpoints
// run before a session exists, so they skip the Bearer-token path entirely.
async function publicPost<T>(path: string, body: unknown): Promise<T> {
  const { start, done } = useProgress.getState()
  start()
  try {
    const res = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }))
      throw new Error((err as { error?: string }).error ?? `API error ${res.status}`)
    }
    return (await res.json()) as T
  } finally {
    done()
  }
}

// ---------------------------------------------------------------------------
// Response shapes
// ---------------------------------------------------------------------------

export interface SessionTokens {
  access_token: string
  refresh_token: string
  expires_at: number | null
  expires_in: number
}

export interface LoginResponse {
  requires_2fa: boolean
  session?: SessionTokens
}

export interface TotpSetupResponse {
  secret: string
  otpauthUri: string
  qrDataUrl: string
}

export type NotificationType = 'INFO' | 'WARNING' | 'CRITICAL'

export interface NotificationItem {
  id: string
  title: string
  message: string
  type: NotificationType
  isRead: boolean
  isClubWide: boolean
  createdAt: string
}

export interface NotificationsResponse {
  notifications: NotificationItem[]
  unreadCount: number
}

export interface LeagueTableRow {
  position: number
  team: string
  shortName: string
  crest: string | null
  played: number
  won: number
  drawn: number
  lost: number
  goalsFor: number
  goalsAgainst: number
  goalDifference: number
  points: number
}

export interface LeagueTableResponse {
  leagueId: 'premier-league' | 'efl-championship'
  competition: string
  season: string
  source: 'live' | 'fallback'
  fetchedAt: string
  standings: LeagueTableRow[]
}

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

export type InviteStatus = 'pending' | 'accepted' | 'expired'

/** The three explicit permission grants (MVP 2.1). */
export interface Permissions {
  canEditRoster: boolean
  canEditScenarios: boolean
  isWorkspaceAdmin: boolean
}

export interface InviteRow extends Permissions {
  id: string
  clubId: string
  email: string
  title: string | null
  invitedBy: string
  expiresAt: string
  acceptedAt: string | null
  createdAt: string
  status?: InviteStatus
  token?: string  // present only on freshly-created or actively-pending rows
}

export interface InviteLookupResponse extends Permissions {
  email: string
  title: string | null
  clubName: string
  expiresAt: string
}

export interface TeamMember extends Permissions {
  id: string
  email: string
  fullName: string
  title: string | null
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

// ---- Onboarding (template-driven roster pre-fill) -------------------------

export interface OnboardingClub {
  id: string
  name: string
  leagueId: 'premier-league' | 'efl-championship'
  logoUrl: string | null
}

export interface OnboardingCompleteResponse {
  playersCreated: number
  managerCreated: boolean
  club: {
    name: string
    leagueId: 'premier-league' | 'efl-championship'
    logoUrl: string | null
    baseCurrency: Currency
  }
}

// ---------------------------------------------------------------------------
export const api = {
  me: {
    get: () =>
      apiFetch<{
        id: string
        title: string | null
        canEditRoster: boolean
        canEditScenarios: boolean
        isWorkspaceAdmin: boolean
        fullName: string
        email: string
        isTotpEnabled: boolean
      }>('/me'),
    update: (patch: { fullName?: string; email?: string }) =>
      apiFetch<{ success: boolean }>('/me', { method: 'PATCH', body: JSON.stringify(patch) }),
  },
  auth: {
    // Public — run before a session exists.
    login: (email: string, password: string) =>
      publicPost<LoginResponse>('/auth/login', { email, password }),
    verify2fa: (email: string, password: string, code: string) =>
      publicPost<{ session: SessionTokens }>('/auth/verify-2fa', { email, password, code }),
    forgotPassword: (email: string) =>
      publicPost<{ success: boolean }>('/auth/forgot-password', { email }),
    resetPassword: (token: string, password: string) =>
      publicPost<{ success: boolean }>('/auth/reset-password', { token, password }),
    // Authenticated — TOTP management + password change from Settings.
    totpSetup: () => apiFetch<TotpSetupResponse>('/auth/totp/setup', { method: 'POST' }),
    totpVerify: (code: string) =>
      apiFetch<{ success: boolean; enabled: boolean }>('/auth/totp/verify', {
        method: 'POST',
        body: JSON.stringify({ code }),
      }),
    totpDisable: (code: string) =>
      apiFetch<{ success: boolean; enabled: boolean }>('/auth/totp/disable', {
        method: 'POST',
        body: JSON.stringify({ code }),
      }),
    changePassword: (currentPassword: string, newPassword: string) =>
      apiFetch<{ success: boolean }>('/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword, newPassword }),
      }),
  },
  notifications: {
    list: () => apiFetch<NotificationsResponse>('/notifications'),
    markRead: (id: string) =>
      apiFetch<{ success: boolean }>(`/notifications/${id}/read`, { method: 'PATCH' }),
    markAllRead: () =>
      apiFetch<{ success: boolean }>('/notifications/read-all', { method: 'PATCH' }),
    // Event-driven derivation: scans roster + financials for the given season
    // and raises any standing alerts not already live. Returns how many it made.
    refresh: (season?: string) =>
      apiFetch<{ created: number }>('/notifications/refresh', {
        method: 'POST',
        body: JSON.stringify(season ? { season } : {}),
      }),
  },
  club: {
    get: () =>
      apiFetch<{
        id: string
        name: string
        shortName: string
        leagueId: string
        logoUrl: string | null
        baseCurrency: Currency
      }>('/club'),
    deleteOrganization: (confirmName: string) =>
      apiFetch<{ success: boolean }>('/club', {
        method: 'DELETE',
        body: JSON.stringify({ confirmName }),
      }),
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
      apiFetch<{ success: boolean; leagueId: string; baseCurrency: Currency }>('/club/league', {
        method: 'PATCH',
        body: JSON.stringify({ leagueId }),
      }),
    setCurrency: (baseCurrency: Currency) =>
      apiFetch<{ success: boolean; baseCurrency: Currency }>('/club/currency', {
        method: 'PATCH',
        body: JSON.stringify({ baseCurrency }),
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
    commit: (rows: NonNullable<RosterStagingRow['parsed']>[], mode: 'append' | 'replace' = 'append') =>
      apiFetch<{ playersCreated: number; contractsCreated: number }>('/roster/commit', {
        method: 'POST',
        body: JSON.stringify({ rows, mode }),
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
        squadNumber?: number | null
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
    // Full contract ledger (all phases) for a player.
    playerPhases: (id: string) =>
      apiFetch<{ phases: ContractPhase[] }>(`/roster/player/${id}/phases`),
    // Log a contract extension — supersedes the current phase, carries book value.
    extendPlayer: (id: string, input: ExtendContractInput) =>
      apiFetch<{ contractId: string; carriedBookValuePence: number; bookValuePence: number }>(
        `/roster/player/${id}/extend`,
        { method: 'POST', body: JSON.stringify(input) }
      ),
    // Delete a single contract phase (archived, or current → promotes the prior phase).
    deleteContract: (id: string) =>
      apiFetch<{ success: boolean; promotedContractId: string | null }>(`/roster/contract/${id}`, {
        method: 'DELETE',
      }),

    // ---- Manager (Head Coach) ----
    getManager: () => apiFetch<{ manager: ManagerWithContract | null }>('/roster/manager'),
    createManager: (input: ManagerInput) =>
      apiFetch<{ managerId: string; contractId: string }>('/roster/manager', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    updateManager: (id: string, patch: { name?: string; nationality?: string | null; isActive?: boolean }) =>
      apiFetch<{ success: boolean }>(`/roster/manager/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),
    updateManagerContract: (id: string, patch: PhasePatchInput) =>
      apiFetch<{ success: boolean; bookValuePence: number }>(`/roster/manager-contract/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),
    // Seed the first contract for an existing contract-less manager (e.g. a
    // template-imported coach Transfermarkt had no contract data for).
    createManagerContract: (managerId: string, input: ManagerContractInput) =>
      apiFetch<{ contractId: string; bookValuePence: number }>(`/roster/manager/${managerId}/contract`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    extendManager: (id: string, input: ExtendContractInput) =>
      apiFetch<{ contractId: string; carriedBookValuePence: number; bookValuePence: number }>(
        `/roster/manager/${id}/extend`,
        { method: 'POST', body: JSON.stringify(input) }
      ),
    deleteManagerContract: (id: string) =>
      apiFetch<{ success: boolean; promotedContractId: string | null }>(`/roster/manager-contract/${id}`, {
        method: 'DELETE',
      }),
  },
  onboarding: {
    // Searchable template club list for the wizard, filtered by league_id.
    clubs: (leagueId?: 'premier-league' | 'efl-championship') =>
      apiFetch<{ clubs: OnboardingClub[] }>(
        '/onboarding/clubs' + (leagueId ? `?league=${leagueId}` : ''),
      ),
    // Clone the chosen template into the caller's active roster + adopt identity.
    // `replace` wipes the existing roster first (used to change clubs).
    complete: (templateClubId: string, replace = false) =>
      apiFetch<OnboardingCompleteResponse>('/onboarding/complete', {
        method: 'POST',
        body: JSON.stringify({ templateClubId, replace }),
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
    create: (input: { email: string; title?: string | null } & Permissions) =>
      apiFetch<{ id: string; email: string; title: string | null; token: string; expiresAt: string } & Permissions>('/invites', {
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
    update: (id: string, patch: Partial<{ title: string | null } & Permissions>) =>
      apiFetch<{ success: boolean; title: string | null } & Permissions>(`/team/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),
    revoke: (id: string) =>
      apiFetch<{ success: boolean }>(`/team/${id}`, { method: 'DELETE' }),
  },
  leagueTable: {
    // Live real-world standings for the caller's league (PL or Championship),
    // proxied through our API. Falls back to a bundled snapshot server-side, so
    // this resolves even when the upstream sports API is down.
    get: () => apiFetch<LeagueTableResponse>('/league-table'),
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
