/**
 * Notification engine — emission helper.
 *
 * The foundational primitive other routes call to raise an in-app alert
 * (compliance threshold crossings, contract expiries, workspace activity).
 * Always club-scoped; pass `userId` to target a single member, omit it for a
 * club-wide notice every member sees. Failure is non-fatal — a missing alert
 * must never block the user's primary action — so callers can fire-and-forget.
 */

import { randomUUID } from 'crypto'
import type { FastifyBaseLogger } from 'fastify'
import { supabase } from './supabase.js'

export type NotificationType = 'INFO' | 'WARNING' | 'CRITICAL'

export interface CreateNotificationInput {
  clubId: string
  /** null / omitted = club-wide (visible to every member). */
  userId?: string | null
  title: string
  message: string
  type?: NotificationType
}

export async function createNotification(
  input: CreateNotificationInput,
  log?: FastifyBaseLogger,
): Promise<void> {
  const { error } = await supabase.from('notifications').insert({
    id: randomUUID(),
    club_id: input.clubId,
    user_id: input.userId ?? null,
    title: input.title,
    message: input.message,
    type: input.type ?? 'INFO',
    is_read: false,
  })
  if (error) {
    log?.warn({ err: error, title: input.title }, 'notification insert failed (non-fatal)')
  }
}

/**
 * Idempotent variant: only inserts when no notification with the same
 * (club_id, title) already exists within the last `windowHours`. Used by
 * derived/recurring alerts (compliance state, contract expiries) so refreshing
 * doesn't pile up duplicates of the same standing condition.
 */
export async function createNotificationOnce(
  input: CreateNotificationInput & { windowHours?: number },
  log?: FastifyBaseLogger,
): Promise<boolean> {
  const since = new Date(Date.now() - (input.windowHours ?? 24) * 3600_000).toISOString()
  const { data: existing, error: lookupErr } = await supabase
    .from('notifications')
    .select('id')
    .eq('club_id', input.clubId)
    .eq('title', input.title)
    .gte('created_at', since)
    .limit(1)
    .maybeSingle()

  if (lookupErr) {
    log?.warn({ err: lookupErr, title: input.title }, 'notification dedup lookup failed')
    // Fall through and attempt the insert rather than dropping the alert.
  } else if (existing) {
    return false
  }

  await createNotification(input, log)
  return true
}
