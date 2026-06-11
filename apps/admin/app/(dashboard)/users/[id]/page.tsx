import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ArrowLeft } from 'lucide-react'
import { getUser } from '@/lib/users'
import { formatUsd, formatDate } from '@/lib/format'
import { updateProfile, resetPassword, adjustBalance, deleteUser } from '@/app/actions/users'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Input, Label } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ConfirmSubmit } from '@/components/confirm-submit'
import { Flash } from '@/components/flash'

export const metadata: Metadata = { title: 'User' }
export const dynamic = 'force-dynamic'

export default async function UserDetailPage({
  params,
  searchParams,
}: {
  params: { id: string }
  searchParams: { flash?: string; msg?: string }
}) {
  const result = await getUser(params.id)
  if (!result) notFound()
  const { user: u, clubName } = result
  const bal = Number(u.ai_balance_usd)

  return (
    <div className="max-w-3xl">
      <Link
        href="/users"
        className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> All users
      </Link>

      <header className="mb-6">
        <h1 className="text-xl font-semibold tracking-tight">{u.full_name || u.email}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {u.email} · {clubName ?? 'no club'} · joined {formatDate(u.created_at)}
        </p>
      </header>

      <Flash kind={searchParams.flash} message={searchParams.msg} />

      <div className="space-y-5">
        <Card>
          <CardHeader>
            <CardTitle>AI chat balance</CardTitle>
            <p className="tabular text-2xl font-semibold">
              {bal <= 0.01 ? <Badge tone="red">{formatUsd(bal)}</Badge> : formatUsd(bal)}
            </p>
            <p className="text-xs text-muted-foreground">
              {u.total_ai_tokens_used.toLocaleString('en-US')} tokens used to date.
            </p>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <form action={adjustBalance} className="space-y-2">
              <input type="hidden" name="id" value={u.id} />
              <input type="hidden" name="mode" value="topup" />
              <Label>Top up (add USD)</Label>
              <Input name="amount" type="number" step="0.01" min="0" placeholder="5.00" />
              <Button type="submit" size="sm">
                Add credit
              </Button>
            </form>
            <form action={adjustBalance} className="space-y-2">
              <input type="hidden" name="id" value={u.id} />
              <input type="hidden" name="mode" value="set" />
              <Label>Set exact balance (USD)</Label>
              <Input name="amount" type="number" step="0.01" min="0" placeholder={bal.toFixed(2)} />
              <Button type="submit" size="sm" variant="outline">
                Set balance
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Profile</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={updateProfile} className="space-y-4">
              <input type="hidden" name="id" value={u.id} />
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label>Full name</Label>
                  <Input name="fullName" defaultValue={u.full_name} />
                </div>
                <div>
                  <Label>Email</Label>
                  <Input name="email" type="email" defaultValue={u.email} />
                </div>
              </div>
              <Button type="submit" size="sm">
                Save profile
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Reset password</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={resetPassword} className="flex items-end gap-3">
              <input type="hidden" name="id" value={u.id} />
              <div className="flex-1">
                <Label>New password (min 8 chars)</Label>
                <Input name="password" type="text" placeholder="new password" />
              </div>
              <Button type="submit" size="sm" variant="outline">
                Set password
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card className="border-destructive/30">
          <CardHeader>
            <CardTitle className="text-destructive">Delete account</CardTitle>
            <p className="text-xs text-muted-foreground">
              Removes the auth login and this user&apos;s scenarios, activity, notifications and chat
              history. Does not delete the club (other members may remain).
            </p>
          </CardHeader>
          <CardContent>
            <form action={deleteUser}>
              <input type="hidden" name="id" value={u.id} />
              <ConfirmSubmit
                variant="destructive"
                size="sm"
                message={`Permanently delete ${u.email}? This cannot be undone.`}
              >
                Delete this account
              </ConfirmSubmit>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
