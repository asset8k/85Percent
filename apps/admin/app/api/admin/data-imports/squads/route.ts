import { z } from 'zod'
import { startSquadImport } from '@/backend/data-imports/orchestration'
import { toDataImportError } from '@/backend/data-imports/errors'
import { isAuthed } from '@/lib/session'
import { env } from '@/lib/env'
import { assertSquadProviderReady } from '@/backend/data-imports/provider-health'

const inputSchema = z.object({ clubIds: z.array(z.string().uuid()).min(1), season: z.string().optional(), targetId: z.string().optional() })

function errorStatus(code: string): number {
  if (code === 'PROVIDER_UNAVAILABLE' || code === 'PROVIDER_RATE_LIMITED') return 503
  if (code === 'INVALID_PROVIDER_RESPONSE') return 422
  if (code === 'IMPORT_CONFIGURATION_INVALID') return 503
  if (code === 'CLUB_MAPPING_MISSING') return 422
  return 409
}

export async function GET(): Promise<Response> {
  if (!isAuthed()) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  try {
    await assertSquadProviderReady()
    return Response.json({ status: 'ready' })
  } catch (error) {
    const safe = toDataImportError(error)
    return Response.json({ status: 'unavailable', code: safe.code, error: safe.safeMessage }, { status: errorStatus(safe.code) })
  }
}

export async function POST(request: Request): Promise<Response> {
  if (!isAuthed()) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const input = inputSchema.safeParse(await request.json().catch(() => null))
  if (!input.success) return Response.json({ error: 'Invalid import request' }, { status: 400 })
  try {
    return Response.json(await startSquadImport({ ...input.data, requestedBy: env.adminUsername }), { status: 202 })
  } catch (error) {
    const safe = toDataImportError(error)
    return Response.json({ code: safe.code, error: safe.safeMessage }, { status: errorStatus(safe.code) })
  }
}
