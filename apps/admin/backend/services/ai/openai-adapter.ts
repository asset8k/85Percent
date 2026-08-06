/**
 * OpenAIAdapter — LLMService backed by OpenAI via the Vercel AI SDK.
 *
 * The adapter preserves the existing streamed data protocol consumed by the
 * frontend. Retrieval, prompts, history, and deterministic SCR calculations
 * remain outside this provider boundary.
 */

import { createOpenAI } from '@ai-sdk/openai'
import { generateText, streamText } from 'ai'
import type { CompleteParams, LLMService, LLMStream, StreamChatParams } from './types'

const DEFAULT_MODEL = 'gpt-5.6-luna'

export class OpenAIAdapter implements LLMService {
  private readonly model: string

  constructor() {
    this.model = process.env['OPENAI_MODEL']?.trim() || DEFAULT_MODEL
  }

  streamChat({ system, messages, onFinish }: StreamChatParams): LLMStream {
    const apiKey = process.env['OPENAI_API_KEY']
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is not set — the Analyst cannot run without it.')
    }

    const openai = createOpenAI({ apiKey })
    const result = streamText({
      model: openai(this.model),
      system,
      messages,
      maxTokens: 1024,
      onFinish: onFinish
        ? async (event) => {
            try {
              await onFinish({
                text: event.text,
                usage: {
                  promptTokens: event.usage?.promptTokens ?? 0,
                  completionTokens: event.usage?.completionTokens ?? 0,
                },
              })
            } catch {
              // Persistence and billing must not break a completed stream.
            }
          }
        : undefined,
    })

    return {
      toResponse: () =>
        result.toDataStreamResponse({
          getErrorMessage: () => 'The Analyst could not complete this response. Please try again.',
        }),
    }
  }

  async complete({ system, user, maxTokens = 400 }: CompleteParams): Promise<string> {
    const apiKey = process.env['OPENAI_API_KEY']
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is not set — cannot summarise.')
    }

    const openai = createOpenAI({ apiKey })
    const { text } = await generateText({
      model: openai(this.model),
      system,
      prompt: user,
      maxTokens,
    })
    return text.trim()
  }
}
