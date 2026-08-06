/**
 * aiPricing — token-cost maths for the Compliance Analyst's prepaid credit
 * system. Pure functions, no I/O, so they are trivially unit-testable.
 *
 * Pricing is for OpenAI GPT-5.6 Luna, quoted per 1,000,000 tokens. We charge
 * the raw token cost plus a fixed margin. This is the only place the margin and
 * per-token rates live — the chat route imports `calculateQueryCost`.
 */

/** GPT-5.6 Luna input price, USD per 1M tokens. */
export const INPUT_PRICE_PER_1M = 1.0
/** GPT-5.6 Luna output price, USD per 1M tokens. */
export const OUTPUT_PRICE_PER_1M = 6.0
/** Our markup over raw token cost (10%). */
export const MARGIN_MULTIPLIER = 1.1

/**
 * The USD amount to debit for one query, given the tokens it consumed.
 *
 * cost = (inputTokens/1M · inputRate + outputTokens/1M · outputRate) · margin
 *
 * Negative / non-finite token counts are treated as 0 (defensive — usage stats
 * should never be negative). The result is rounded to 6 dp so we hand the
 * NUMERIC(10,4) balance column a clean number rather than a long binary float
 * like 0.0148500000001; the database rounds the stored balance to 4 dp.
 */
export function calculateQueryCost(inputTokens: number, outputTokens: number): number {
  const safeIn = Number.isFinite(inputTokens) && inputTokens > 0 ? inputTokens : 0
  const safeOut = Number.isFinite(outputTokens) && outputTokens > 0 ? outputTokens : 0

  const baseCostUsd =
    (safeIn / 1_000_000) * INPUT_PRICE_PER_1M + (safeOut / 1_000_000) * OUTPUT_PRICE_PER_1M
  const withMargin = baseCostUsd * MARGIN_MULTIPLIER

  return Math.round(withMargin * 1_000_000) / 1_000_000
}
