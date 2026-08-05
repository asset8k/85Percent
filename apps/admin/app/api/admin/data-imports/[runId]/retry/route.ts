import { dispatchImportTasks, markDispatchFailure } from '@/backend/data-imports/orchestration'
import { toDataImportError } from '@/backend/data-imports/errors'
import { retryFailedTasks } from '@/backend/data-imports/service'
import { isAuthed } from '@/lib/session'
import { withDataImportTarget } from '@/backend/data-imports/target'

export async function POST(request: Request, { params }: { params: { runId: string } }): Promise<Response> {
  if (!isAuthed()) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const body = (await request.json().catch(() => ({}))) as { taskId?: string; targetId?: string }
  try {
    const taskIds = await withDataImportTarget(body.targetId, async () => {
      const ids = await retryFailedTasks(params.runId, body.taskId)
      try { await dispatchImportTasks(ids, body.targetId) } catch (error) { await markDispatchFailure(ids, error); throw error }
      return ids
    })
    return Response.json({ retried: taskIds.length, taskIds })
  } catch (error) {
    const safe = toDataImportError(error)
    return Response.json({ code: safe.code, error: safe.safeMessage }, { status: 503 })
  }
}
