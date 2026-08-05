import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { estimateRemainingSeconds, selectVisibleClubIds, toggleClubSelection } from '../../components/data-sync/ui-model'

describe('data-sync UI model', () => {
  it('limits select-visible and reports a blocked extra selection', () => {
    const clubs = Array.from({ length: 12 }, (_, index) => ({ id: String(index) }))
    const selected = selectVisibleClubIds(clubs, 10)
    assert.equal(selected.size, 10)
    const blocked = toggleClubSelection(selected, '11', 10)
    assert.equal(blocked.limitReached, true)
    assert.deepEqual(blocked.selection, selected)
  })

  it('estimates remaining time only after two observed task durations', () => {
    assert.equal(estimateRemainingSeconds([{ status: 'SUCCEEDED', duration_ms: 1000 }], 2), null)
    assert.equal(estimateRemainingSeconds([
      { status: 'SUCCEEDED', duration_ms: 10_000 },
      { status: 'FAILED', duration_ms: 20_000 },
      { status: 'RUNNING' }, { status: 'QUEUED' }, { status: 'QUEUED' },
    ], 2), 30)
  })
})
