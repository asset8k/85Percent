import { getImportRunDetail } from '@/lib/data-imports'
import { isAuthed } from '@/lib/session'

export const dynamic = 'force-dynamic'

export async function GET(request: Request, { params }: { params: { runId: string } }): Promise<Response> {
  if (!isAuthed()) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const targetId = new URL(request.url).searchParams.get('target') ?? undefined
  const detail = await getImportRunDetail(params.runId, targetId)
  return detail ? Response.json(detail) : Response.json({ error: 'Not found' }, { status: 404 })
}
