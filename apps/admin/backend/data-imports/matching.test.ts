import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { importedPlayerSchema, type ImportedCoach, type InternalRosterItem } from './types'
import { normaliseIdentity, reconcileCoach, reconcilePlayers } from './matching'

const player: InternalRosterItem = {
  id: 'player-1', templateClubId: 'club-1', name: 'Joao Felix', dateOfBirth: '1999-11-10',
  nationality: 'Portugal', position: 'FWD', squadNumber: 14, isManager: false,
  contractStart: '2024-07-01', contractEnd: '2029-06-30', joinedDate: '2024-07-01',
}

describe('squad reconciliation', () => {
  it('normalises accents but never fuzzy-matches a different name', () => {
    assert.equal(normaliseIdentity('João Félix FC'), 'joao felix')
    const imported = importedPlayerSchema.parse({
      provider: 'fixture', externalId: 'external-1', name: 'Joao Felis', position: 'FWD',
      squadNumber: 14, nationality: 'Portugal', dateOfBirth: null, joinedDate: null,
      contractStart: null, contractEnd: null, sourceFields: ['name', 'position', 'squadNumber'],
    })
    const changes = reconcilePlayers([imported], [player], [])
    assert.equal(changes[0]?.changeType, 'ADD')
    assert.equal(changes[1]?.changeType, 'MISSING')
    assert.equal(changes[1]?.status, 'NEEDS_REVIEW')
  })

  it('uses a provider mapping first and patches only returned public fields', () => {
    const imported = importedPlayerSchema.parse({
      provider: 'fixture', externalId: 'external-1', name: 'João Félix', position: 'MID',
      squadNumber: null, nationality: null, dateOfBirth: null, joinedDate: null,
      contractStart: null, contractEnd: '2030-06-30', sourceFields: ['name', 'position', 'contractEnd'],
      weeklyWage: 0, transferFee: 0, bookValue: 0, agentFee: 0,
    })
    const [change] = reconcilePlayers([imported], [player], [{
      provider: 'fixture', entityType: 'PLAYER', internalId: player.id,
      externalId: 'external-1', templateClubId: 'club-1',
    }])
    assert.equal(change?.changeType, 'UPDATE')
    assert.deepEqual(change?.afterData, { name: 'João Félix', position: 'MID', contractEnd: '2030-06-30' })
    assert.deepEqual(Object.keys(change?.afterData ?? {}).sort(), ['contractEnd', 'name', 'position'])
  })

  it('sends a changed head coach to review instead of replacing them', () => {
    const coach: InternalRosterItem = { ...player, id: 'coach-1', name: 'Old Coach', position: null, squadNumber: null, isManager: true }
    const imported: ImportedCoach = {
      provider: 'fixture', externalId: 'coach-external', name: 'New Coach', nationality: null,
      dateOfBirth: null, contractStart: null, contractEnd: null, sourceFields: ['name'],
    }
    const [change] = reconcileCoach(imported, [coach], [])
    assert.equal(change?.changeType, 'CONFLICT')
    assert.equal(change?.status, 'NEEDS_REVIEW')
    assert.equal(change?.internalEntityId, coach.id)
  })

  it('does not auto-create a provider player already mapped to another club', () => {
    const imported = importedPlayerSchema.parse({
      provider: 'fixture', externalId: 'external-1', name: 'Transferred Player', position: 'FWD',
      squadNumber: 9, nationality: 'England', dateOfBirth: '2000-01-01', joinedDate: null,
      contractStart: null, contractEnd: null, sourceFields: ['name', 'position', 'squadNumber'],
    })
    const [change] = reconcilePlayers([imported], [player], [{
      provider: 'fixture', entityType: 'PLAYER', internalId: 'other-player',
      externalId: 'external-1', templateClubId: 'other-club',
    }], 'club-1')
    assert.equal(change?.changeType, 'CONFLICT')
    assert.equal(change?.status, 'NEEDS_REVIEW')
    assert.equal(change?.internalEntityId, null)
    assert.deepEqual(change?.beforeData, {
      mappedInternalId: 'other-player',
      mappedTemplateClubId: 'other-club',
    })
    assert.match(change?.reason ?? '', /another stored club/)
  })
})
