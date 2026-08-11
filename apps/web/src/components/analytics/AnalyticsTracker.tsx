import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { initializeAnalytics, trackAnalytics, trackPageView } from '@/lib/analytics'

const PRODUCT_PAGE_EVENTS: Record<string, string> = {
  '/dashboard': 'dashboard_viewed',
  '/roster': 'roster_viewed',
  '/scenarios': 'scenario_viewed',
  '/financials': 'financials_viewed',
  '/ssr': 'ssr_tests_viewed',
  '/rules': 'rules_viewed',
  '/onboarding': 'onboarding_started',
}

/** One explicit SPA pageview per navigation; automatic PostHog pageviews stay off. */
export function AnalyticsTracker() {
  const location = useLocation()

  useEffect(() => {
    void initializeAnalytics()
    trackPageView(location.pathname, location.key)
    const productEvent = PRODUCT_PAGE_EVENTS[location.pathname]
    if (productEvent) trackAnalytics(productEvent)
  }, [location.key, location.pathname])

  return null
}
