import assert from 'node:assert/strict'
import { test } from 'node:test'
import { OpenAIAdapter } from '../services/ai/openai-adapter'

test('OpenAIAdapter reports a missing OpenAI credential', async () => {
  const originalOpenAIKey = process.env['OPENAI_API_KEY']
  delete process.env['OPENAI_API_KEY']

  try {
    await assert.rejects(
      new OpenAIAdapter().complete({ system: 'System', user: 'Summarise this.' }),
      /OPENAI_API_KEY is not set/,
    )
  } finally {
    if (originalOpenAIKey === undefined) delete process.env['OPENAI_API_KEY']
    else process.env['OPENAI_API_KEY'] = originalOpenAIKey
  }
})
