/**
 * Centralised audit log helper.
 *
 * Every mutating route writes one row per affected entity. Failure is non-fatal
 * by design — a missing audit row should never block a user's primary action.
 * Logged with a `warn` so it shows up in observability without polluting normal
 * info-level output.
 */

import { randomUUID } from 'crypto'
import type { FastifyRequest } from 'fastify'
import { supabase } from './supabase.js'

export type AuditAction = 'create' | 'update' | 'delete'

export async function writeAuditLog(
  request: FastifyRequest,
  tableName: string,
  recordId: string,
  action: AuditAction,
  newValue?: unknown,
  previousValue?: unknown,
): Promise<void> {
  const { error } = await supabase.from('audit_logs').insert({
    id: randomUUID(),
    user_id: request.userId,
    club_id: request.clubId,
    table_name: tableName,
    record_id: recordId,
    action,
    ...(previousValue !== undefined ? { previous_value: previousValue } : {}),
    ...(newValue      !== undefined ? { new_value:      newValue }      : {}),
  })
  if (error) {
    request.log.warn(
      { err: error, tableName, recordId, action },
      'audit_logs insert failed (non-fatal)'
    )
  }
}
