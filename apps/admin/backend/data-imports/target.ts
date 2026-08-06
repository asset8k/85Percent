import { AsyncLocalStorage } from 'node:async_hooks'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { DataImportError } from './errors'
import { getDataImportDispatchMode } from './config'

export interface DataImportTarget {
  id: string
  label: string
  isProduction: boolean
}

interface ResolvedTarget extends DataImportTarget {
  url: string
  serviceRoleKey: string
}

const context = new AsyncLocalStorage<SupabaseClient>()
const clients = new Map<string, SupabaseClient>()

function targetIds(): string[] {
  const configured = process.env['DATA_IMPORT_TARGETS']?.split(',').map((value) => value.trim()).filter(Boolean)
  return configured?.length ? configured : ['dev']
}

function envPart(id: string): string {
  return id.toUpperCase().replace(/[^A-Z0-9]/g, '_')
}

function firstConfigured(...values: Array<string | undefined>): string | undefined {
  return values.find((value) => value?.trim())
}

function resolveTarget(id: string): ResolvedTarget {
  if (!targetIds().includes(id)) throw new DataImportError('IMPORT_CONFIGURATION_INVALID', `Unknown data-import target: ${id}`)
  const part = envPart(id)
  const usesPrimaryCredentials = id === 'default' || id === 'dev'
  const url = usesPrimaryCredentials
    ? firstConfigured(process.env['SUPABASE_DEV_URL'], process.env['SUPABASE_URL'])
    : firstConfigured(process.env[`SUPABASE_${part}_URL`], process.env[`DATA_IMPORT_TARGET_${part}_SUPABASE_URL`])
  const serviceRoleKey = usesPrimaryCredentials
    ? firstConfigured(
        process.env['SUPABASE_DEV_SECRET_KEY'],
        process.env['SUPABASE_DEV_SERVICE_ROLE_KEY'],
        process.env['SUPABASE_SERVICE_ROLE_KEY'],
      )
    : firstConfigured(
        process.env[`SUPABASE_${part}_SECRET_KEY`],
        process.env[`SUPABASE_${part}_SERVICE_ROLE_KEY`],
        process.env[`DATA_IMPORT_TARGET_${part}_SUPABASE_SERVICE_ROLE_KEY`],
      )
  if (!url || !serviceRoleKey) {
    throw new DataImportError('IMPORT_CONFIGURATION_INVALID', `Data-import target ${id} is missing Supabase credentials`)
  }
  return {
    id,
    label: process.env[`DATA_IMPORT_TARGET_${part}_LABEL`] ?? (usesPrimaryCredentials ? process.env['DATA_IMPORT_TARGET_LABEL'] ?? 'Development' : id),
    isProduction: id.toLowerCase() === 'prod' || process.env[`DATA_IMPORT_TARGET_${part}_IS_PRODUCTION`] === 'true',
    url,
    serviceRoleKey,
  }
}

export function getDefaultDataImportTargetId(): string {
  return process.env['DATA_IMPORT_DEFAULT_TARGET']?.trim() || 'dev'
}

export function getDataImportTargets(): DataImportTarget[] {
  const ids = getDataImportDispatchMode() === 'qstash' ? [getDefaultDataImportTargetId()] : targetIds()
  return ids.map((id) => getDataImportTarget(id))
}

export function getDataImportTarget(id?: string): DataImportTarget {
  const { url: _url, serviceRoleKey: _serviceRoleKey, ...target } = resolveTarget(id ?? getDefaultDataImportTargetId())
  return target
}

export function getDataImportDatabase(targetId?: string): SupabaseClient {
  const target = resolveTarget(targetId ?? getDefaultDataImportTargetId())
  const existing = clients.get(target.id)
  if (existing) return existing
  const client = createClient(target.url, target.serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } })
  clients.set(target.id, client)
  return client
}

export function getScopedDataImportDatabase(): SupabaseClient {
  const client = context.getStore()
  return client ?? getDataImportDatabase()
}

export async function withDataImportTarget<T>(targetId: string | undefined, callback: () => Promise<T>): Promise<T> {
  return context.run(getDataImportDatabase(targetId), callback)
}
