import { DataImportError, toDataImportError } from './errors'
import { deriveSeasonStartYear } from './config'
import { TransfermarktSquadProvider } from './providers/transfermarkt'

export async function assertSquadProviderReady(season = deriveSeasonStartYear()): Promise<void> {
  try {
    const clubs = await new TransfermarktSquadProvider().discoverClubs('PREMIER_LEAGUE', season)
    if (!clubs.length || clubs.some((club) => !club.externalClubId || !club.name.trim())) {
      throw new DataImportError('INVALID_PROVIDER_RESPONSE', 'Provider discovery returned no usable clubs')
    }
  } catch (error) {
    const safe = toDataImportError(error)
    if (safe.code === 'INVALID_PROVIDER_RESPONSE') throw safe
    throw new DataImportError('PROVIDER_UNAVAILABLE', safe.message, true, safe.retryAfterSeconds)
  }
}
