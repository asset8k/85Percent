import { cancelImportRun } from '@/backend/data-imports/service'
import { isAuthed } from '@/lib/session'
import { withDataImportTarget } from '@/backend/data-imports/target'

export async function POST(request: Request, { params }: { params: { runId: string } }): Promise<Response> {
  if (!isAuthed()) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const body = (await request.json().catch(() => ({}))) as { targetId?: string }
  await withDataImportTarget(body.targetId, () => cancelImportRun(params.runId))
  return Response.json({ cancelled: true })
}
