import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { isAuthed } from '@/lib/session'
import { login } from '@/app/actions/auth'
import { Card } from '@/components/ui/card'
import { Input, Label } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Flash } from '@/components/flash'

export const metadata: Metadata = { title: 'Sign in' }

// Depends on the session cookie (to bounce an already-authed admin to the inbox).
export const dynamic = 'force-dynamic'

export default function LoginPage({ searchParams }: { searchParams: { error?: string } }) {
  if (isAuthed()) redirect('/leads')

  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 px-6">
      <Card className="w-full max-w-sm p-7 shadow-sm">
        <div className="mb-5">
          <div className="mb-4 flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-xs font-bold text-primary-foreground">
              85
            </span>
            <span className="text-sm font-semibold tracking-tight">85Percent Admin</span>
          </div>
          <h1 className="text-lg font-semibold tracking-tight">Sign in</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Manage inbound leads, accounts and manual data imports.
          </p>
        </div>

        {searchParams.error && (
          <Flash kind="err" message="Invalid username or password." />
        )}

        <form action={login} className="space-y-4">
          <div>
            <Label htmlFor="username">Username</Label>
            <Input id="username" name="username" autoComplete="username" autoFocus required />
          </div>
          <div>
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
            />
          </div>
          <Button type="submit" className="w-full">
            Sign in
          </Button>
        </form>
      </Card>
    </main>
  )
}
