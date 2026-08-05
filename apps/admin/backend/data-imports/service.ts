import { getScopedDataImportDatabase, withDataImportTarget } from './target'
import { getDataImportConfig } from './config'
import { DataImportError, toDataImportError } from './errors'
import { reconcileCoach, reconcilePlayers, normaliseIdentity } from './matching'
import {
  applySafeTaskChanges,
  cancelTask,
  claimTask,
  failOrRequeueTask,
  finishTask,
  getTask,
  isRunCancelling,
  loadMappings,
  loadRosterItems,
  refreshRun,
  setTaskStage,
  stageTaskChanges,
  upsertMapping,
  type DataImportTaskRow,
} from './repository'
import { validateStandingsSnapshot } from './standings'
import { validateImportedSquadSnapshot, type ImportCompetition, type SourceMapping, type SquadProvider, type StandingsProvider } from './types'
import { TransfermarktSquadProvider } from './providers/transfermarkt'
import { FootballDataStandingsProvider } from './providers/football-data'

export interface ProcessTaskResult {
  status: 'SUCCEEDED' | 'SKIPPED' | 'FAILED' | 'RETRY'
  retryAfterSeconds?: number
}

function providers(): { squad: SquadProvider; standings: StandingsProvider } {
  return { squad: new TransfermarktSquadProvider(), standings: new FootballDataStandingsProvider() }
}

async function processSquadTask(task: DataImportTaskRow, provider: SquadProvider): Promise<void> {
  const club = task.template_clubs
  if (!club || !task.template_club_id || !task.competition || !task.external_club_id) {
    throw new DataImportError('CLUB_MAPPING_MISSING')
  }
  await setTaskStage(task.id, 'FETCHING')
  const snapshot = await provider.fetchClubSquad({
    externalClubId: task.external_club_id,
    competition: task.competition,
    season: String(task.data_import_runs?.configuration?.season ?? ''),
  })
  try {
    validateImportedSquadSnapshot(snapshot)
  } catch (error) {
    if (error instanceof DataImportError) throw error
    throw new DataImportError(
      'INVALID_PROVIDER_RESPONSE',
      error instanceof Error ? error.message : String(error),
      false,
      undefined,
      'The provider returned a suspiciously partial or duplicated squad. No changes were applied.',
    )
  }
  if (await isRunCancelling(task.import_run_id)) {
    await cancelTask(task)
    throw new DataImportError('IMPORT_CANCELLED')
  }

  await setTaskStage(task.id, 'NORMALISING')
  await setTaskStage(task.id, 'MATCHING')
  const [items, mappings] = await Promise.all([
    loadRosterItems(task.template_club_id),
    loadMappings({ provider: provider.name }),
  ])
  const changes = [
    ...reconcilePlayers(snapshot.players, items, mappings, task.template_club_id),
    ...reconcileCoach(snapshot.coach, items, mappings),
  ]
  if (snapshot.logoUrl && snapshot.logoUrl !== club.logo_url) {
    changes.push({
      entityType: 'CLUB', changeType: 'UPDATE', status: 'AUTO_APPLY', internalEntityId: club.id,
      externalEntityId: task.external_club_id, beforeData: { logoUrl: club.logo_url },
      afterData: { logoUrl: snapshot.logoUrl }, reason: null,
    })
  }

  await stageTaskChanges(task, snapshot as unknown as Record<string, unknown>, changes)
  await setTaskStage(task.id, 'APPLYING')
  await applySafeTaskChanges(task.id, provider.name)
  await setTaskStage(task.id, 'VERIFYING')
  const after = await loadRosterItems(task.template_club_id)
  const expectedMinimum = snapshot.players.length
  if (after.filter((item) => !item.isManager).length < expectedMinimum) {
    throw new DataImportError('IMPORT_WRITE_FAILED', 'Post-import roster verification failed')
  }
  await finishTask(task, { sourceCount: snapshot.players.length, retrievedAt: snapshot.retrievedAt })
}

async function ensureStandingsMappings(
  snapshot: Awaited<ReturnType<StandingsProvider['fetchStandings']>>,
): Promise<SourceMapping[]> {
  const supabase = getScopedDataImportDatabase()
  const [mappings, clubsResult] = await Promise.all([
    loadMappings({ provider: snapshot.provider, entityType: 'CLUB' }),
    supabase.from('template_clubs').select('id,name,league').eq('league', snapshot.competition).eq('is_active', true),
  ])
  if (clubsResult.error) throw clubsResult.error
  const byName = new Map<string, Array<{ id: string; name: string }>>()
  for (const club of clubsResult.data ?? []) {
    const key = normaliseIdentity(String(club.name))
    byName.set(key, [...(byName.get(key) ?? []), { id: String(club.id), name: String(club.name) }])
  }
  const next = [...mappings]
  for (const standing of snapshot.standings) {
    if (next.some((mapping) => mapping.externalId === standing.externalClubId)) continue
    const candidates = byName.get(normaliseIdentity(standing.team)) ?? []
    if (candidates.length !== 1 || !candidates[0]) continue
    const mapping: SourceMapping = {
      provider: snapshot.provider, entityType: 'CLUB', internalId: candidates[0].id,
      externalId: standing.externalClubId, templateClubId: candidates[0].id,
    }
    await upsertMapping(mapping)
    next.push(mapping)
  }
  return next
}

async function processStandingsTask(task: DataImportTaskRow, provider: StandingsProvider): Promise<void> {
  const supabase = getScopedDataImportDatabase()
  if (!task.competition) throw new DataImportError('INVALID_PROVIDER_RESPONSE', 'Task competition is missing')
  await setTaskStage(task.id, 'FETCHING')
  const snapshot = await provider.fetchStandings({
    competition: task.competition,
    season: String(task.data_import_runs?.configuration?.season ?? ''),
  })
  if (await isRunCancelling(task.import_run_id)) {
    await cancelTask(task)
    throw new DataImportError('IMPORT_CANCELLED')
  }
  await setTaskStage(task.id, 'NORMALISING')
  const mappings = await ensureStandingsMappings(snapshot)
  await setTaskStage(task.id, 'MATCHING')
  const validated = validateStandingsSnapshot(snapshot, mappings)
  await stageTaskChanges(task, snapshot as unknown as Record<string, unknown>, [])
  await setTaskStage(task.id, 'APPLYING')
  const publicRows = validated.map(({ templateClubId: _templateClubId, ...row }) => row)
  const { error } = await supabase.rpc('publish_league_snapshot', {
    p_league_id: snapshot.leagueId,
    p_competition: snapshot.competitionName,
    p_season: snapshot.season,
    p_source: snapshot.provider,
    p_standings: publicRows,
    p_fetched_at: snapshot.retrievedAt,
  })
  if (error) throw new DataImportError('IMPORT_WRITE_FAILED', error.message)
  await setTaskStage(task.id, 'VERIFYING')
  await finishTask(task, { sourceCount: publicRows.length, retrievedAt: snapshot.retrievedAt })
}

export async function processImportTask(taskId: string, targetId?: string): Promise<ProcessTaskResult> {
  return withDataImportTarget(targetId, async () => {
  let task = await getTask(taskId)
  if (!task) return { status: 'SKIPPED' }
  if (task.status === 'SUCCEEDED' || task.status === 'CANCELLED') return { status: 'SKIPPED' }
  if (await isRunCancelling(task.import_run_id)) {
    await cancelTask(task)
    return { status: 'SKIPPED' }
  }
  if (!(await claimTask(taskId))) return { status: 'SKIPPED' }
  task = (await getTask(taskId))!

  try {
    const selected = providers()
    if (task.data_import_runs?.type === 'CLUB_SQUAD') await processSquadTask(task, selected.squad)
    else await processStandingsTask(task, selected.standings)
    return { status: 'SUCCEEDED' }
  } catch (error) {
    const importedError = toDataImportError(error)
    if (importedError.code === 'IMPORT_CANCELLED') return { status: 'SKIPPED' }
    const outcome = await failOrRequeueTask(task, importedError.code, importedError.safeMessage, importedError.retryable)
    return { status: outcome, retryAfterSeconds: importedError.retryAfterSeconds }
  }
  })
}

export async function resolveSquadClubMappings(
  clubIds: string[],
  provider: SquadProvider = providers().squad,
  season: string,
): Promise<Map<string, string>> {
  const supabase = getScopedDataImportDatabase()
  const { data: clubs, error } = await supabase
    .from('template_clubs')
    .select('id,name,league')
    .in('id', clubIds)
    .eq('is_active', true)
  if (error) throw error
  const existing = await loadMappings({ provider: provider.name, entityType: 'CLUB' })
  const result = new Map(existing.map((mapping) => [mapping.internalId, mapping.externalId]))
  for (const competition of ['PREMIER_LEAGUE', 'CHAMPIONSHIP'] as const) {
    const unresolved = (clubs ?? []).filter((club) => club.league === competition && !result.has(String(club.id)))
    if (!unresolved.length) continue
    const discovered = await provider.discoverClubs(competition, season)
    for (const club of unresolved) {
      const candidates = discovered.filter((candidate) => normaliseIdentity(candidate.name) === normaliseIdentity(String(club.name)))
      if (candidates.length !== 1 || !candidates[0]) continue
      const mapping: SourceMapping = {
        provider: provider.name, entityType: 'CLUB', internalId: String(club.id),
        externalId: candidates[0].externalClubId, templateClubId: String(club.id),
      }
      await upsertMapping(mapping)
      result.set(String(club.id), candidates[0].externalClubId)
    }
  }
  return result
}

export async function cancelImportRun(runId: string): Promise<void> {
  const supabase = getScopedDataImportDatabase()
  const now = new Date().toISOString()
  const { error } = await supabase.from('data_import_runs').update({ status: 'CANCELLING', updated_at: now }).eq('id', runId)
  if (error) throw error
  await supabase.from('data_import_tasks').update({
    status: 'CANCELLED', completed_at: now, error_code: 'IMPORT_CANCELLED', safe_error_message: 'The import was cancelled.', updated_at: now,
  }).eq('import_run_id', runId).eq('status', 'QUEUED')
  await refreshRun(runId)
}

export async function retryFailedTasks(runId: string, taskId?: string): Promise<string[]> {
  const supabase = getScopedDataImportDatabase()
  let query = supabase.from('data_import_tasks').select('id').eq('import_run_id', runId).eq('status', 'FAILED')
  if (taskId) query = query.eq('id', taskId)
  const { data, error } = await query
  if (error) throw error
  const ids = (data ?? []).map((row) => String(row.id))
  if (!ids.length) return []
  const { error: updateError } = await supabase.from('data_import_tasks').update({
    status: 'QUEUED', current_stage: 'QUEUED', attempts: 0, completed_at: null,
    error_code: null, safe_error_message: null, updated_at: new Date().toISOString(),
  }).in('id', ids)
  if (updateError) throw updateError
  await supabase.from('data_import_runs').update({ status: 'RUNNING', completed_at: null, updated_at: new Date().toISOString() }).eq('id', runId)
  await refreshRun(runId)
  return ids
}

export { getDataImportConfig }
