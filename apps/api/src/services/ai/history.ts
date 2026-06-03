/**
 * history — pure helpers for chat session history & compaction (no I/O, so they
 * are unit-testable in isolation).
 *
 *  - deriveTitle: a human session title from the first user message.
 *  - buildSummaryPrompt: the instructions used to compress older turns into a
 *    concise running summary when the conversation is compacted.
 */

import type { ChatTurn } from '@headroom/shared'

const CONTEXT_PREFIX = '[CONTEXT]'

/** Title from the first user message — its context label, or a truncation. */
export function deriveTitle(content: string): string {
  if (content.startsWith(CONTEXT_PREFIX)) {
    const firstLine = content.slice(CONTEXT_PREFIX.length).split('\n')[0]?.trim()
    if (firstLine) return firstLine.slice(0, 60)
  }
  const text = content.trim().replace(/\s+/g, ' ')
  return text.length > 60 ? `${text.slice(0, 60)}…` : text || 'New chat'
}

export interface SummaryPrompt {
  system: string
  user: string
}

/**
 * Build the prompt that folds older turns (and any prior summary) into a single
 * concise running summary. Deterministic instructions, conservative length —
 * the summary must preserve continuity without becoming a second transcript.
 */
export function buildSummaryPrompt(turns: ChatTurn[], priorSummary?: string | null): SummaryPrompt {
  const transcript = turns
    .map((t) => `${t.role === 'user' ? 'User' : 'Analyst'}: ${t.content}`)
    .join('\n\n')

  const system =
    'You compress a financial-compliance chat into a brief running summary that preserves continuity for the assistant. ' +
    'Capture: what the user asked about, the key figures and compliance conclusions discussed, and any decisions or open threads. ' +
    'Be factual and concise (at most ~180 words). Do not add new analysis, advice, or numbers that were not present. ' +
    'Keep domain terms and acronyms exactly as written (e.g. "SCR", "SSR") — never expand or reinterpret them. ' +
    'Output only the summary prose — no preamble, no headings.'

  const user =
    (priorSummary?.trim() ? `Existing summary so far:\n${priorSummary.trim()}\n\n` : '') +
    `New conversation turns to fold in:\n${transcript}\n\n` +
    'Return the updated, consolidated summary.'

  return { system, user }
}
