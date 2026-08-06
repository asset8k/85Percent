/**
 * LLMService — provider-agnostic inference seam.
 *
 * The current implementation uses OpenAI via the Vercel AI SDK. This contract
 * isolates provider choice from the chat routes and UI.
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
