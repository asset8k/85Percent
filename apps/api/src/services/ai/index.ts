/**
 * AI service layer — the single entry point for LLM inference.
 *
 * The calculation engine must NEVER be called from within LLM handlers. LLMs
 * read the engine's already-computed output and explain it; they never do the
 * arithmetic themselves.
 *
 * `llm` is the app-wide LLMService singleton. Swapping providers (Gemini/GPT)
 * is a one-line change here: implement a new adapter against LLMService and
 * assign it below.
 */

import { AnthropicAdapter } from './anthropic-adapter.js'
import type { LLMService } from './types.js'

export const llm: LLMService = new AnthropicAdapter()

export type {
  LLMService,
  LLMStream,
  StreamChatParams,
  CompleteParams,
  ChatMessage,
  ChatUsage,
  ChatFinishResult,
} from './types.js'
export { buildSystemPrompt, type RetrievedPassage, type SystemPromptOptions } from './system-prompt.js'
export { deriveTitle, buildSummaryPrompt, type SummaryPrompt } from './history.js'
export { KNOWLEDGE_SOURCE_URL, KNOWLEDGE_SOURCE_LABEL } from './knowledge-source.js'
