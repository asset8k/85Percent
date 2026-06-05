/**
 * Tests for the prompt + history helpers (system prompt, title derivation,
 * summary prompt). Pure functions — imported directly so no env/SDK is loaded.
 * Run via: pnpm --filter @headroom/api test:scripts
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildSystemPrompt, type RetrievedPassage } from '../services/ai/system-prompt.js'
import { deriveTitle, buildSummaryPrompt } from '../services/ai/history.js'
import { KNOWLEDGE_SOURCE_URL } from '../services/ai/knowledge-source.js'
import type { ChatTurn } from '@headroom/shared'

const passage = (content: string): RetrievedPassage => ({ content, source_url: KNOWLEDGE_SOURCE_URL, similarity: 0.9 })

test('buildSystemPrompt: carries identity, product, domain, modules and guardrails', () => {
  const p = buildSystemPrompt([passage('The SCR ceiling is 85% of revenue.')])
  assert.match(p, /85Percent Compliance Analyst/)
  // Product + domain framing
  assert.match(p, /Squad Cost Ratio/)
  assert.match(p, /85%/)
  // Module awareness (so injected context is interpretable)
  assert.match(p, /Dashboard/)
  assert.match(p, /Roster/)
  assert.match(p, /Scenarios/)
  // Guardrails — not a legal advisor, source attribution, verify Handbook
  assert.match(p, /NOT a legally binding/)
  assert.match(p, /not yet published/)
  assert.ok(p.includes(KNOWLEDGE_SOURCE_URL))
  // Never recompute the engine numbers
  assert.match(p, /[Nn]ever do the arithmetic/)
  // The retrieved passage is embedded
  assert.match(p, /The SCR ceiling is 85% of revenue\./)
})

test('buildSystemPrompt: empty retrieval is stated, not faked', () => {
  const p = buildSystemPrompt([])
  assert.match(p, /No relevant passages/)
})

test('buildSystemPrompt: includes the compaction summary when provided', () => {
  const p = buildSystemPrompt([passage('x')], { summary: 'User asked about Haaland amortisation.' })
  assert.match(p, /EARLIER CONVERSATION SUMMARY/)
  assert.match(p, /Haaland amortisation/)
  // And omits the block when absent
  assert.equal(/EARLIER CONVERSATION SUMMARY/.test(buildSystemPrompt([passage('x')])), false)
})

test('deriveTitle: plain text is trimmed/truncated, long text gets an ellipsis', () => {
  assert.equal(deriveTitle('  What is SCR?  '), 'What is SCR?')
  assert.equal(deriveTitle(''), 'New chat')
  const long = 'a'.repeat(100)
  const title = deriveTitle(long)
  assert.equal(title.length, 61) // 60 chars + ellipsis
  assert.ok(title.endsWith('…'))
})

test('deriveTitle: a context-injection message yields its label, not the JSON', () => {
  const injected = '[CONTEXT] Dashboard\nContext from the Dashboard. ...\n\n{ "currentSCR": "82%" }'
  assert.equal(deriveTitle(injected), 'Dashboard')
  const withSubject = '[CONTEXT] Roster · Erling Haaland\nContext from the Roster...'
  assert.equal(deriveTitle(withSubject), 'Roster · Erling Haaland')
})

test('buildSummaryPrompt: transcript labelling + prior-summary merge', () => {
  const t: ChatTurn[] = [
    { role: 'user', content: 'Are we compliant?' },
    { role: 'assistant', content: 'Your SCR is 82%, inside the Green zone.' },
  ]
  const { system, user } = buildSummaryPrompt(t)
  assert.match(system, /summary/i)
  assert.match(system, /concise|180 words/i)
  assert.match(user, /User: Are we compliant\?/)
  assert.match(user, /Analyst: Your SCR is 82%/)
  // Without a prior summary, no "Existing summary" preamble.
  assert.equal(/Existing summary so far/.test(user), false)

  const merged = buildSummaryPrompt(t, 'Earlier: discussed revenue inputs.')
  assert.match(merged.user, /Existing summary so far:/)
  assert.match(merged.user, /discussed revenue inputs/)
})
