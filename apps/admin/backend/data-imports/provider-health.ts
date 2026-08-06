import { DataImportError, toDataImportError } from './errors'

const REQUIRED_ADAPTER_PATHS = [
  '/clubs/{club_id}/profile',
  '/clubs/{club_id}/players',
] as const

function adapterOpenApiUrl(): string {
  const base = (process.env['TRANSFERMARKT_API_URL'] ?? 'http://localhost:8000').replace(/\/+$/, '')
  return `${base}/openapi.json`
}

/**
 * Verify the local adapter process, not a live provider scrape. Live upstream
 * requests are performed and reported on the individual import task so a
 * transient provider failure cannot block creation of a durable import run.
 */
export async function assertSquadProviderReady(): Promise<void> {
  try {
    const response = await fetch(adapterOpenApiUrl(), {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(5_000),
    })
    if (!response.ok) {
      throw new DataImportError('PROVIDER_UNAVAILABLE', `Adapter health check returned HTTP ${response.status}`, true)
    }
    const document = await response.json() as { paths?: Record<string, unknown> }
    const paths = document.paths ?? {}
    if (REQUIRED_ADAPTER_PATHS.some((path) => !(path in paths))) {
      throw new DataImportError('INVALID_PROVIDER_RESPONSE', 'Adapter does not expose the required squad routes')
    }
  } catch (error) {
    const safe = toDataImportError(error)
    if (safe.code === 'INVALID_PROVIDER_RESPONSE') throw safe
    throw new DataImportError('PROVIDER_UNAVAILABLE', safe.message, true, safe.retryAfterSeconds)
  }
}
