import { z } from 'zod'
import { startStandingsImport } from '@/backend/data-imports/orchestration'
import { toDataImportError } from '@/backend/data-imports/errors'
import { competitionSchema } from '@/backend/data-imports/types'
import { isAuthed } from '@/lib/session'
import { env } from '@/lib/env'

const inputSchema = z.object({ competitions: z.array(competitionSchema).min(1), season: z.string().optional(), targetId: z.string().optional() })

export async function POST(request: Request): Promise<Response> {
  if (!isAuthed()) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const input = inputSchema.safeParse(await request.json().catch(() => null))
  if (!input.success) return Response.json({ error: 'Invalid import request' }, { status: 400 })
  try {
    return Response.json(await startStandingsImport({ ...input.data, requestedBy: env.adminUsername }), { status: 202 })
  } catch (error) {
    const safe = toDataImportError(error)
    return Response.json({ code: safe.code, error: safe.safeMessage }, { status: 409 })
  }
}
