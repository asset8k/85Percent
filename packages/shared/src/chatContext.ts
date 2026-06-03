/**
 * chatContext — pure helpers for the Compliance Analyst's automatic context
 * compaction. Shared by the web client (to size the "compact bar" and decide
 * when to compact) and the API (to plan which turns to summarise), so the two
 * sides can never disagree on the budget.
 *
 * Token counts are estimates (~4 characters per token) — good enough to budget a
 * deliberately conservative context window without pulling in a tokenizer.
 */

export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}

/**
 * Conversation-history budget, in estimated tokens, before we compact. Bounded
 * (so each request stays cheap and cost can't run away) but high enough that a
 * freshly-compacted conversation — a small summary plus the last couple of turns
 * — reads as nearly empty on the context ring, instead of barely moving.
 */
export const CONTEXT_TOKEN_LIMIT = 8000

/** Auto-compact once history reaches this share of the limit. */
export const COMPACT_TRIGGER_RATIO = 0.75

/**
 * Number of most-recent turns kept verbatim after a compaction. Deliberately
 * small — the running summary carries the earlier context, so keeping just the
 * last exchange lets the ring drop close to empty after a compaction.
 */
export const KEEP_RECENT_TURNS = 2

/**
 * Don't compact unless there are clearly more turns than we'd keep — otherwise a
 * couple of large messages could trigger endless re-compaction with nothing to
 * actually summarise.
 */
export const MIN_TURNS_TO_COMPACT = KEEP_RECENT_TURNS + 3

/** Rough per-message framing overhead added on top of content tokens. */
const PER_MESSAGE_OVERHEAD = 4

/** Estimate the token count of a string (~4 chars/token). */
export function estimateTokens(text: string): number {
  if (!text) return 0
  return Math.ceil(text.length / 4)
}

/** Estimate the total context tokens of a conversation (+ any running summary). */
export function estimateContextTokens(turns: ChatTurn[], summary = ''): number {
  let total = estimateTokens(summary)
  for (const t of turns) total += estimateTokens(t.content) + PER_MESSAGE_OVERHEAD
  return total
}

/** Current context usage as a 0..1 fraction of the limit (drives the bar). */
export function contextUsageRatio(turns: ChatTurn[], summary = ''): number {
  if (CONTEXT_TOKEN_LIMIT <= 0) return 0
  return Math.min(1, estimateContextTokens(turns, summary) / CONTEXT_TOKEN_LIMIT)
}

/** Whether the conversation should be auto-compacted now. */
export function shouldCompact(turns: ChatTurn[], summary = ''): boolean {
  if (turns.length < MIN_TURNS_TO_COMPACT) return false
  return estimateContextTokens(turns, summary) >= CONTEXT_TOKEN_LIMIT * COMPACT_TRIGGER_RATIO
}

export interface CompactionPlan<T extends ChatTurn = ChatTurn> {
  /** Older turns to fold into the summary. */
  toSummarize: T[]
  /** Most-recent turns kept verbatim. */
  keep: T[]
}

/**
 * Split a conversation into the part to summarise (older) and the recent part to
 * keep verbatim. When there's nothing meaningful to summarise, `toSummarize` is
 * empty and the caller should skip compaction.
 */
export function planCompaction<T extends ChatTurn>(turns: T[]): CompactionPlan<T> {
  if (turns.length <= KEEP_RECENT_TURNS) return { toSummarize: [], keep: [...turns] }
  const cut = turns.length - KEEP_RECENT_TURNS
  return { toSummarize: turns.slice(0, cut), keep: turns.slice(cut) }
}
