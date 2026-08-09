import type {
  ImportedCoach,
  ImportedPlayer,
  InternalRosterItem,
  ProposedImportChange,
  SourceMapping,
} from './types'

export function normaliseIdentity(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\b(fc|afc|football club)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
}

function publicData(item: InternalRosterItem): Record<string, unknown> {
  return {
    name: item.name,
    position: item.position,
    squadNumber: item.squadNumber,
    nationality: item.nationality,
    dateOfBirth: item.dateOfBirth,
    joinedDate: item.joinedDate,
    contractStart: item.contractStart,
    contractEnd: item.contractEnd,
  }
}

function sourcePatch(imported: ImportedPlayer | ImportedCoach): Record<string, unknown> {
  const patch: Record<string, unknown> = {}
  for (const field of imported.sourceFields) {
    const value = imported[field as keyof typeof imported]
    if (value != null) patch[field] = value
  }
  return patch
}

function changedPatch(item: InternalRosterItem, imported: ImportedPlayer | ImportedCoach) {
  const source = sourcePatch(imported)
  const patch: Record<string, unknown> = {}
  for (const [field, value] of Object.entries(source)) {
    if (field === 'name' || field === 'position' || field === 'squadNumber' || field === 'nationality' ||
        field === 'dateOfBirth' || field === 'joinedDate' || field === 'contractStart' || field === 'contractEnd') {
      if (item[field as keyof InternalRosterItem] !== value) patch[field] = value
    }
  }
  return patch
}

function mappingMatch(
  imported: ImportedPlayer | ImportedCoach,
  entityType: 'PLAYER' | 'COACH',
  items: InternalRosterItem[],
  mappings: SourceMapping[],
): InternalRosterItem | null {
  if (!imported.externalId) return null
  const mapping = mappings.find((candidate) =>
    candidate.provider === imported.provider &&
    candidate.entityType === entityType &&
    candidate.externalId === imported.externalId,
  )
  return mapping ? (items.find((item) => item.id === mapping.internalId) ?? null) : null
}

function exactCandidates(imported: ImportedPlayer, items: InternalRosterItem[]): InternalRosterItem[] {
  const name = normaliseIdentity(imported.name)
  const sameName = items.filter((item) => !item.isManager && normaliseIdentity(item.name) === name)
  if (imported.dateOfBirth) {
    const sameDob = sameName.filter((item) => item.dateOfBirth === imported.dateOfBirth)
    if (sameDob.length) return sameDob
  }
  return sameName.filter((item) => {
    let supporting = 0
    if (imported.position && item.position === imported.position) supporting++
    if (imported.squadNumber && item.squadNumber === imported.squadNumber) supporting++
    if (imported.nationality && item.nationality && normaliseIdentity(item.nationality) === normaliseIdentity(imported.nationality)) supporting++
    return supporting >= 2
  })
}

function changeForMatch(
  item: InternalRosterItem,
  imported: ImportedPlayer | ImportedCoach,
  entityType: 'PLAYER' | 'COACH',
): ProposedImportChange {
  const patch = changedPatch(item, imported)
  const dobConflict = imported.dateOfBirth != null && item.dateOfBirth != null && imported.dateOfBirth !== item.dateOfBirth
  if (dobConflict) {
    return {
      entityType, changeType: 'CONFLICT', status: 'NEEDS_REVIEW', internalEntityId: item.id,
      externalEntityId: imported.externalId, beforeData: publicData(item), afterData: sourcePatch(imported),
      reason: 'The provider date of birth conflicts with the stored identity.',
    }
  }
  return {
    entityType,
    changeType: Object.keys(patch).length ? 'UPDATE' : 'UNCHANGED',
    status: 'AUTO_APPLY',
    internalEntityId: item.id,
    externalEntityId: imported.externalId,
    beforeData: publicData(item),
    afterData: Object.keys(patch).length ? patch : null,
    reason: null,
  }
}

export function reconcilePlayers(
  importedPlayers: ImportedPlayer[],
  internalItems: InternalRosterItem[],
  mappings: SourceMapping[],
  templateClubId?: string,
): ProposedImportChange[] {
  const players = internalItems.filter((item) => !item.isManager)
  const currentTemplateClubId = templateClubId ?? internalItems[0]?.templateClubId
  const matched = new Set<string>()
  const changes: ProposedImportChange[] = []

  for (const imported of importedPlayers) {
    const mappedElsewhere = imported.externalId
      ? mappings.find((candidate) => candidate.provider === imported.provider
        && candidate.entityType === 'PLAYER'
        && candidate.externalId === imported.externalId
        && candidate.templateClubId !== currentTemplateClubId)
      : null
    if (mappedElsewhere) {
      changes.push({
        entityType: 'PLAYER', changeType: 'CONFLICT', status: 'NEEDS_REVIEW',
        // Cross-club transfers require a separate roster decision. Never make
        // the old club's record an approvable update target.
        internalEntityId: null, externalEntityId: imported.externalId,
        beforeData: {
          mappedInternalId: mappedElsewhere.internalId,
          mappedTemplateClubId: mappedElsewhere.templateClubId,
        },
        afterData: sourcePatch(imported),
        reason: 'This provider player is mapped to another stored club. A transfer requires review.',
      })
      continue
    }
    const mapped = mappingMatch(imported, 'PLAYER', players, mappings)
    const candidates = mapped ? [mapped] : exactCandidates(imported, players)
    if (candidates.length === 1 && candidates[0]) {
      matched.add(candidates[0].id)
      changes.push(changeForMatch(candidates[0], imported, 'PLAYER'))
    } else if (candidates.length > 1) {
      changes.push({
        entityType: 'PLAYER', changeType: 'CONFLICT', status: 'NEEDS_REVIEW', internalEntityId: null,
        externalEntityId: imported.externalId, beforeData: null, afterData: sourcePatch(imported),
        reason: 'Multiple stored players match the provider identity.',
      })
    } else {
      changes.push({
        entityType: 'PLAYER', changeType: 'ADD', status: 'AUTO_APPLY', internalEntityId: null,
        externalEntityId: imported.externalId, beforeData: null, afterData: sourcePatch(imported),
        reason: 'New provider-identified player. Financial data remains unconfigured.',
      })
    }
  }

  for (const player of players) {
    if (!matched.has(player.id)) {
      changes.push({
        // A missing player means they left the squad since the last sync.
        // This is never a human decision, so it must not sit in the
        // reviewer's action queue — auto-apply it (the roster row is
        // removed) and just surface it as information.
        entityType: 'PLAYER', changeType: 'MISSING', status: 'AUTO_APPLY', internalEntityId: player.id,
        externalEntityId: null, beforeData: publicData(player), afterData: null,
        reason: 'The player was not present in this source response and was removed from the roster.',
      })
    }
  }
  return changes
}

export function reconcileCoach(
  imported: ImportedCoach | null,
  internalItems: InternalRosterItem[],
  mappings: SourceMapping[],
): ProposedImportChange[] {
  const coaches = internalItems.filter((item) => item.isManager)
  if (!imported) return []
  const mapped = mappingMatch(imported, 'COACH', coaches, mappings)
  const sameName = coaches.filter((coach) => normaliseIdentity(coach.name) === normaliseIdentity(imported.name))
  const match = mapped ?? (sameName.length === 1 ? sameName[0]! : null)
  if (match) return [changeForMatch(match, imported, 'COACH')]
  if (coaches.length === 0) {
    return [{
      entityType: 'COACH', changeType: 'ADD', status: 'AUTO_APPLY', internalEntityId: null,
      externalEntityId: imported.externalId, beforeData: null, afterData: sourcePatch(imported), reason: null,
    }]
  }
  return [{
    entityType: 'COACH', changeType: 'CONFLICT', status: 'NEEDS_REVIEW', internalEntityId: coaches[0]!.id,
    externalEntityId: imported.externalId, beforeData: publicData(coaches[0]!), afterData: sourcePatch(imported),
    reason: 'The imported head coach differs from the stored coach. Replacement requires review.',
  }]
}
