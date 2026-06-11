'use server'

import { revalidatePath } from 'next/cache'
import { requireSession } from '@/lib/session'
import { isLeadStatus } from '@/lib/leads'
import { setLeadStatus } from '@/lib/leads.server'
import { getSupabase } from '@/lib/supabase'
import { env } from '@/lib/env'

/**
 * Update a lead's status. Called from the lead detail sheet; returns a small
 * result so the client can surface an error inline without a full navigation.
 */
export async function updateLeadStatus(
  id: string,
  status: string,
): Promise<{ ok: boolean; error?: string }> {
  requireSession()
  if (!isLeadStatus(status)) return { ok: false, error: 'Unknown status.' }
  const res = await setLeadStatus(id, status)
  if (res.ok) revalidatePath('/leads')
  return res
}

/**
 * Provision a real account for a lead (white-glove onboarding). Sends a Supabase
 * Auth invite email via the service-role Admin API; the invitee lands on the web
 * app's `/set-password` page (the API auto-provisions their workspace on first
 * authenticated request). Service-role only — runs exclusively on the server.
 *
 * On success the lead is advanced to "Contacted" so the inbox reflects that the
 * invite went out.
 */
export async function provisionLeadAccount(
  email: string,
): Promise<{ ok: boolean; error?: string }> {
  requireSession()

  const trimmed = email.trim().toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    return { ok: false, error: 'That lead has no valid email to invite.' }
  }

  const { error } = await getSupabase().auth.admin.inviteUserByEmail(trimmed, {
    redirectTo: `${env.appUrl}/set-password`,
  })

  if (error) {
    // The most common case: the email already has an account. Surface a clear,
    // non-technical message; log the rest.
    const msg = error.message ?? ''
    if (/already|registered|exists/i.test(msg)) {
      return { ok: false, error: 'That email already has an account.' }
    }
    console.error('provisionLeadAccount: invite failed:', msg)
    return { ok: false, error: 'Could not send the invite. Please try again.' }
  }

  return { ok: true }
}
