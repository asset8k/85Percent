import { requireSession } from '@/lib/session'
import { TopNav } from '@/components/top-nav'

/** Every screen in this group is gated; unauthenticated requests bounce to /login. */
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  requireSession()
  return (
    <div className="min-h-screen">
      <TopNav />
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  )
}
