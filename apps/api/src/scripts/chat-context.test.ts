/**
 * Tests for the shared chat-context / compaction helpers (@headroom/shared).
 * Run via: pnpm --filter @headroom/api test:scripts
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  estimateTokens,
  estimateContextTokens,
  contextUsageRatio,
  shouldCompact,
  planCompaction,
  CONTEXT_TOKEN_LIMIT,
  COMPACT_TRIGGER_RATIO,
  KEEP_RECENT_TURNS,
  MIN_TURNS_TO_COMPACT,
  type ChatTurn,
} from '@headroom/shared'

const turn = (role: 'user' | 'assistant', content: string): ChatTurn => ({ role, content })
/** Build n alternating turns, each `size` chars long. */
function turns(n: number, size = 40): ChatTurn[] {
  return Array.from({ length: n }, (_, i) =>
    turn(i % 2 === 0 ? 'user' : 'assistant', 'x'.repeat(size)),
  )
}

test('estimateTokens: ~4 chars per token, empty is 0', () => {
  assert.equal(estimateTokens(''), 0)
  assert.equal(estimateTokens('abcd'), 1)
  assert.equal(estimateTokens('abcde'), 2) // ceil(5/4)
  assert.equal(estimateTokens('x'.repeat(400)), 100)
})

test('estimateContextTokens: sums turns + per-message overhead + summary', () => {
  const t = [turn('user', 'x'.repeat(40)), turn('assistant', 'x'.repeat(40))]
  // 10 tokens each + 4 overhead each = 28, plus summary tokens
  assert.equal(estimateContextTokens(t), 28)
  assert.equal(estimateContextTokens(t, 'x'.repeat(40)), 28 + 10)
})

test('contextUsageRatio: proportional below the limit, clamped to 1 above', () => {
  assert.equal(contextUsageRatio([]), 0)
  const small = contextUsageRatio(turns(2))
  assert.ok(small > 0 && small < 1)
  // A huge conversation clamps to 1.
  assert.equal(contextUsageRatio(turns(50, 2000)), 1)
})

test('shouldCompact: false until both the count AND token thresholds are crossed', () => {
  // Too few turns — never compact, even if individually large.
  assert.equal(shouldCompact(turns(MIN_TURNS_TO_COMPACT - 1, 4000)), false)

  // Enough turns but tiny content — under the token threshold.
  assert.equal(shouldCompact(turns(MIN_TURNS_TO_COMPACT, 4)), false)

  // Enough turns AND over the token threshold — compact.
  const big = turns(MIN_TURNS_TO_COMPACT + 8, 2000)
  assert.equal(
    estimateContextTokens(big) >= CONTEXT_TOKEN_LIMIT * COMPACT_TRIGGER_RATIO,
    true,
    'fixture should exceed the trigger',
  )
  assert.equal(shouldCompact(big), true)
})

test('shouldCompact: a large running summary counts toward the budget', () => {
  const fewTurns = turns(MIN_TURNS_TO_COMPACT, 4)
  assert.equal(shouldCompact(fewTurns, ''), false)
  // But the count guard still holds even with a big summary if turns are few...
  // give it enough turns so only the summary tips it over.
  const enough = turns(MIN_TURNS_TO_COMPACT, 10)
  const bigSummary = 'x'.repeat(CONTEXT_TOKEN_LIMIT * 4)
  assert.equal(shouldCompact(enough, bigSummary), true)
})

test('planCompaction: keeps the last KEEP_RECENT_TURNS, summarises the rest, preserves order', () => {
  const all = turns(10).map((t, i) => ({ ...t, id: `m${i}` }))
  const plan = planCompaction(all)
  assert.equal(plan.keep.length, KEEP_RECENT_TURNS)
  assert.equal(plan.toSummarize.length, 10 - KEEP_RECENT_TURNS)
  // keep are the LAST KEEP_RECENT, in order
  assert.deepEqual(
    plan.keep.map((m) => m.id),
    all.slice(all.length - KEEP_RECENT_TURNS).map((m) => m.id),
  )
  // toSummarize are the earlier ones, in order
  assert.deepEqual(
    plan.toSummarize.map((m) => m.id),
    all.slice(0, all.length - KEEP_RECENT_TURNS).map((m) => m.id),
  )
})

test('planCompaction: nothing to summarise when at/under KEEP_RECENT_TURNS', () => {
  const few = turns(KEEP_RECENT_TURNS)
  const plan = planCompaction(few)
  assert.equal(plan.toSummarize.length, 0)
  assert.equal(plan.keep.length, KEEP_RECENT_TURNS)
})

test('no-thrash: the kept set after a compaction does not immediately re-trigger', () => {
  const big = turns(MIN_TURNS_TO_COMPACT + 10, 2000)
  assert.equal(shouldCompact(big), true)
  const { keep } = planCompaction(big)
  // keep.length === KEEP_RECENT_TURNS < MIN_TURNS_TO_COMPACT → cannot compact again
  assert.equal(keep.length < MIN_TURNS_TO_COMPACT, true)
  assert.equal(shouldCompact(keep), false)
})

test('compaction substantially reduces context usage (ring drops toward empty)', () => {
  // A long conversation of biggish turns that is over the compaction trigger.
  const convo = turns(MIN_TURNS_TO_COMPACT + 12, 2000).map((t, i) => ({ ...t, id: `m${i}` }))
  const before = contextUsageRatio(convo)
  assert.ok(before >= COMPACT_TRIGGER_RATIO, `before should exceed the trigger, got ${before}`)

  const { keep } = planCompaction(convo)
  // After compaction the ring shows: a small running summary + the kept turns.
  const summary = 'x'.repeat(250 * 4) // ~250 tokens — the summariser's target cap
  const after = contextUsageRatio(keep, summary)

  // Issue #2: the ring must drop close to empty, not barely move (100 → 79).
  assert.ok(after < 0.35, `post-compaction usage should be low, got ${after}`)
  assert.ok(after < before / 2, 'compaction should at least halve the usage')
})
