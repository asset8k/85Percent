'use client'

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { initializeAnalytics, trackPageView } from '@/lib/analytics'

/** Explicit pageviews avoid duplicate capture while keeping App Router navigation visible. */
export function AnalyticsTracker() {
  const pathname = usePathname()

  useEffect(() => {
    void initializeAnalytics()
    trackPageView(pathname)
  }, [pathname])

  return null
}
