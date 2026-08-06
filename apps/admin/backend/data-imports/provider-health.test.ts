import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import { assertSquadProviderReady } from './provider-health'

const originalFetch = globalThis.fetch
const originalApiUrl = process.env['TRANSFERMARKT_API_URL']

afterEach(() => {
  globalThis.fetch = originalFetch
  if (originalApiUrl == null) delete process.env['TRANSFERMARKT_API_URL']
  else process.env['TRANSFERMARKT_API_URL'] = originalApiUrl
})

describe('adapter readiness', () => {
  it('checks the adapter contract without triggering a live Transfermarkt scrape', async () => {
    process.env['TRANSFERMARKT_API_URL'] = 'http://adapter.test'
    let requestedUrl = ''
    globalThis.fetch = async (input) => {
      requestedUrl = String(input)
      return Response.json({
        paths: {
          '/clubs/{club_id}/profile': {},
          '/clubs/{club_id}/players': {},
        },
      })
    }

    await assertSquadProviderReady()
    assert.equal(requestedUrl, 'http://adapter.test/openapi.json')
  })

  it('rejects an adapter that does not expose the squad routes', async () => {
    globalThis.fetch = async () => Response.json({ paths: {} })

    await assert.rejects(assertSquadProviderReady(), { message: 'Adapter does not expose the required squad routes' })
  })
})
