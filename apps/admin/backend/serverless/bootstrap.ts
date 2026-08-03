import type { ApiApp } from './types'
import { clubRoutes } from '../routes/club'
import { rosterRoutes } from '../routes/roster'
import { scenarioRoutes } from '../routes/scenarios'
import { ssrRoutes } from '../routes/ssr'
import { inviteRoutes } from '../routes/invites'
import { auditRoutes } from '../routes/audit'
import { onboardingRoutes } from '../routes/onboarding'
import { authRoutes } from '../routes/auth'
import { notificationRoutes } from '../routes/notifications'
import { leagueTableRoutes } from '../routes/league-table'
import { chatRoutes } from '../routes/chat'
import { adminJobRoutes } from '../routes/admin-jobs'
import { ServerlessApp } from './router'

let routerPromise: Promise<ServerlessApp> | null = null

async function buildRouter(): Promise<ServerlessApp> {
  const router = new ServerlessApp()
  const app = router as unknown as ApiApp

  await router.register(clubRoutes)
  await router.register(rosterRoutes)
  await router.register(scenarioRoutes)
  await router.register(ssrRoutes)
  await router.register(inviteRoutes)
  await router.register(auditRoutes)
  await router.register(onboardingRoutes)
  await router.register(authRoutes)
  await router.register(notificationRoutes)
  await router.register(leagueTableRoutes)
  await router.register(chatRoutes)
  await router.register(adminJobRoutes)
  app.get('/health', async () => ({ status: 'ok', ts: new Date().toISOString() }))

  return router
}

export function getApiRouter(): Promise<ServerlessApp> {
  routerPromise ??= buildRouter()
  return routerPromise
}
