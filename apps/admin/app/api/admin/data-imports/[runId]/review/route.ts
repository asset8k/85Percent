import { getDataImportDatabase } from '@/backend/data-imports/target'
import { isAuthed } from '@/lib/session'
import { env } from '@/lib/env'

export async function POST(request: Request, { params }: { params: { runId: string } }): Promise<Response> {
  if (!isAuthed()) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const body = (await request.json().catch(() => null)) as { changeId?: string; decision?: string; targetId?: string } | null
  if (!body?.changeId || !['approve', 'reject'].includes(body.decision ?? '')) {
    return Response.json({ error: 'Invalid review decision' }, { status: 400 })
  }
  const db = getDataImportDatabase(body.targetId)
  const { data: change, error } = await db.from('data_import_changes').select('id,import_task_id,status').eq('id', body.changeId).eq('import_run_id', params.runId).maybeSingle()
  if (error || !change || change.status !== 'NEEDS_REVIEW') return Response.json({ error: 'Review item not found' }, { status: 404 })
  const status = body.decision === 'approve' ? 'APPROVED' : 'REJECTED'
  const { error: updateError } = await db.from('data_import_changes').update({
    status, resolved_by: env.adminUsername, resolved_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }).eq('id', change.id).eq('status', 'NEEDS_REVIEW')
  if (updateError) return Response.json({ error: 'Could not save review' }, { status: 500 })
  if (status === 'APPROVED') {
    const { error: applyError } = await db.rpc('apply_template_import_task', { p_task_id: change.import_task_id, p_provider: 'transfermarkt' })
    if (applyError) {
      await db.from('data_import_changes').update({
        status: 'NEEDS_REVIEW', resolved_by: null, resolved_at: null, updated_at: new Date().toISOString(),
      }).eq('id', change.id).eq('status', 'APPROVED')
      return Response.json({ error: 'Could not apply reviewed change' }, { status: 500 })
    }
  }
  const { count } = await db.from('data_import_changes').select('id', { count: 'exact', head: true })
    .eq('import_task_id', change.import_task_id).eq('status', 'NEEDS_REVIEW')
  await db.from('data_import_tasks').update({
    review_count: count ?? 0, warning_count: count ?? 0, updated_at: new Date().toISOString(),
  }).eq('id', change.import_task_id)
  return Response.json({ status })
}
