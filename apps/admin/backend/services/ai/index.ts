/**
 * AI service layer — the single entry point for LLM inference.
 *
 * The calculation engine must NEVER be called from within LLM handlers. LLMs
 * read the engine's already-computed output and explain it; they never do the
 * arithmetic themselves.
 *
 * `llm` is the app-wide LLMService singleton. Provider-specific code stays in
 * its adapter; routes and UI use only this shared contract.
 */

import { OpenAIAdapter } from './openai-adapter'
import type { LLMService } from './types'

export const llm: LLMService = new OpenAIAdapter()

export type {
  LLMService,
  LLMStream,
  StreamChatParams,
  CompleteParams,
  ChatMessage,
  ChatUsage,
  ChatFinishResult,
} from './types'
export { buildSystemPrompt, type RetrievedPassage, type SystemPromptOptions } from './system-prompt'
export { deriveTitle, buildSummaryPrompt, type SummaryPrompt } from './history'
export { KNOWLEDGE_SOURCE_URL, KNOWLEDGE_SOURCE_LABEL } from './knowledge-source'
