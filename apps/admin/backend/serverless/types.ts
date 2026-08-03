import type { Permissions } from '../middleware/permissions'

export interface ApiLogger {
  error(context: unknown, message?: string): void
  warn(context: unknown, message?: string): void
  info(context: unknown, message?: string): void
}

export interface ApiRequest {
  headers: Record<string, string | undefined> & { authorization?: string }
  body: unknown
  query: unknown
  params: unknown
  log: ApiLogger
  userId: string
  clubId: string
  permissions: Permissions
}

export interface ApiReply {
  status(code: number): ApiReply
  send(payload?: unknown): ApiReply
}

export type PreHandler = (
  request: ApiRequest,
  reply: ApiReply,
) => unknown | Promise<unknown>

export type ApiRouteHandler = (
  request: ApiRequest,
  reply: ApiReply,
) => unknown | Promise<unknown>

export interface ApiApp {
  addHook(name: 'preHandler', hook: PreHandler): void
  register(plugin: (instance: ApiApp) => unknown | Promise<unknown>): Promise<void>
  get<RouteGeneric = unknown>(path: string, handler: ApiRouteHandler): void
  get<RouteGeneric = unknown>(path: string, options: unknown, handler: ApiRouteHandler): void
  post<RouteGeneric = unknown>(path: string, handler: ApiRouteHandler): void
  post<RouteGeneric = unknown>(path: string, options: unknown, handler: ApiRouteHandler): void
  put<RouteGeneric = unknown>(path: string, handler: ApiRouteHandler): void
  put<RouteGeneric = unknown>(path: string, options: unknown, handler: ApiRouteHandler): void
  patch<RouteGeneric = unknown>(path: string, handler: ApiRouteHandler): void
  patch<RouteGeneric = unknown>(path: string, options: unknown, handler: ApiRouteHandler): void
  delete<RouteGeneric = unknown>(path: string, handler: ApiRouteHandler): void
  delete<RouteGeneric = unknown>(path: string, options: unknown, handler: ApiRouteHandler): void
}
