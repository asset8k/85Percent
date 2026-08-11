import type { CaptureResult } from 'posthog-js'

type AnalyticsProperties = Record<string, unknown>

type PostHogClient = typeof import('posthog-js').default

const SENSITIVE_QUERY_PARAMS = new Set([
  'token',
  'access_token',
  'refresh_token',
  'auth',
  'email',
  'code',
])

const POSTHOG_KEY = import.meta.env.VITE_POSTHOG_KEY
const POSTHOG_HOST = import.meta.env.VITE_POSTHOG_HOST || 'https://us.i.posthog.com'
const POSTHOG_ENABLED = import.meta.env.VITE_POSTHOG_ENABLED === 'true'
const POSTHOG_ENVIRONMENT = import.meta.env.VITE_POSTHOG_ENVIRONMENT
const PRODUCTION_HOST = 'app.85percent.pro'

type AnalyticsEnvironment = 'development' | 'production'

let client: PostHogClient | null = null
let initialization: Promise<PostHogClient | null> | null = null
let pendingCalls: Array<(posthog: PostHogClient) => void> = []
let lastIdentity: string | null = null
let lastPageViewKey: string | null = null

function canCaptureAnalytics(): boolean {
  if (!POSTHOG_ENABLED || !POSTHOG_KEY || typeof window === 'undefined') return false

  if (POSTHOG_ENVIRONMENT === 'production') {
    return window.location.protocol === 'https:' && window.location.hostname === PRODUCTION_HOST
  }

  return POSTHOG_ENVIRONMENT === 'development'
    && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
}

function analyticsEnvironment(): AnalyticsEnvironment | null {
  return POSTHOG_ENVIRONMENT === 'development' || POSTHOG_ENVIRONMENT === 'production'
    ? POSTHOG_ENVIRONMENT
    : null
}

export function sanitizeAnalyticsUrl(value: string): string {
  try {
    const url = new URL(value, window.location.origin)
    for (const key of [...url.searchParams.keys()]) {
      if (SENSITIVE_QUERY_PARAMS.has(key.toLowerCase())) url.searchParams.delete(key)
    }
    url.hash = ''
    return url.toString()
  } catch {
    return value.split('#', 1)[0] ?? value
  }
}

function sanitizeCapture(result: CaptureResult | null): CaptureResult | null {
  if (!result) return null
  const properties = { ...result.properties }
  for (const key of ['$current_url', '$referrer', '$initial_current_url', '$session_entry_url', '$external_click_url']) {
    if (typeof properties[key] === 'string') properties[key] = sanitizeAnalyticsUrl(properties[key] as string)
  }
  return { ...result, properties }
}

function invoke(call: (posthog: PostHogClient) => void) {
  if (!canCaptureAnalytics()) return
  if (client) {
    call(client)
    return
  }
  pendingCalls.push(call)
  void initializeAnalytics()
}

/** Loads PostHog lazily so it never delays the initial product paint. */
export function initializeAnalytics(): Promise<PostHogClient | null> {
  const posthogKey = POSTHOG_KEY
  if (!posthogKey || !canCaptureAnalytics()) return Promise.resolve(null)
  if (client) return Promise.resolve(client)
  if (initialization) return initialization

  initialization = import('posthog-js')
    .then(({ default: posthog }) => {
      posthog.init(posthogKey, {
        api_host: POSTHOG_HOST,
        capture_pageview: false,
        autocapture: false,
        rageclick: false,
        cross_subdomain_cookie: true,
        persistence: 'localStorage+cookie',
        disable_capture_url_hashes: true,
        get_current_url: sanitizeAnalyticsUrl,
        before_send: sanitizeCapture,
        session_recording: {
          maskAllInputs: true,
          maskTextSelector: '.ph-sensitive, .ph-sensitive *',
          blockClass: 'ph-no-capture',
        },
      })
      posthog.register({ deployment_environment: analyticsEnvironment() })
      client = posthog
      const queued = pendingCalls
      pendingCalls = []
      queued.forEach((call) => call(posthog))
      return posthog
    })
    .catch(() => {
      pendingCalls = []
      return null
    })

  return initialization
}

export function trackAnalytics(event: string, properties: AnalyticsProperties = {}) {
  invoke((posthog) => posthog.capture(event, properties))
}

export function trackPageView(pathname: string, navigationKey: string) {
  if (lastPageViewKey === navigationKey) return
  lastPageViewKey = navigationKey
  trackAnalytics('$pageview', {
    $current_url: sanitizeAnalyticsUrl(window.location.href),
    $pathname: pathname,
  })
}

export function identifyAnalytics(
  userId: string,
  properties: { email?: string; clubId?: string | null; clubName?: string | null; league?: string | null },
) {
  const identityKey = JSON.stringify([userId, properties.email, properties.clubId, properties.clubName, properties.league])
  if (lastIdentity === identityKey) return
  lastIdentity = identityKey
  invoke((posthog) => posthog.identify(userId, {
    deployment_environment: analyticsEnvironment(),
    ...(properties.email ? { email: properties.email } : {}),
    ...(properties.clubId ? { club_id: properties.clubId } : {}),
    ...(properties.clubName ? { club_name: properties.clubName } : {}),
    ...(properties.league ? { league: properties.league } : {}),
  }))
}

export function resetAnalytics() {
  lastIdentity = null
  if (client) client.reset()
}
