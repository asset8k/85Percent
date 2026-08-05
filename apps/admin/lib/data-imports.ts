import 'server-only'
import { getDataImportDatabase } from '@/backend/data-imports/target'
import { CURRENT_LEAGUE_SEASON } from '@/backend/lib/league-table-source'

export interface SyncClubRow {
  id: string
  name: string
  league: 'PREMIER_LEAGUE' | 'CHAMPIONSHIP'
  logoUrl: string | null
  playerCount: number
  headCoach: string | null
  externalClubId: string | null
  lastSuccessfulSync: string | null
  lastDurationMs: number | null
  lastStatus: string | null
  lastRunId: string | null
  reviewCount: number
  lastAddedCount: number
  lastUpdatedCount: number
  lastUnchangedCount: number
  lastMissingCount: number
  lastError: string | null
}

export interface LeagueStandingRow {
  position: number
  team: string
  played: number
  won: number
  drawn: number
  lost: number
  goalDifference: number
  points: number
}

export interface ImportRunSummary {
  id: string
  type: string
  status: string
  provider: string
  totalTasks: number
  completedTasks: number
  succeededTasks: number
  failedTasks: number
  progressPercent: number
  createdAt: string
  completedAt: string | null
}

export async function listSyncClubs(targetId?: string): Promise<SyncClubRow[]> {
  const db = getDataImportDatabase(targetId)
  const [{ data: clubs, error: clubError }, { data: mappings }, { data: lastTasks }] = await Promise.all([
    db.from('template_clubs')
      .select('id,name,league,logo_url,template_roster_items(name,is_manager)')
      .eq('is_active', true)
      .order('name'),
    db.from('external_source_mappings').select('internal_id,external_id').eq('provider', 'transfermarkt').eq('entity_type', 'CLUB'),
    db.from('data_import_tasks').select('template_club_id,import_run_id,status,completed_at,duration_ms,added_count,updated_count,unchanged_count,review_count,missing_count,safe_error_message').not('template_club_id', 'is', null).order('created_at', { ascending: false }),
  ])
  if (clubError) throw clubError
  const mappingByClub = new Map((mappings ?? []).map((row) => [String(row.internal_id), String(row.external_id)]))
  const lastByClub = new Map<string, {
    import_run_id?: string
    status?: string
    duration_ms?: number
    added_count?: number
    updated_count?: number
    unchanged_count?: number
    review_count?: number
    missing_count?: number
    safe_error_message?: string
  }>()
  const lastSuccessByClub = new Map<string, string>()
  for (const task of lastTasks ?? []) {
    const clubId = String(task.template_club_id)
    if (!lastByClub.has(clubId)) lastByClub.set(clubId, task)
    if (task.status === 'SUCCEEDED' && task.completed_at && !lastSuccessByClub.has(clubId)) {
      lastSuccessByClub.set(clubId, String(task.completed_at))
    }
  }
  return (clubs ?? []).map((club) => {
    const roster = (club.template_roster_items ?? []) as Array<{ name: string; is_manager: boolean }>
    const last = lastByClub.get(String(club.id))
    return {
      id: String(club.id), name: String(club.name), league: club.league as SyncClubRow['league'],
      logoUrl: club.logo_url == null ? null : String(club.logo_url),
      playerCount: roster.filter((item) => !item.is_manager).length,
      headCoach: roster.find((item) => item.is_manager)?.name ?? null,
      externalClubId: mappingByClub.get(String(club.id)) ?? null,
      lastSuccessfulSync: lastSuccessByClub.get(String(club.id)) ?? null,
      lastDurationMs: last?.duration_ms ?? null,
      lastStatus: last?.status ?? null,
      lastRunId: last?.import_run_id ?? null,
      reviewCount: last?.review_count ?? 0,
      lastAddedCount: last?.added_count ?? 0,
      lastUpdatedCount: last?.updated_count ?? 0,
      lastUnchangedCount: last?.unchanged_count ?? 0,
      lastMissingCount: last?.missing_count ?? 0,
      lastError: last?.safe_error_message ?? null,
    }
  })
}

export async function listImportRuns(limit = 30, targetId?: string): Promise<ImportRunSummary[]> {
  const { data, error } = await getDataImportDatabase(targetId).from('data_import_runs').select('*').order('created_at', { ascending: false }).limit(limit)
  if (error) throw error
  return (data ?? []).map((run) => ({
    id: String(run.id), type: String(run.type), status: String(run.status), provider: String(run.provider),
    totalTasks: Number(run.total_tasks), completedTasks: Number(run.completed_tasks),
    succeededTasks: Number(run.succeeded_tasks), failedTasks: Number(run.failed_tasks),
    progressPercent: Number(run.progress_percent), createdAt: String(run.created_at),
    completedAt: run.completed_at == null ? null : String(run.completed_at),
  }))
}

export async function getImportRunDetail(runId: string, targetId?: string) {
  const db = getDataImportDatabase(targetId)
  const [{ data: run, error }, { data: tasks }, { data: changes }] = await Promise.all([
    db.from('data_import_runs').select('*').eq('id', runId).maybeSingle(),
    db.from('data_import_tasks').select('*,template_clubs(name,logo_url)').eq('import_run_id', runId).order('created_at'),
    db.from('data_import_changes').select('*').eq('import_run_id', runId).order('created_at'),
  ])
  if (error) throw error
  if (!run) return null
  return { run, tasks: tasks ?? [], changes: changes ?? [] }
}

export async function getLeagueSyncState(targetId?: string) {
  const db = getDataImportDatabase(targetId)
  const [{ data, error }, { data: tasks, error: taskError }] = await Promise.all([
    db.from('league_table_snapshots')
      .select('league_id,competition,season,source,fetched_at,standings')
      .eq('is_active', true)
      .eq('season', CURRENT_LEAGUE_SEASON)
      .order('fetched_at', { ascending: false }),
    db.from('data_import_tasks')
      .select('competition,status,safe_error_message,import_run_id,completed_at,data_import_runs(type)')
      .not('competition', 'is', null)
      .order('created_at', { ascending: false }),
  ])
  if (error) throw error
  if (taskError) throw taskError
  const lastTaskByCompetition = new Map<string, {
    status?: string
    safe_error_message?: string
    import_run_id?: string
    completed_at?: string
  }>()
  for (const task of tasks ?? []) {
    const run = task.data_import_runs as unknown as { type?: string } | null
    const competition = String(task.competition)
    if (run?.type === 'LEAGUE_STANDINGS' && !lastTaskByCompetition.has(competition)) {
      lastTaskByCompetition.set(competition, task)
    }
  }
  const activeByLeagueId = new Map<string, NonNullable<typeof data>[number]>()
  for (const row of data ?? []) {
    const leagueId = String(row.league_id)
    if (!activeByLeagueId.has(leagueId)) activeByLeagueId.set(leagueId, row)
  }
  const leagues = [
    { competition: 'PREMIER_LEAGUE', leagueId: 'premier-league' },
    { competition: 'CHAMPIONSHIP', leagueId: 'efl-championship' },
  ] as const
  return leagues.map(({ competition, leagueId }) => {
    const row = activeByLeagueId.get(leagueId)
    const lastTask = lastTaskByCompetition.get(competition)
    const standings = (Array.isArray(row?.standings) ? row.standings : []).flatMap((value): LeagueStandingRow[] => {
      if (!value || typeof value !== 'object') return []
      const item = value as Record<string, unknown>
      return [{
        position: Number(item['position']), team: String(item['team'] ?? ''),
        played: Number(item['played']), won: Number(item['won']), drawn: Number(item['drawn']),
        lost: Number(item['lost']), goalDifference: Number(item['goalDifference']), points: Number(item['points']),
      }]
    })
    return {
      leagueId, competition,
      season: row ? String(row.season) : null,
      provider: row ? String(row.source) : null,
      fetchedAt: row ? String(row.fetched_at) : null,
      clubCount: standings.length, standings,
      lastStatus: lastTask?.status ?? null,
      lastError: lastTask?.safe_error_message ?? null,
      lastRunId: lastTask?.import_run_id ?? null,
      lastCompletedAt: lastTask?.completed_at ?? null,
    }
  })
}
