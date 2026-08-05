import { ZodError } from 'zod'

export type DataImportErrorCode =
  | 'PROVIDER_RATE_LIMITED'
  | 'PROVIDER_UNAVAILABLE'
  | 'CLUB_MAPPING_MISSING'
  | 'INVALID_PROVIDER_RESPONSE'
  | 'AMBIGUOUS_PLAYER_MATCH'
  | 'IMPORT_WRITE_FAILED'
  | 'IMPORT_CANCELLED'
  | 'IMPORT_TASK_NOT_CLAIMED'
  | 'IMPORT_INTERRUPTED'
  | 'IMPORT_CONFIGURATION_INVALID'

const SAFE_MESSAGES: Record<DataImportErrorCode, string> = {
  PROVIDER_RATE_LIMITED: 'The data provider rate-limited this request. It can be retried.',
  PROVIDER_UNAVAILABLE: 'The data provider is currently unavailable. It can be retried.',
  CLUB_MAPPING_MISSING: 'The club could not be matched to the external provider.',
  INVALID_PROVIDER_RESPONSE: 'The provider returned incomplete or invalid data.',
  AMBIGUOUS_PLAYER_MATCH: 'A player could not be matched safely and requires review.',
  IMPORT_WRITE_FAILED: 'The imported changes could not be saved safely.',
  IMPORT_CANCELLED: 'The import was cancelled before this task started.',
  IMPORT_TASK_NOT_CLAIMED: 'This task was already completed, cancelled, or claimed by another worker.',
  IMPORT_INTERRUPTED: 'The local import worker stopped before this task finished. Retry the task to continue.',
  IMPORT_CONFIGURATION_INVALID: 'The import service is not configured correctly.',
}

export class DataImportError extends Error {
  constructor(
    public readonly code: DataImportErrorCode,
    message?: string,
    public readonly retryable = false,
    public readonly retryAfterSeconds?: number,
    private readonly safeMessageOverride?: string,
  ) {
    super(message ?? SAFE_MESSAGES[code])
    this.name = 'DataImportError'
  }

  get safeMessage(): string {
    return this.safeMessageOverride ?? SAFE_MESSAGES[this.code]
  }
}

export function toDataImportError(error: unknown): DataImportError {
  if (error instanceof DataImportError) return error
  if (error instanceof ZodError) {
    return new DataImportError('INVALID_PROVIDER_RESPONSE', error.message)
  }
  const message = error instanceof Error ? error.message : String(error)
  return new DataImportError('IMPORT_WRITE_FAILED', message, true)
}
