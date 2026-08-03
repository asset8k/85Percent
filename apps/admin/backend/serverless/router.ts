import type {
  ApiApp,
  ApiReply,
  ApiRequest,
  PreHandler,
} from './types'
import { checkApiRateLimit } from './rate-limit'

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
type RouteHandler = (
  request: ApiRequest,
  reply: ApiReply,
) => unknown | Promise<unknown>

interface RouteOptions {
  preHandler?: PreHandler | PreHandler[]
  config?: { rateLimit?: { max: number; timeWindow: string } }
}

interface RouteDefinition {
  method: HttpMethod
  path: string
  regex: RegExp
  paramNames: string[]
  preHandlers: PreHandler[]
  handler: RouteHandler
  rateLimit: { max: number; timeWindow: string }
}

interface Registry {
  routes: RouteDefinition[]
}

const GLOBAL_RATE = { max: 100, timeWindow: '1 minute' }

function compilePath(path: string): { regex: RegExp; paramNames: string[] } {
  const paramNames: string[] = []
  const pattern = path
    .split('/')
    .map((segment) => {
      if (!segment.startsWith(':')) return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      paramNames.push(segment.slice(1))
      return '([^/]+)'
    })
    .join('/')
  return { regex: new RegExp(`^${pattern}/?$`), paramNames }
}

function logger() {
  const write = (level: 'error' | 'warn' | 'info', context: unknown, message?: string) => {
    const detail = context instanceof Error
      ? { name: context.name, message: context.message }
      : context
    console[level](message ?? 'API request log', detail)
  }
  return {
    error: (context: unknown, message?: string) => write('error', context, message),
    warn: (context: unknown, message?: string) => write('warn', context, message),
    info: (context: unknown, message?: string) => write('info', context, message),
  }
}

class ServerlessReply implements ApiReply {
  statusCode = 200
  payload: unknown
  sent = false

  status(code: number): ApiReply {
    this.statusCode = code
    return this
  }

  send(payload?: unknown): ApiReply {
    this.payload = payload
    this.sent = true
    return this
  }

  toResponse(fallback: unknown): Response {
    const payload = this.sent ? this.payload : fallback
    if (payload instanceof Response) return payload
    if (payload === undefined) return new Response(null, { status: this.statusCode })
    return Response.json(payload, {
      status: this.statusCode,
      headers: {
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      },
    })
  }
}

function clientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')
  if (forwarded) return forwarded.split(',')[0]!.trim()
  return request.headers.get('x-real-ip') ?? 'unknown'
}

async function parseBody(request: Request): Promise<unknown> {
  if (request.method === 'GET' || request.method === 'HEAD') return undefined
  const text = await request.text()
  if (!text) return undefined
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new SyntaxError('Invalid JSON request body')
  }
}

function queryObject(url: URL): Record<string, string> {
  return Object.fromEntries(url.searchParams.entries())
}

function headerObject(headers: Headers): Record<string, string> {
  return Object.fromEntries(headers.entries())
}

export class ServerlessApp implements ApiApp {
  private readonly registry: Registry
  private readonly hooks: PreHandler[]

  constructor(registry: Registry = { routes: [] }, hooks: PreHandler[] = []) {
    this.registry = registry
    this.hooks = hooks
  }

  addHook(name: 'preHandler', hook: PreHandler): void {
    if (name === 'preHandler') this.hooks.push(hook)
  }

  async register(plugin: (instance: ApiApp) => unknown | Promise<unknown>): Promise<void> {
    const scoped = new ServerlessApp(this.registry, [...this.hooks])
    await plugin(scoped)
  }

  get<T = unknown>(path: string, optionsOrHandler: unknown, handler?: RouteHandler): void {
    this.route('GET', path, optionsOrHandler, handler)
  }

  post<T = unknown>(path: string, optionsOrHandler: unknown, handler?: RouteHandler): void {
    this.route('POST', path, optionsOrHandler, handler)
  }

  put<T = unknown>(path: string, optionsOrHandler: unknown, handler?: RouteHandler): void {
    this.route('PUT', path, optionsOrHandler, handler)
  }

  patch<T = unknown>(path: string, optionsOrHandler: unknown, handler?: RouteHandler): void {
    this.route('PATCH', path, optionsOrHandler, handler)
  }

  delete<T = unknown>(path: string, optionsOrHandler: unknown, handler?: RouteHandler): void {
    this.route('DELETE', path, optionsOrHandler, handler)
  }

  routeManifest(): Array<{ method: HttpMethod; path: string }> {
    return this.registry.routes.map(({ method, path }) => ({ method, path }))
  }

  private route(
    method: HttpMethod,
    path: string,
    optionsOrHandler: unknown,
    maybeHandler?: RouteHandler,
  ): void {
    const options = (maybeHandler ? optionsOrHandler : {}) as RouteOptions
    const handler = (maybeHandler ?? optionsOrHandler) as RouteHandler
    const local = options.preHandler
      ? Array.isArray(options.preHandler) ? options.preHandler : [options.preHandler]
      : []
    const compiled = compilePath(path)
    const scenarioRate = method === 'POST' && path === '/scenarios'
      ? { max: 30, timeWindow: '1 minute' }
      : undefined
    this.registry.routes.push({
      method,
      path,
      ...compiled,
      preHandlers: [...this.hooks, ...local],
      handler,
      rateLimit: options.config?.rateLimit ?? scenarioRate ?? GLOBAL_RATE,
    })
  }

  async dispatch(request: Request, pathname: string): Promise<Response> {
    const method = request.method.toUpperCase() as HttpMethod
    let matched: { route: RouteDefinition; values: RegExpMatchArray } | null = null
    for (const route of this.registry.routes) {
      if (route.method !== method) continue
      const values = pathname.match(route.regex)
      if (values) {
        matched = { route, values }
        break
      }
    }
    if (!matched) return Response.json({ error: 'Not found' }, { status: 404 })

    const { route, values } = matched
    const rateState = await checkApiRateLimit(
      clientIp(request),
      `${method.toLowerCase()}:${route.path.replace(/[^a-z0-9]+/gi, '-')}`,
      route.rateLimit,
    )
    if (rateState === 'limited') {
      return Response.json({ error: 'Too many requests' }, { status: 429 })
    }
    if (rateState === 'unconfigured' && process.env['NODE_ENV'] === 'production') {
      return Response.json({ error: 'API rate limiter is not configured' }, { status: 503 })
    }

    const params = Object.fromEntries(
      route.paramNames.map((name, index) => [name, decodeURIComponent(values[index + 1] ?? '')]),
    )
    const url = new URL(request.url)
    let body: unknown
    try {
      body = await parseBody(request)
    } catch {
      return Response.json({ error: 'Invalid JSON request body' }, { status: 400 })
    }

    const apiRequest = {
      headers: headerObject(request.headers),
      body,
      query: queryObject(url),
      params,
      log: logger(),
      userId: '',
      clubId: '',
      permissions: {
        canEditRoster: false,
        canEditScenarios: false,
        isWorkspaceAdmin: false,
      },
    } as ApiRequest
    const reply = new ServerlessReply()

    try {
      for (const preHandler of route.preHandlers) {
        await preHandler(apiRequest, reply)
        if (reply.sent) return reply.toResponse(undefined)
      }
      const result = await route.handler(apiRequest, reply)
      return reply.toResponse(result)
    } catch (error) {
      apiRequest.log.error(error, `Unhandled ${method} ${route.path}`)
      return Response.json({ error: 'Internal server error' }, { status: 500 })
    }
  }
}
