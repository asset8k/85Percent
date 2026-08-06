import { randomUUID } from 'node:crypto'
import { Client } from '@upstash/qstash'
import { deriveSeasonStartYear, getDataImportConfig, getDataImportDispatchMode } from './config'
import { DataImportError } from './errors'
import { processImportTask, resolveSquadClubMappings } from './service'
import { assertSquadProviderReady } from './provider-health'
import { getDataImportTarget, getScopedDataImportDatabase, withDataImportTarget } from './target'
import type { ImportCompetition } from './types'

export interface CreatedImportRun {
  runId: string
  taskIds: string[]
}

function callbackUrl(): string {
  const explicit = process.env['DATA_IMPORT_CALLBACK_URL']?.trim()
  if (explicit) return explicit
  const vercelUrl = process.env['VERCEL_URL']?.trim().replace(/\/+$/, '')
  if (vercelUrl) return `https://${vercelUrl}/api/data-imports/task`
  return 'http://localhost:4000/api/data-imports/task'
}

function qstashClient(): Client | null {
  const token = process.env['QSTASH_TOKEN']
  if (!token) return null
  return new Client({ token })
}

async function runLocally(taskId: string, targetId: string): Promise<void> {
  for (;;) {
    const result = await processImportTask(taskId, targetId)
    if (result.status !== 'RETRY') return
    await new Promise((resolve) => setTimeout(resolve, (result.retryAfterSeconds ?? 1) * 1000))
  }
}

async function dispatchLocalTask(taskId: string, targetId: string): Promise<void> {
  try {
    await runLocally(taskId, targetId)
  } catch (error) {
    // A failure before claimTask cannot be recorded by processImportTask itself.
    // Persist it so a local task never stays queued forever without feedback.
    await withDataImportTarget(targetId, () => markDispatchFailure([taskId], error))
    console.error('Local data-import task could not start', { taskId, targetId, error })
  }
}

export async function dispatchImportTasks(taskIds: string[], targetId?: string): Promise<void> {
  const target = getDataImportTarget(targetId)
  const mode = getDataImportDispatchMode()
  const config = getDataImportConfig()
  if (mode === 'local') {
    void Promise.allSettled(taskIds.map((taskId) => dispatchLocalTask(taskId, target.id)))
    return
  }

  if (target.id !== getDataImportTarget().id) throw new DataImportError('IMPORT_CONFIGURATION_INVALID', 'QStash imports may only use the configured default target')
  const client = qstashClient()
  if (!client) throw new DataImportError('IMPORT_CONFIGURATION_INVALID', 'QStash is not configured')
  const callback = callbackUrl()
  if (!callback.startsWith('https://')) {
    throw new DataImportError('IMPORT_CONFIGURATION_INVALID', 'QStash requires an HTTPS task callback URL')
  }

  for (const taskId of taskIds) {
    await client.publishJSON({
      url: callback,
      body: { taskId, targetId: target.id },
      retries: config.maxTaskAttempts - 1,
      flowControl: {
        key: '85percent-football-data-imports',
        parallelism: config.maxConcurrentClubTasks,
      },
    })
  }
}

async function recoverStaleLocalTasks(): Promise<void> {
  if (getDataImportDispatchMode() !== 'local') return
  const supabase = getScopedDataImportDatabase()
  const cutoff = new Date(Date.now() - 2 * 60_000).toISOString()
  const { data: tasks, error } = await supabase.from('data_import_tasks')
    .select('id,import_run_id')
    .eq('status', 'RUNNING')
    .lt('last_heartbeat_at', cutoff)
  if (error) throw error
  if (!tasks?.length) return
  const now = new Date().toISOString()
  const { error: updateError } = await supabase.from('data_import_tasks').update({
    status: 'FAILED', error_code: 'IMPORT_INTERRUPTED',
    safe_error_message: 'The local import worker stopped before this task finished. Retry the task to continue.',
    completed_at: now, updated_at: now,
  }).in('id', tasks.map((task) => task.id)).eq('status', 'RUNNING')
  if (updateError) throw updateError
  for (const runId of new Set(tasks.map((task) => String(task.import_run_id)))) {
    const { error: refreshError } = await supabase.rpc('refresh_data_import_run', { p_run_id: runId })
    if (refreshError) throw refreshError
  }
}

export async function markDispatchFailure(taskIds: string[], error: unknown): Promise<void> {
  if (!taskIds.length) return
  const completedAt = new Date().toISOString()
  const message = error instanceof Error ? error.message : String(error)
  const supabase = getScopedDataImportDatabase()
  const { data: tasks, error: taskReadError } = await supabase.from('data_import_tasks').select('import_run_id').in('id', taskIds)
  if (taskReadError) throw taskReadError
  const runIds = [...new Set((tasks ?? []).map((task) => String(task.import_run_id)))]
  const { error: taskUpdateError } = await supabase.from('data_import_tasks').update({
    status: 'FAILED', error_code: 'IMPORT_CONFIGURATION_INVALID',
    safe_error_message: 'Tasks could not be dispatched.', completed_at: completedAt, updated_at: completedAt,
  }).in('id', taskIds).eq('status', 'QUEUED')
  if (taskUpdateError) throw taskUpdateError
  for (const runId of runIds) {
    const { error: runUpdateError } = await supabase.from('data_import_runs').update({
      error_summary: message, updated_at: completedAt,
    }).eq('id', runId)
    if (runUpdateError) throw runUpdateError
    const { error: refreshError } = await supabase.rpc('refresh_data_import_run', { p_run_id: runId })
    if (refreshError) throw refreshError
  }
}

async function createRun(input: {
  type: 'CLUB_SQUAD' | 'LEAGUE_STANDINGS'
  requestedBy: string
  leagueId?: string
  provider: string
  configuration: Record<string, unknown>
  tasks: Array<{
    templateClubId?: string
    externalClubId?: string
    competition: ImportCompetition
  }>
}): Promise<CreatedImportRun> {
  const supabase = getScopedDataImportDatabase()
  const runId = randomUUID()
  const taskIds = input.tasks.map(() => randomUUID())
  const { maxTaskAttempts } = getDataImportConfig()
  const { error: runError } = await supabase.from('data_import_runs').insert({
    id: runId,
    type: input.type,
    status: 'QUEUED',
    requested_by_user_id: input.requestedBy,
    league_id: input.leagueId ?? null,
    provider: input.provider,
    total_tasks: input.tasks.length,
    configuration: input.configuration,
  })
  if (runError) throw runError

  const { error: taskError } = await supabase.from('data_import_tasks').insert(input.tasks.map((task, index) => ({
    id: taskIds[index],
    import_run_id: runId,
    template_club_id: task.templateClubId ?? null,
    external_club_id: task.externalClubId ?? null,
    competition: task.competition,
    max_attempts: maxTaskAttempts,
    idempotency_key: `${input.type}:${runId}:${task.templateClubId ?? task.competition}`,
  })))
  if (taskError) {
    await supabase.from('data_import_runs').delete().eq('id', runId)
    if (taskError.code === '23505') {
      throw new DataImportError('IMPORT_WRITE_FAILED', 'One of the selected clubs already has an active import')
    }
    throw taskError
  }
  return { runId, taskIds }
}

export async function startSquadImport(input: {
  clubIds: string[]
  requestedBy: string
  season?: string
  targetId?: string
}): Promise<CreatedImportRun> {
  return withDataImportTarget(input.targetId, async () => {
  const supabase = getScopedDataImportDatabase()
  await recoverStaleLocalTasks()
  const config = getDataImportConfig()
  const clubIds = [...new Set(input.clubIds)]
  if (!clubIds.length || clubIds.length > config.maxClubsPerRun) {
    throw new DataImportError(
      'IMPORT_CONFIGURATION_INVALID',
      `Select between 1 and ${config.maxClubsPerRun} clubs`,
    )
  }
  const season = input.season ?? deriveSeasonStartYear()
  await assertSquadProviderReady()
  const { data: clubs, error } = await supabase
    .from('template_clubs')
    .select('id,name,league')
    .in('id', clubIds)
    .eq('is_active', true)
  if (error) throw error
  if ((clubs ?? []).length !== clubIds.length) {
    throw new DataImportError('CLUB_MAPPING_MISSING', 'A selected club is no longer active for the 2026-27 season')
  }
  const mappings = await resolveSquadClubMappings(clubIds, undefined, season)
  const target = getDataImportTarget(input.targetId)
  const created = await createRun({
    type: 'CLUB_SQUAD',
    requestedBy: input.requestedBy,
    provider: 'transfermarkt',
    configuration: {
      season,
      maxConcurrentTasks: config.maxConcurrentClubTasks,
      selectedClubIds: clubIds,
      targetId: target.id,
      targetLabel: target.label,
      dispatchMode: getDataImportDispatchMode(),
    },
    tasks: (clubs ?? []).map((club) => ({
      templateClubId: String(club.id),
      externalClubId: mappings.get(String(club.id)),
      competition: club.league as ImportCompetition,
    })),
  })
  try {
    await dispatchImportTasks(created.taskIds, target.id)
  } catch (error) {
    await markDispatchFailure(created.taskIds, error)
    throw error
  }
  return created
  })
}

export async function startStandingsImport(input: {
  competitions: ImportCompetition[]
  requestedBy: string
  season?: string
  targetId?: string
}): Promise<CreatedImportRun> {
  return withDataImportTarget(input.targetId, async () => {
  await recoverStaleLocalTasks()
  const competitions = [...new Set(input.competitions)]
  if (!competitions.length || competitions.some((value) => value !== 'PREMIER_LEAGUE' && value !== 'CHAMPIONSHIP')) {
    throw new DataImportError('IMPORT_CONFIGURATION_INVALID', 'Choose a supported competition')
  }
  const season = input.season ?? deriveSeasonStartYear()
  const created = await createRun({
    type: 'LEAGUE_STANDINGS',
    requestedBy: input.requestedBy,
    leagueId: competitions.length === 1 ? competitions[0] : undefined,
    provider: 'football-data.org',
    configuration: { season, competitions, targetId: getDataImportTarget(input.targetId).id, targetLabel: getDataImportTarget(input.targetId).label, dispatchMode: getDataImportDispatchMode() },
    tasks: competitions.map((competition) => ({ competition })),
  })
  try {
    await dispatchImportTasks(created.taskIds, input.targetId)
  } catch (error) {
    await markDispatchFailure(created.taskIds, error)
    throw error
  }
  return created
  })
}
