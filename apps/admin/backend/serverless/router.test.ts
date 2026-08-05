import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { getApiRouter } from './bootstrap'

describe('serverless API registry', () => {
  it('registers every migrated endpoint exactly once', async () => {
    const routes = (await getApiRouter()).routeManifest()
    const keys = routes.map(({ method, path }) => `${method} ${path}`)
    assert.equal(routes.length, 73)
    assert.equal(new Set(keys).size, routes.length)
    assert.ok(keys.includes('GET /health'))
    assert.ok(keys.includes('POST /chat'))
    assert.ok(keys.includes('DELETE /roster/manager-contract/:id'))
    assert.ok(keys.includes('PATCH /roster/player/:id/registration-asset'))
  })

  it('serves health without admin-page authentication', async () => {
    const response = await (await getApiRouter()).dispatch(
      new Request('http://localhost/api/health'),
      '/health',
    )
    assert.equal(response.status, 200)
    assert.equal((await response.json() as { status: string }).status, 'ok')
  })

  it('preserves bearer-token protection and public validation', async () => {
    const router = await getApiRouter()
    const protectedResponse = await router.dispatch(
      new Request('http://localhost/api/me'),
      '/me',
    )
    assert.equal(protectedResponse.status, 401)

    const publicResponse = await router.dispatch(
      new Request('http://localhost/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'invalid', password: '' }),
      }),
      '/auth/login',
    )
    assert.equal(publicResponse.status, 400)
  })
})
