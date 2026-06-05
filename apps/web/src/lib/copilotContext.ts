/**
 * copilotContext — shared contract between the context-aware triggers (Phase 4)
 * and the chat drawer (Phase 3) for "hidden system injection" of engine state.
 *
 * A trigger serializes the current module's deterministic-engine figures into a
 * single user message prefixed with CONTEXT_PREFIX. The chat drawer detects that
 * prefix and renders the message as a compact "Analyzing…" chip (rather than
 * dumping raw JSON), while the full payload still reaches the model so it can
 * produce an immediate breakdown.
 */

/** Public grounding source — mirrored from the API's knowledge-source.ts. */
export const KNOWLEDGE_SOURCE_URL =
  'https://www.premierleague.com/en/news/4467022/new-premier-league-financial-system-explained'
export const KNOWLEDGE_SOURCE_LABEL = 'Nov 2025 Premier League Financial System Explainer'

export const CONTEXT_PREFIX = '[CONTEXT]'

export type CopilotModule = 'Dashboard' | 'Roster' | 'Scenarios'

export interface CopilotContext {
  module: CopilotModule
  /** Optional subject for the chip label, e.g. a player name or scenario name. */
  subject?: string
  /** Engine-computed figures — treated as authoritative ground truth by the LLM. */
  data: Record<string, unknown>
}

/**
 * Per-module analysis brief. Each tab frames what its data is and what a useful
 * answer looks like, so the model produces a focused, decision-grade breakdown
 * rather than a generic restatement of the numbers.
 */
const MODULE_BRIEF: Record<CopilotModule, string> = {
  Dashboard: [
    'This is the live Dashboard — the club\'s current squad-wide Squad Cost Ratio position.',
    'Give me a concise read of where we stand: our SCR vs the 85% Green ceiling and our Red threshold, how much headroom we have (and whether it is shrinking into the Amber/levy or Red/points-deduction zone), the main risks, and the practical levers that would move the ratio.',
  ].join(' '),
  Roster: [
    'This is a single player from the Roster, with the economics that drive their Squad Cost Ratio cost.',
    'Explain how this player contributes to SCR — how wage, transfer-fee amortisation and agent fees combine into their annual cost, how their book value amortises, any contract-expiry implication, and the compliance effect of selling, extending or releasing them — relative to total squad costs.',
  ].join(' '),
  Scenarios: [
    'This is a proposed transfer plan from the Scenario Builder, with its projected impact.',
    'Explain how the proposed transactions move us from the current SCR to the projected SCR: which actions help vs hurt compliance, the resulting zone and risk, and any watch-outs before executing the plan.',
  ].join(' '),
}

/** Build the injected user message that silently primes the conversation. */
export function buildContextInjection({ module, subject, data }: CopilotContext): string {
  const heading = subject ? `${module} · ${subject}` : module
  return `${CONTEXT_PREFIX} ${heading}
Context from the ${module}. ${MODULE_BRIEF[module]}

These figures were computed by the 85Percent engine — treat them as authoritative and do NOT recalculate them. Be specific with the numbers, keep it concise and decision-focused, and flag anything material to verify against the official Handbook.

${JSON.stringify(data, null, 2)}`
}

/**
 * If `content` is an injected context message, return its chip label; otherwise
 * null (a normal user message).
 */
export function parseContextLabel(content: string): string | null {
  if (!content.startsWith(CONTEXT_PREFIX)) return null
  const firstLine = content.slice(CONTEXT_PREFIX.length).split('\n')[0]?.trim()
  return firstLine && firstLine.length > 0 ? firstLine : 'context'
}
