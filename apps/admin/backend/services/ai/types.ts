/**
 * LLMService — provider-agnostic inference seam.
 *
 * Today we run Anthropic (Claude) via the Vercel AI SDK. This interface is the
 * swap point: to move to Gemini/GPT later you implement a new adapter (e.g.
 * GoogleAdapter / OpenAIAdapter) against the SAME contract and change one line
 * in index.ts — no route or UI changes. The AI SDK already abstracts the wire
 * protocol; this interface abstracts the *provider choice* on top of it.
 *
 * Hard rule (mirrors services/ai/index.ts): the LLM never does arithmetic. It
 * reads serialized engine output and explains it in language. All SCR/FFP maths
 * stays in @85percent/engine.
 */

export interface ChatMessage {
  role: 'user' | 'assistant'
  content: string
}

/** Token usage for a completed turn — used for cost accounting / billing. */
export interface ChatUsage {
  promptTokens: number
  completionTokens: number
}

/** Everything known about a completed turn once the stream finishes. */
export interface ChatFinishResult {
  /** The full assistant text. */
  text: string
  /** Tokens consumed by this turn (for cost accounting). */
  usage: ChatUsage
}

export interface StreamChatParams {
  /** Fully-assembled system prompt (guardrails + retrieved RAG context). */
  system: string
  /** Conversation so far, oldest first. */
  messages: ChatMessage[]
  /**
   * Called server-side once the stream completes, with the full assistant text
   * and the turn's token usage. Used to persist the turn to chat history and to
   * debit the user's AI credit balance. Runs independently of the client stream;
   * failures here must not break the response.
   */
  onFinish?: (result: ChatFinishResult) => void | Promise<void>
}

/**
 * A handle to an in-flight streamed completion. Route Handlers return a Web
 * Response using the AI SDK data-stream protocol consumed by `useChat`.
 */
export interface LLMStream {
  toResponse(): Response
}

export interface CompleteParams {
  /** System instructions. */
  system: string
  /** Single user message. */
  user: string
  /** Output cap (default left to the adapter). */
  maxTokens?: number
}

export interface LLMService {
  streamChat(params: StreamChatParams): LLMStream
  /** Non-streaming completion — used for context compaction (summarisation). */
  complete(params: CompleteParams): Promise<string>
}
