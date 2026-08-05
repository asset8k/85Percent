import { z } from 'zod'

export const competitionSchema = z.enum(['PREMIER_LEAGUE', 'CHAMPIONSHIP'])
export type ImportCompetition = z.infer<typeof competitionSchema>

export const importedPositionSchema = z.enum(['GK', 'DEF', 'MID', 'FWD'])
export type ImportedPosition = z.infer<typeof importedPositionSchema>

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const sourceField = z.enum([
  'name',
  'position',
  'squadNumber',
  'nationality',
  'dateOfBirth',
  'joinedDate',
  'contractStart',
  'contractEnd',
])

export const importedPlayerSchema = z.object({
  provider: z.string().min(1),
  externalId: z.string().min(1).nullable(),
  name: z.string().trim().min(1),
  position: importedPositionSchema.nullable(),
  squadNumber: z.number().int().min(1).max(99).nullable(),
  nationality: z.string().trim().min(1).nullable(),
  dateOfBirth: isoDate.nullable(),
  joinedDate: isoDate.nullable(),
  contractStart: isoDate.nullable(),
  contractEnd: isoDate.nullable(),
  sourceFields: z.array(sourceField),
})
export type ImportedPlayer = z.infer<typeof importedPlayerSchema>

export const importedCoachSchema = z.object({
  provider: z.string().min(1),
  externalId: z.string().min(1).nullable(),
  name: z.string().trim().min(1),
  nationality: z.string().trim().min(1).nullable(),
  dateOfBirth: isoDate.nullable(),
  contractStart: isoDate.nullable(),
  contractEnd: isoDate.nullable(),
  sourceFields: z.array(sourceField),
})
export type ImportedCoach = z.infer<typeof importedCoachSchema>

export const importedSquadSnapshotSchema = z.object({
  provider: z.string().min(1),
  externalClubId: z.string().min(1),
  clubName: z.string().min(1),
  competition: competitionSchema,
  season: z.string().min(1),
  logoUrl: z.string().url().nullable(),
  players: z.array(importedPlayerSchema).min(1),
  coach: importedCoachSchema.nullable(),
  retrievedAt: z.string().datetime(),
})
export type ImportedSquadSnapshot = z.infer<typeof importedSquadSnapshotSchema>

export function validateImportedSquadSnapshot(snapshot: ImportedSquadSnapshot): ImportedSquadSnapshot {
  if (snapshot.players.length < 11) {
    throw new Error(`Squad response contained only ${snapshot.players.length} players`)
  }
  const externalIds = new Set<string>()
  for (const player of snapshot.players) {
    if (!player.externalId) continue
    if (externalIds.has(player.externalId)) {
      throw new Error(`Squad response contained duplicate player ID ${player.externalId}`)
    }
    externalIds.add(player.externalId)
  }
  return snapshot
}

export const importedStandingSchema = z.object({
  externalClubId: z.string().min(1),
  team: z.string().min(1),
  shortName: z.string().min(1),
  crest: z.string().url().nullable(),
  position: z.number().int().positive(),
  played: z.number().int().nonnegative(),
  won: z.number().int().nonnegative(),
  drawn: z.number().int().nonnegative(),
  lost: z.number().int().nonnegative(),
  goalsFor: z.number().int(),
  goalsAgainst: z.number().int(),
  goalDifference: z.number().int(),
  points: z.number().int(),
})
export type ImportedStanding = z.infer<typeof importedStandingSchema>

export const importedStandingsSnapshotSchema = z.object({
  provider: z.string().min(1),
  competition: competitionSchema,
  leagueId: z.enum(['premier-league', 'efl-championship']),
  competitionName: z.string().min(1),
  season: z.string().min(1),
  standings: z.array(importedStandingSchema),
  retrievedAt: z.string().datetime(),
})
export type ImportedStandingsSnapshot = z.infer<typeof importedStandingsSnapshotSchema>

export interface SquadProvider {
  readonly name: string
  discoverClubs(competition: ImportCompetition, season: string): Promise<Array<{
    externalClubId: string
    name: string
  }>>
  fetchClubSquad(input: {
    externalClubId: string
    competition: ImportCompetition
    season: string
  }): Promise<ImportedSquadSnapshot>
}

export interface StandingsProvider {
  readonly name: string
  fetchStandings(input: {
    competition: ImportCompetition
    season: string
  }): Promise<ImportedStandingsSnapshot>
}

export type ImportEntityType = 'PLAYER' | 'COACH' | 'CLUB' | 'STANDING'
export type ImportChangeType = 'ADD' | 'UPDATE' | 'UNCHANGED' | 'MISSING' | 'CONFLICT'
export type ImportChangeStatus = 'AUTO_APPLY' | 'NEEDS_REVIEW'

export interface ProposedImportChange {
  entityType: ImportEntityType
  changeType: ImportChangeType
  status: ImportChangeStatus
  internalEntityId: string | null
  externalEntityId: string | null
  beforeData: Record<string, unknown> | null
  afterData: Record<string, unknown> | null
  reason: string | null
}

export interface InternalRosterItem {
  id: string
  templateClubId: string
  name: string
  dateOfBirth: string | null
  nationality: string | null
  position: ImportedPosition | null
  squadNumber: number | null
  isManager: boolean
  contractStart: string | null
  contractEnd: string | null
  joinedDate: string | null
}

export interface SourceMapping {
  provider: string
  entityType: 'CLUB' | 'PLAYER' | 'COACH'
  internalId: string
  externalId: string
  templateClubId: string | null
}
