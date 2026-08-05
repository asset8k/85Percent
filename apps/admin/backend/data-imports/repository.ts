import { getScopedDataImportDatabase } from './target'
import type {
  ImportCompetition,
  InternalRosterItem,
  ProposedImportChange,
  SourceMapping,
} from './types'

export interface DataImportTaskRow {
  id: string
  import_run_id: string
  template_club_id: string | null
  external_club_id: string | null
  competition: ImportCompetition | null
  status: 'QUEUED' | 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'CANCELLED'
  current_stage: string
  attempts: number
  max_attempts: number
  started_at: string | null
  data_import_runs?: { status?: string; type?: string; provider?: string; configuration?: Record<string, unknown> }
  template_clubs?: { id: string; name: string; league: ImportCompetition; logo_url: string | null }
}

export async function claimTask(taskId: string): Promise<boolean> {
  const supabase = getScopedDataImportDatabase()
  const { data, error } = await supabase.rpc('claim_data_import_task', { p_task_id: taskId })
  if (error) throw error
  return data === true
}

export async function getTask(taskId: string): Promise<DataImportTaskRow | null> {
  const supabase = getScopedDataImportDatabase()
  const { data, error } = await supabase
    .from('data_import_tasks')
    .select('*, data_import_runs(status,type,provider,configuration), template_clubs(id,name,league,logo_url)')
    .eq('id', taskId)
    .maybeSingle()
  if (error) throw error
  return (data as DataImportTaskRow | null) ?? null
}

export async function setTaskStage(taskId: string, stage: string): Promise<void> {
  const supabase = getScopedDataImportDatabase()
  const { error } = await supabase.from('data_import_tasks').update({
    current_stage: stage,
    last_heartbeat_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('id', taskId).eq('status', 'RUNNING')
  if (error) throw error
}

export async function loadRosterItems(templateClubId: string): Promise<InternalRosterItem[]> {
  const supabase = getScopedDataImportDatabase()
  const { data, error } = await supabase
    .from('template_roster_items')
    .select('id,template_club_id,name,date_of_birth,nationality,position,squad_number,is_manager,contract_start,contract_end,joined_date')
    .eq('template_club_id', templateClubId)
  if (error) throw error
  return (data ?? []).map((row) => ({
    id: String(row.id),
    templateClubId: String(row.template_club_id),
    name: String(row.name),
    dateOfBirth: row.date_of_birth ? String(row.date_of_birth).slice(0, 10) : null,
    nationality: row.nationality == null ? null : String(row.nationality),
    position: (row.position as InternalRosterItem['position']) ?? null,
    squadNumber: row.squad_number == null ? null : Number(row.squad_number),
    isManager: Boolean(row.is_manager),
    contractStart: row.contract_start ? String(row.contract_start).slice(0, 10) : null,
    contractEnd: row.contract_end ? String(row.contract_end).slice(0, 10) : null,
    joinedDate: row.joined_date ? String(row.joined_date).slice(0, 10) : null,
  }))
}

export async function loadMappings(input: {
  provider?: string
  templateClubId?: string
  entityType?: string
} = {}): Promise<SourceMapping[]> {
  const supabase = getScopedDataImportDatabase()
  let query = supabase.from('external_source_mappings').select('provider,entity_type,internal_id,external_id,template_club_id')
  if (input.provider) query = query.eq('provider', input.provider)
  if (input.templateClubId) query = query.eq('template_club_id', input.templateClubId)
  if (input.entityType) query = query.eq('entity_type', input.entityType)
  const { data, error } = await query
  if (error) throw error
  return (data ?? []).map((row) => ({
    provider: String(row.provider),
    entityType: row.entity_type as SourceMapping['entityType'],
    internalId: String(row.internal_id),
    externalId: String(row.external_id),
    templateClubId: row.template_club_id == null ? null : String(row.template_club_id),
  }))
}

export async function upsertMapping(mapping: SourceMapping): Promise<void> {
  const supabase = getScopedDataImportDatabase()
  const now = new Date().toISOString()
  const { error } = await supabase.from('external_source_mappings').upsert({
    provider: mapping.provider,
    entity_type: mapping.entityType,
    internal_id: mapping.internalId,
    external_id: mapping.externalId,
    template_club_id: mapping.templateClubId,
    last_seen_at: now,
    updated_at: now,
  }, { onConflict: 'provider,entity_type,external_id' })
  if (error) throw error
}

export async function stageTaskChanges(
  task: DataImportTaskRow,
  snapshot: Record<string, unknown>,
  changes: ProposedImportChange[],
): Promise<void> {
  const supabase = getScopedDataImportDatabase()
  const { error: deleteError } = await supabase.from('data_import_changes').delete().eq('import_task_id', task.id)
  if (deleteError) throw deleteError

  const persisted = changes.filter((change) => change.changeType !== 'UNCHANGED')
  if (persisted.length) {
    const { error } = await supabase.from('data_import_changes').insert(persisted.map((change) => ({
      import_run_id: task.import_run_id,
      import_task_id: task.id,
      entity_type: change.entityType,
      change_type: change.changeType,
      status: change.status,
      internal_entity_id: change.internalEntityId,
      external_entity_id: change.externalEntityId,
      before_data: change.beforeData,
      after_data: change.afterData,
      reason: change.reason,
    })))
    if (error) throw error
  }

  const count = (type: ProposedImportChange['changeType']) => changes.filter((change) => change.changeType === type).length
  const reviewCount = changes.filter((change) => change.status === 'NEEDS_REVIEW').length
  const { error } = await supabase.from('data_import_tasks').update({
    source_snapshot: snapshot,
    added_count: count('ADD'),
    updated_count: count('UPDATE'),
    unchanged_count: count('UNCHANGED'),
    review_count: reviewCount,
    missing_count: count('MISSING'),
    warning_count: reviewCount,
    last_heartbeat_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }).eq('id', task.id)
  if (error) throw error
}

export async function applySafeTaskChanges(taskId: string, provider: string): Promise<void> {
  const supabase = getScopedDataImportDatabase()
  const { error } = await supabase.rpc('apply_template_import_task', {
    p_task_id: taskId,
    p_provider: provider,
  })
  if (error) throw error
}

export async function finishTask(task: DataImportTaskRow, metadata: Record<string, unknown> = {}): Promise<void> {
  const supabase = getScopedDataImportDatabase()
  const finishedAt = new Date()
  const startedAt = task.started_at ? new Date(task.started_at) : finishedAt
  const { error } = await supabase.from('data_import_tasks').update({
    status: 'SUCCEEDED', current_stage: 'COMPLETED', completed_at: finishedAt.toISOString(),
    duration_ms: Math.max(0, finishedAt.getTime() - startedAt.getTime()), provider_metadata: metadata,
    error_code: null, safe_error_message: null, last_heartbeat_at: finishedAt.toISOString(), updated_at: finishedAt.toISOString(),
  }).eq('id', task.id).eq('status', 'RUNNING')
  if (error) throw error
  await refreshRun(task.import_run_id)
}

export async function failOrRequeueTask(
  task: DataImportTaskRow,
  errorCode: string,
  safeMessage: string,
  retryable: boolean,
): Promise<'RETRY' | 'FAILED'> {
  const supabase = getScopedDataImportDatabase()
  const retry = retryable && task.attempts < task.max_attempts
  const finishedAt = new Date()
  const now = finishedAt.toISOString()
  const startedAt = task.started_at ? new Date(task.started_at) : finishedAt
  const { error } = await supabase.from('data_import_tasks').update({
    status: retry ? 'QUEUED' : 'FAILED',
    current_stage: retry ? 'QUEUED' : task.current_stage,
    completed_at: retry ? null : now,
    duration_ms: retry ? null : Math.max(0, finishedAt.getTime() - startedAt.getTime()),
    error_code: errorCode,
    safe_error_message: safeMessage,
    last_heartbeat_at: now,
    updated_at: now,
  }).eq('id', task.id).eq('status', 'RUNNING')
  if (error) throw error
  await refreshRun(task.import_run_id)
  return retry ? 'RETRY' : 'FAILED'
}

export async function cancelTask(task: DataImportTaskRow): Promise<void> {
  const supabase = getScopedDataImportDatabase()
  const finishedAt = new Date()
  const now = finishedAt.toISOString()
  const startedAt = task.started_at ? new Date(task.started_at) : finishedAt
  await supabase.from('data_import_tasks').update({
    status: 'CANCELLED', completed_at: now, error_code: 'IMPORT_CANCELLED',
    duration_ms: task.started_at ? Math.max(0, finishedAt.getTime() - startedAt.getTime()) : null,
    safe_error_message: 'The import was cancelled.', last_heartbeat_at: now, updated_at: now,
  }).eq('id', task.id).in('status', ['QUEUED', 'RUNNING'])
  await refreshRun(task.import_run_id)
}

export async function refreshRun(runId: string): Promise<void> {
  const supabase = getScopedDataImportDatabase()
  const { error } = await supabase.rpc('refresh_data_import_run', { p_run_id: runId })
  if (error) throw error
}

export async function isRunCancelling(runId: string): Promise<boolean> {
  const supabase = getScopedDataImportDatabase()
  const { data, error } = await supabase.from('data_import_runs').select('status').eq('id', runId).single()
  if (error) throw error
  return data.status === 'CANCELLING' || data.status === 'CANCELLED'
}
