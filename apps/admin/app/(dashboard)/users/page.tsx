import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowRight } from 'lucide-react'
import { listUsers } from '@/lib/users'
import { formatUsd, formatDate } from '@/lib/format'
import { Badge } from '@/components/ui/badge'
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from '@/components/ui/table'

export const metadata: Metadata = { title: 'Users' }
export const dynamic = 'force-dynamic'

export default async function UsersPage() {
  const { users, clubName } = await listUsers()

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">Users</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {users.length} account{users.length === 1 ? '' : 's'}.
        </p>
      </header>

      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Email</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Club</TableHead>
              <TableHead>Access</TableHead>
              <TableHead className="text-right">AI balance</TableHead>
              <TableHead className="text-right">Tokens</TableHead>
              <TableHead>Created</TableHead>
              <TableHead className="w-[60px] text-right" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((u) => {
              const bal = Number(u.ai_balance_usd)
              return (
                <TableRow key={u.id}>
                  <TableCell className="font-medium">{u.email}</TableCell>
                  <TableCell>{u.full_name}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {clubName.get(u.club_id) ?? '—'}
                  </TableCell>
                  <TableCell>
                    {u.is_workspace_admin ? (
                      <Badge tone="violet">Admin</Badge>
                    ) : (
                      <span className="text-muted-foreground">Member</span>
                    )}
                  </TableCell>
                  <TableCell className="tabular text-right">
                    {bal <= 0.01 ? (
                      <Badge tone="red">{formatUsd(bal)}</Badge>
                    ) : bal <= 0.5 ? (
                      <Badge tone="amber">{formatUsd(bal)}</Badge>
                    ) : (
                      formatUsd(bal)
                    )}
                  </TableCell>
                  <TableCell className="tabular text-right text-muted-foreground">
                    {u.total_ai_tokens_used.toLocaleString('en-US')}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{formatDate(u.created_at)}</TableCell>
                  <TableCell className="text-right">
                    <Link
                      href={`/users/${u.id}`}
                      className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                    >
                      Manage <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
