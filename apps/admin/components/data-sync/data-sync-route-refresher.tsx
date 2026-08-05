'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Data Sync is operational data: its run and provider states can change while
 * the operator is elsewhere in the admin panel. Refresh the Server Component
 * payload after client-side navigation and when the tab becomes active again.
 */
export function DataSyncRouteRefresher() {
  const router = useRouter()

  useEffect(() => {
    const refresh = () => router.refresh()

    refresh()
    window.addEventListener('focus', refresh)
    window.addEventListener('pageshow', refresh)

    return () => {
      window.removeEventListener('focus', refresh)
      window.removeEventListener('pageshow', refresh)
    }
  }, [router])

  return null
}
