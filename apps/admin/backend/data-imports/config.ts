export const DATA_IMPORT_DEFAULTS = {
  maxClubsPerRun: 10,
  maxConcurrentClubTasks: 2,
  maxTaskAttempts: 3,
  requestTimeoutMs: 20_000,
  retryBaseMs: 1_500,
} as const

export type DataImportDispatchMode = 'local' | 'qstash'

function positiveInt(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const value = Number(raw)
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`)
  }
  return value
}

export function getDataImportConfig() {
  return {
    maxClubsPerRun: positiveInt('DATA_IMPORT_MAX_CLUBS_PER_RUN', DATA_IMPORT_DEFAULTS.maxClubsPerRun),
    maxConcurrentClubTasks: positiveInt(
      'DATA_IMPORT_MAX_CONCURRENT_TASKS',
      DATA_IMPORT_DEFAULTS.maxConcurrentClubTasks,
    ),
    maxTaskAttempts: positiveInt('DATA_IMPORT_MAX_TASK_ATTEMPTS', DATA_IMPORT_DEFAULTS.maxTaskAttempts),
    requestTimeoutMs: positiveInt('DATA_IMPORT_REQUEST_TIMEOUT_MS', DATA_IMPORT_DEFAULTS.requestTimeoutMs),
    retryBaseMs: positiveInt('DATA_IMPORT_RETRY_BASE_MS', DATA_IMPORT_DEFAULTS.retryBaseMs),
  }
}

export function getDataImportDispatchMode(): DataImportDispatchMode {
  const mode = process.env['DATA_IMPORT_DISPATCH_MODE']?.trim() || (process.env['QSTASH_TOKEN'] ? 'qstash' : 'local')
  if (mode !== 'local' && mode !== 'qstash') throw new Error('DATA_IMPORT_DISPATCH_MODE must be local or qstash')
  if (mode === 'local' && process.env['NODE_ENV'] === 'production') {
    throw new Error('Local data-import dispatch is not permitted in production')
  }
  if (mode === 'qstash' && !process.env['QSTASH_TOKEN']) throw new Error('QSTASH_TOKEN is required when DATA_IMPORT_DISPATCH_MODE=qstash')
  return mode
}

export function deriveSeasonStartYear(now = new Date()): string {
  const year = now.getUTCFullYear()
  return String(now.getUTCMonth() >= 6 ? year : year - 1)
}
