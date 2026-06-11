'use client'

import { useEffect, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Mail, Building2, BadgeCheck, Clock, Tag, Check, AlertTriangle, UserPlus } from 'lucide-react'
import type { Lead, LeadStatus } from '@/lib/leads'
import { LEAD_STATUSES } from '@/lib/leads'
import { formatDateTime, initials } from '@/lib/format'
import { Sheet } from '@/components/ui/sheet'
import { Select } from '@/components/ui/select'
import { Label } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { StatusBadge } from './status-badge'
import { updateLeadStatus, provisionLeadAccount } from '@/app/actions/leads'

/**
 * LeadSheet — the read-and-act detail panel. Shows the full lead (including the
 * long message that we deliberately keep out of the table) and lets the operator
 * change the status, which writes straight to Supabase via a server action.
 */
export function LeadSheet({ lead, onClose }: { lead: Lead | null; onClose: () => void }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [status, setStatus] = useState<LeadStatus>('New')
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  // Account provisioning has its own transition + feedback so it never collides
  // with a status save.
  const [provisioning, startProvision] = useTransition()
  const [invite, setInvite] = useState<{ ok: boolean; text: string } | null>(null)

  // Re-sync local state whenever a different lead is opened.
  useEffect(() => {
    if (lead) {
      setStatus(lead.status)
      setError(null)
      setSaved(false)
      setInvite(null)
    }
  }, [lead])

  function onProvision() {
    if (!lead) return
    setInvite(null)
    startProvision(async () => {
      const res = await provisionLeadAccount(lead.email)
      if (res.ok) {
        setInvite({ ok: true, text: `Invite sent to ${lead.email}` })
        router.refresh()
      } else {
        setInvite({ ok: false, text: res.error ?? 'Could not send the invite.' })
      }
    })
  }

  function onChangeStatus(next: LeadStatus) {
    if (next === status) return
    const prev = status
    setStatus(next)
    setError(null)
    setSaved(false)
    startTransition(async () => {
      const res = await updateLeadStatus(lead!.id, next)
      if (res.ok) {
        setSaved(true)
        router.refresh() // keep the table + metric counts in lockstep
      } else {
        setStatus(prev) // roll back the optimistic change
        setError(res.error ?? 'Could not update status.')
      }
    })
  }

  return (
    <Sheet
      open={lead !== null}
      onClose={onClose}
      title={lead?.name ?? 'Lead'}
      description={lead?.email}
    >
      {lead && (
        <div className="space-y-6">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-muted text-sm font-semibold text-muted-foreground">
              {initials(lead.name)}
            </span>
            <StatusBadge status={status} />
          </div>

          <dl className="space-y-3">
            <Field icon={<Mail className="h-4 w-4" />} label="Work email">
              <a href={`mailto:${lead.email}`} className="text-primary hover:underline">
                {lead.email}
              </a>
            </Field>
            <Field icon={<Building2 className="h-4 w-4" />} label="Club">
              {lead.club ?? '—'}
            </Field>
            <Field icon={<BadgeCheck className="h-4 w-4" />} label="Role">
              {lead.role ?? '—'}
            </Field>
            <Field icon={<Clock className="h-4 w-4" />} label="Received">
              {formatDateTime(lead.createdAt)}
            </Field>
            {lead.source && (
              <Field icon={<Tag className="h-4 w-4" />} label="Source">
                <span className="capitalize">{lead.source}</span>
              </Field>
            )}
          </dl>

          <div>
            <Label className="mb-2">Message</Label>
            {lead.message ? (
              <p className="whitespace-pre-wrap rounded-md border border-border bg-muted/40 p-3.5 text-sm leading-relaxed text-foreground">
                {lead.message}
              </p>
            ) : (
              <p className="rounded-md border border-dashed border-border p-3.5 text-sm text-muted-foreground">
                No message provided.
              </p>
            )}
          </div>

          <div className="border-t border-border pt-5">
            <Label htmlFor="lead-status">Update status</Label>
            <Select
              id="lead-status"
              value={status}
              disabled={pending}
              onChange={(e) => onChangeStatus(e.target.value as LeadStatus)}
            >
              {LEAD_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>

            <div className="mt-2 h-5 text-xs">
              {pending && <span className="text-muted-foreground">Saving…</span>}
              {!pending && saved && (
                <span className="inline-flex items-center gap-1 text-emerald-600">
                  <Check className="h-3.5 w-3.5" /> Saved
                </span>
              )}
              {!pending && error && (
                <span className="inline-flex items-center gap-1 text-destructive">
                  <AlertTriangle className="h-3.5 w-3.5" /> {error}
                </span>
              )}
            </div>
          </div>

          <div className="border-t border-border pt-5">
            <Label>Account</Label>
            <p className="mb-3 mt-1 text-xs text-muted-foreground">
              Send a white-glove invite. The lead sets a password and gets their own workspace.
            </p>
            <Button onClick={onProvision} disabled={provisioning} className="w-full">
              <UserPlus className="h-4 w-4" />
              {provisioning ? 'Sending invite…' : 'Provision account'}
            </Button>

            <div className="mt-2 h-5 text-xs">
              {invite && (
                <span
                  className={`inline-flex items-center gap-1 ${
                    invite.ok ? 'text-emerald-600' : 'text-destructive'
                  }`}
                >
                  {invite.ok ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : (
                    <AlertTriangle className="h-3.5 w-3.5" />
                  )}
                  {invite.text}
                </span>
              )}
            </div>
          </div>
        </div>
      )}
    </Sheet>
  )
}

function Field({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode
  label: string
  children: React.ReactNode
}) {
  return (
    <div className="flex items-start gap-3">
      <span className="mt-0.5 text-muted-foreground">{icon}</span>
      <div className="min-w-0">
        <dt className="text-xs text-muted-foreground">{label}</dt>
        <dd className="truncate text-sm">{children}</dd>
      </div>
    </div>
  )
}
