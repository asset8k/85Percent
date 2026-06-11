'use client'

import { useState } from 'react'
import { MoreHorizontal, Eye, Copy, Inbox } from 'lucide-react'
import type { Lead } from '@/lib/leads'
import { formatDate, timeAgo, initials } from '@/lib/format'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table'
import { Dropdown, DropdownItem } from '@/components/ui/dropdown'
import { StatusBadge } from './status-badge'
import { LeadSheet } from './lead-sheet'

export function LeadsTable({ leads }: { leads: Lead[] }) {
  const [active, setActive] = useState<Lead | null>(null)

  if (leads.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-16 text-center">
        <Inbox className="mb-3 h-7 w-7 text-muted-foreground" />
        <p className="text-sm font-medium">No leads yet</p>
        <p className="mt-1 text-sm text-muted-foreground">
          Requests from the landing page will appear here.
        </p>
      </div>
    )
  }

  return (
    <>
      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-[140px]">Date</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Club</TableHead>
              <TableHead>Role</TableHead>
              <TableHead className="w-[150px]">Status</TableHead>
              <TableHead className="w-[60px] text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {leads.map((lead) => (
              <TableRow
                key={lead.id}
                className="cursor-pointer"
                onClick={() => setActive(lead)}
              >
                <TableCell className="text-muted-foreground" title={formatDate(lead.createdAt)}>
                  {timeAgo(lead.createdAt)}
                </TableCell>
                <TableCell>
                  <div className="flex items-center gap-2.5">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground">
                      {initials(lead.name)}
                    </span>
                    <div className="min-w-0">
                      <p className="truncate font-medium">{lead.name ?? 'Unknown'}</p>
                      <p className="truncate text-xs text-muted-foreground">{lead.email}</p>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="text-muted-foreground">{lead.club ?? '—'}</TableCell>
                <TableCell className="text-muted-foreground">{lead.role ?? '—'}</TableCell>
                <TableCell>
                  <StatusBadge status={lead.status} />
                </TableCell>
                <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                  <Dropdown
                    trigger={({ toggle }) => (
                      <button
                        type="button"
                        onClick={toggle}
                        aria-label="Lead actions"
                        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                      >
                        <MoreHorizontal className="h-4 w-4" />
                      </button>
                    )}
                  >
                    {(close) => (
                      <>
                        <DropdownItem
                          onClick={() => {
                            close()
                            setActive(lead)
                          }}
                        >
                          <Eye className="h-4 w-4" /> View details
                        </DropdownItem>
                        <DropdownItem
                          onClick={() => {
                            navigator.clipboard?.writeText(lead.email)
                            close()
                          }}
                        >
                          <Copy className="h-4 w-4" /> Copy email
                        </DropdownItem>
                      </>
                    )}
                  </Dropdown>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <LeadSheet lead={active} onClose={() => setActive(null)} />
    </>
  )
}
