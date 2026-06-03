/**
 * AnthropicAdapter — LLMService backed by Anthropic Claude via the Vercel AI SDK.
 *
 * Uses `streamText` so the response streams token-by-token, and exposes the AI
 * SDK data-stream protocol that the frontend `useChat` hook consumes. The model
 * id is env-configurable (ANTHROPIC_MODEL) and defaults to Claude Sonnet, a good
 * quality/latency/cost fit for an explanatory co-pilot.
 *
 * The Anthropic API key is read server-side only (ANTHROPIC_API_KEY) and never
 * reaches the browser — inference is proxied entirely through our Fastify route.
 */

import type { ServerResponse } from 'node:http'
import { streamText, generateText } from 'ai'
import { createAnthropic } from '@ai-sdk/anthropic'
import type { CompleteParams, LLMService, LLMStream, StreamChatParams } from './types.js'

const DEFAULT_MODEL = 'claude-sonnet-4-6'

export class AnthropicAdapter implements LLMService {
  private readonly model: string

  constructor() {
    this.model = process.env['ANTHROPIC_MODEL'] ?? DEFAULT_MODEL
  }

  streamChat({ system, messages, onFinish }: StreamChatParams): LLMStream {
    const apiKey = process.env['ANTHROPIC_API_KEY']
    if (!apiKey) {
      // Surface a clear, actionable error rather than a cryptic SDK failure.
      throw new Error('ANTHROPIC_API_KEY is not set — the Analyst cannot run without it.')
    }

    const anthropic = createAnthropic({ apiKey })

    const result = streamText({
      model: anthropic(this.model),
      system,
      messages,
      // Keep answers focused; the analyst explains, it doesn't write essays.
      maxTokens: 1024,
      temperature: 0.3,
      onFinish: onFinish
        ? async (event) => {
            try {
              await onFinish(event.text)
            } catch {
              // Persistence is best-effort — never break the streamed response.
            }
          }
        : undefined,
    })

    return {
      pipeToResponse: (res: ServerResponse) => {
        // Emits the AI SDK data-stream framing that `useChat` parses, and sets
        // the streaming headers. We surface any mid-stream error as text so the
        // user sees a message instead of a silent hang.
        result.pipeDataStreamToResponse(res, {
          getErrorMessage: (error) => {
            const message = error instanceof Error ? error.message : String(error)
            return `The Analyst hit an error: ${message}`
          },
        })
      },
    }
  }

  async complete({ system, user, maxTokens = 400 }: CompleteParams): Promise<string> {
    const apiKey = process.env['ANTHROPIC_API_KEY']
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY is not set — cannot summarise.')
    }
    const anthropic = createAnthropic({ apiKey })
    const { text } = await generateText({
      model: anthropic(this.model),
      system,
      prompt: user,
      maxTokens,
      temperature: 0.2,
    })
    return text.trim()
  }
}
