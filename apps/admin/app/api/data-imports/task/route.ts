import { verifySignatureAppRouter } from '@upstash/qstash/nextjs'
import { z } from 'zod'
import { processImportTask } from '@/backend/data-imports/service'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

const payloadSchema = z.object({ taskId: z.string().uuid(), targetId: z.string().optional() })

async function handler(request: Request): Promise<Response> {
  const parsed = payloadSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return Response.json({ error: 'Invalid task payload' }, { status: 400 })
  const result = await processImportTask(parsed.data.taskId, parsed.data.targetId)
  if (result.status === 'RETRY') {
    return Response.json(
      { status: result.status },
      { status: 503, headers: result.retryAfterSeconds ? { 'Retry-After': String(result.retryAfterSeconds) } : undefined },
    )
  }
  return Response.json(result)
}

export async function POST(request: Request): Promise<Response> {
  const currentSigningKey = process.env['QSTASH_CURRENT_SIGNING_KEY']
  const nextSigningKey = process.env['QSTASH_NEXT_SIGNING_KEY']
  if (!currentSigningKey || !nextSigningKey) {
    return Response.json(
      { error: 'Data import worker signature verification is not configured.' },
      { status: 503 },
    )
  }

  return verifySignatureAppRouter(handler, { currentSigningKey, nextSigningKey })(request)
}
