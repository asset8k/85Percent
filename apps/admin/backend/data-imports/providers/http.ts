import { getDataImportConfig } from '../config'
import { DataImportError } from '../errors'

const RETRYABLE_STATUS = new Set([405, 408, 425, 429, 500, 502, 503, 504])

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function retryAfterSeconds(response: Response): number | undefined {
  const raw = response.headers.get('retry-after')
  if (!raw) return undefined
  const seconds = Number(raw)
  if (Number.isFinite(seconds) && seconds >= 0) return seconds
  const date = Date.parse(raw)
  return Number.isFinite(date) ? Math.max(0, Math.ceil((date - Date.now()) / 1000)) : undefined
}

export async function providerFetch(
  url: string,
  init: RequestInit = {},
  attempts = getDataImportConfig().maxTaskAttempts,
): Promise<Response> {
  const { requestTimeoutMs, retryBaseMs } = getDataImportConfig()
  let lastError: unknown

  for (let attempt = 0; attempt < attempts; attempt++) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), requestTimeoutMs)
    try {
      const response = await fetch(url, { ...init, signal: controller.signal })
      if (response.ok) return response

      const retryAfter = retryAfterSeconds(response)
      if (response.status === 429) {
        lastError = new DataImportError('PROVIDER_RATE_LIMITED', `HTTP 429 from ${url}`, true, retryAfter)
      } else if (RETRYABLE_STATUS.has(response.status)) {
        lastError = new DataImportError('PROVIDER_UNAVAILABLE', `HTTP ${response.status} from ${url}`, true, retryAfter)
      } else {
        throw new DataImportError('INVALID_PROVIDER_RESPONSE', `HTTP ${response.status} from ${url}`)
      }
    } catch (error) {
      if (error instanceof DataImportError && !error.retryable) throw error
      if (error instanceof Error && error.name === 'AbortError') {
        lastError = new DataImportError('PROVIDER_UNAVAILABLE', `Provider request timed out: ${url}`, true)
      } else {
        lastError = error
      }
    } finally {
      clearTimeout(timer)
    }

    if (attempt + 1 < attempts) {
      const retryAfter = lastError instanceof DataImportError ? lastError.retryAfterSeconds : undefined
      await sleep(retryAfter != null ? retryAfter * 1000 : retryBaseMs * 2 ** attempt)
    }
  }

  if (lastError instanceof DataImportError) throw lastError
  throw new DataImportError('PROVIDER_UNAVAILABLE', String(lastError), true)
}

export async function providerJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await providerFetch(url, init)
  try {
    return (await response.json()) as T
  } catch (error) {
    throw new DataImportError('INVALID_PROVIDER_RESPONSE', `Invalid JSON from ${url}: ${String(error)}`)
  }
}

export async function providerText(url: string, init?: RequestInit): Promise<string> {
  return (await providerFetch(url, init)).text()
}
