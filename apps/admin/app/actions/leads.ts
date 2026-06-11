'use server'

import { revalidatePath } from 'next/cache'
import { requireSession } from '@/lib/session'
import { isLeadStatus } from '@/lib/leads'
import { setLeadStatus } from '@/lib/leads.server'

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
