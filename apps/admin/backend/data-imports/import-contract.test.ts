import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'
import { fileURLToPath } from 'node:url'
import { validateImportedSquadSnapshot, importedPlayerSchema, importedSquadSnapshotSchema } from './types'
import { toDataImportError } from './errors'

describe('import safety contract', () => {
  it('strips unsupported financial fields and distinguishes missing source data from an explicit DTO field', () => {
    const parsed = importedPlayerSchema.parse({
      provider: 'fixture', externalId: '1', name: 'Player', position: 'MID', squadNumber: null,
      nationality: null, dateOfBirth: null, joinedDate: null, contractStart: null, contractEnd: null,
      sourceFields: ['name'], weeklyWage: 0, transferFee: 0, bookValue: 0, agentFee: 0,
    })
    assert.equal('weeklyWage' in parsed, false)
    assert.equal('transferFee' in parsed, false)
    assert.deepEqual(parsed.sourceFields, ['name'])
  })

  it('rejects suspiciously partial and duplicate-ID squad responses', () => {
    const make = (count: number) => importedSquadSnapshotSchema.parse({
      provider: 'fixture', externalClubId: 'club', clubName: 'Club', competition: 'PREMIER_LEAGUE' as const,
      season: '2026', logoUrl: null, coach: null, retrievedAt: '2026-08-05T00:00:00.000Z',
      players: Array.from({ length: count }, (_, index) => ({
        provider: 'fixture', externalId: String(index), name: `Player ${index}`, position: 'MID' as const,
        squadNumber: null, nationality: null, dateOfBirth: null, joinedDate: null,
        contractStart: null, contractEnd: null, sourceFields: ['name'],
      })),
    })
    assert.throws(() => validateImportedSquadSnapshot(make(10)), /only 10/)
    const duplicate = make(11)
    duplicate.players[10]!.externalId = '1'
    assert.throws(() => validateImportedSquadSnapshot(duplicate), /duplicate player ID/)
  })

  it('keeps application and standings publication inside database functions', () => {
    const migration = readFileSync(fileURLToPath(new URL('../../prisma/migrations/20260805000003_manual_data_imports/migration.sql', import.meta.url)), 'utf8')
    assert.match(migration, /FUNCTION apply_template_import_task/)
    assert.match(migration, /estimated_transfer_fee, contract_start/)
    assert.match(migration, /c\.entity_type='COACH', NULL,/)
    assert.doesNotMatch(migration, /SET[\s\S]{0,500}(weekly_wage|transfer_fee|book_value|agent_fee)=/i)
    assert.match(migration, /FUNCTION publish_league_snapshot/)
    assert.match(migration, /UPDATE league_table_snapshots SET is_active=false/)
    assert.match(migration, /INSERT INTO league_table_snapshots/)
    assert.match(migration, /data_import_tasks_one_active_club_idx/)
    assert.match(migration, /data_import_tasks_one_active_competition_idx/)
    assert.match(migration, /AND t\.status = 'QUEUED'/)
  })

  it('qualifies the import-run timestamps in the task-claim database function', () => {
    const migration = readFileSync(fileURLToPath(new URL('../../prisma/migrations/20260805190000_fix_import_task_claim_function/migration.sql', import.meta.url)), 'utf8')
    assert.match(migration, /COALESCE\(run\.started_at, now\(\)\)/)
  })

  it('does not disguise validation and persistence failures as provider outages', () => {
    const validation = importedPlayerSchema.safeParse({})
    assert.equal(validation.success, false)
    if (!validation.success) assert.equal(toDataImportError(validation.error).code, 'INVALID_PROVIDER_RESPONSE')
    assert.equal(toDataImportError(new Error('database unavailable')).code, 'IMPORT_WRITE_FAILED')
  })
})
