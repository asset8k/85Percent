import { getApiRouter } from '@/backend/serverless/bootstrap'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

interface RouteContext {
  params: { path: string[] }
}

async function handle(request: Request, context: RouteContext): Promise<Response> {
  const router = await getApiRouter()
  return router.dispatch(request, `/${context.params.path.join('/')}`)
}

export const GET = handle
export const POST = handle
export const PUT = handle
export const PATCH = handle
export const DELETE = handle
