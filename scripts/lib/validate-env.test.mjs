import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_SUPABASE_PROJECT_REFS,
  supabaseRefFromKey,
  supabaseRefFromUrl,
  validateEnvironment,
} from './validate-env.mjs'

const PROD_REF = DEFAULT_SUPABASE_PROJECT_REFS.production
const DEV_REF = DEFAULT_SUPABASE_PROJECT_REFS.preview
const OLD_PROD_REF = 'fkyexcddvogkngbbrefz'

/** A legacy Supabase key is an unsigned-verifiable JWT carrying its project ref. */
function jwtKey(ref, role) {
  const encode = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ iss: 'supabase', ref, role })}.signature`
}

function adminEnv(overrides = {}) {
  return {
    SUPABASE_URL: `https://${PROD_REF}.supabase.co`,
    SUPABASE_SERVICE_ROLE_KEY: jwtKey(PROD_REF, 'service_role'),
    SUPABASE_ANON_KEY: jwtKey(PROD_REF, 'anon'),
    ADMIN_USERNAME: 'operator',
    ADMIN_PASSWORD: 'secret',
    ADMIN_SESSION_SECRET: 'secret',
    APP_URL: 'https://app.85percent.pro',
    UPSTASH_REDIS_REST_URL: 'https://redis.example',
    UPSTASH_REDIS_REST_TOKEN: 'token',
    QSTASH_TOKEN: 'token',
    QSTASH_CURRENT_SIGNING_KEY: 'key',
    QSTASH_NEXT_SIGNING_KEY: 'key',
    FOOTBALL_DATA_API_KEY: 'key',
    TRANSFERMARKT_API_URL: 'https://tm.example',
    OPENAI_API_KEY: 'key',
    ...overrides,
  }
}

describe('supabase ref parsing', () => {
  it('reads the project ref out of a Supabase URL', () => {
    assert.equal(supabaseRefFromUrl(`https://${PROD_REF}.supabase.co`), PROD_REF)
    assert.equal(supabaseRefFromUrl('https://example.com'), null)
    assert.equal(supabaseRefFromUrl(undefined), null)
  })

  it('reads the project ref out of a legacy JWT key', () => {
    assert.equal(supabaseRefFromKey(jwtKey(DEV_REF, 'anon')), DEV_REF)
  })

  it('returns null for opaque publishable/secret keys rather than guessing', () => {
    assert.equal(supabaseRefFromKey('sb_publishable_abc123'), null)
    assert.equal(supabaseRefFromKey('sb_secret_abc123'), null)
    assert.equal(supabaseRefFromKey(''), null)
  })
})

describe('validateEnvironment — target project', () => {
  it('accepts a correctly configured production admin environment', () => {
    const result = validateEnvironment({
      app: 'admin',
      vercelEnvironment: 'production',
      env: adminEnv(),
    })
    assert.deepEqual(result.errors, [])
    assert.equal(result.ok, true)
  })

  // The production login outage: Supabase Production was migrated to a new
  // project, but the deployed environment still pointed at the old one. Auth
  // users created in the new project simply do not exist for the old one.
  it('rejects production still pointing at the superseded Supabase project', () => {
    const result = validateEnvironment({
      app: 'admin',
      vercelEnvironment: 'production',
      env: adminEnv({
        SUPABASE_URL: `https://${OLD_PROD_REF}.supabase.co`,
        SUPABASE_ANON_KEY: jwtKey(OLD_PROD_REF, 'anon'),
        SUPABASE_SERVICE_ROLE_KEY: jwtKey(OLD_PROD_REF, 'service_role'),
      }),
    })
    assert.equal(result.ok, false)
    assert.ok(result.errors.some((e) => e.includes('SUPABASE_URL') && e.includes(PROD_REF)))
  })

  it('rejects development credentials deployed to production', () => {
    const result = validateEnvironment({
      app: 'web',
      vercelEnvironment: 'production',
      env: {
        VITE_SUPABASE_URL: `https://${DEV_REF}.supabase.co`,
        VITE_SUPABASE_ANON_KEY: jwtKey(DEV_REF, 'anon'),
      },
    })
    assert.equal(result.ok, false)
    assert.ok(result.errors.some((e) => e.includes('VITE_SUPABASE_URL')))
  })

  it('accepts dev credentials on preview deployments', () => {
    const result = validateEnvironment({
      app: 'web',
      vercelEnvironment: 'preview',
      env: {
        VITE_SUPABASE_URL: `https://${DEV_REF}.supabase.co`,
        VITE_SUPABASE_ANON_KEY: jwtKey(DEV_REF, 'anon'),
      },
    })
    assert.deepEqual(result.errors, [])
  })

  it('honours EXPECTED_SUPABASE_PROJECT_REF during a project migration', () => {
    const nextRef = 'aaaaaaaaaaaaaaaaaaaa'
    const result = validateEnvironment({
      app: 'web',
      vercelEnvironment: 'production',
      env: {
        VITE_SUPABASE_URL: `https://${nextRef}.supabase.co`,
        VITE_SUPABASE_ANON_KEY: jwtKey(nextRef, 'anon'),
        EXPECTED_SUPABASE_PROJECT_REF: nextRef,
      },
    })
    assert.deepEqual(result.errors, [])
  })
})

describe('validateEnvironment — credential consistency', () => {
  // The specific half-migrated state that produces a silent login failure:
  // the anon key was rotated to the new project while the URL was left behind.
  // Nothing crashes; sign-in just rejects every valid password.
  it('detects an anon key belonging to a different project than the URL', () => {
    const result = validateEnvironment({
      app: 'admin',
      vercelEnvironment: 'production',
      env: adminEnv({ SUPABASE_ANON_KEY: jwtKey(OLD_PROD_REF, 'anon') }),
    })
    assert.equal(result.ok, false)
    assert.ok(
      result.errors.some((e) => e.includes('SUPABASE_ANON_KEY') && e.includes(OLD_PROD_REF)),
      `expected a project-mismatch error, got: ${result.errors.join(' | ')}`,
    )
  })

  it('detects a service-role key belonging to a different project than the URL', () => {
    const result = validateEnvironment({
      app: 'admin',
      vercelEnvironment: 'production',
      env: adminEnv({ SUPABASE_SERVICE_ROLE_KEY: jwtKey(DEV_REF, 'service_role') }),
    })
    assert.equal(result.ok, false)
    assert.ok(result.errors.some((e) => e.includes('SUPABASE_SERVICE_ROLE_KEY')))
  })

  it('stays silent about opaque keys it cannot attribute to a project', () => {
    const result = validateEnvironment({
      app: 'admin',
      vercelEnvironment: 'production',
      env: adminEnv({
        SUPABASE_ANON_KEY: 'sb_publishable_opaque',
        SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_opaque',
      }),
    })
    assert.deepEqual(result.errors, [])
  })
})

describe('validateEnvironment — required credentials', () => {
  it('rejects a missing server-side service-role key', () => {
    const env = adminEnv()
    delete env.SUPABASE_SERVICE_ROLE_KEY
    const result = validateEnvironment({ app: 'admin', vercelEnvironment: 'production', env })
    assert.equal(result.ok, false)
    assert.ok(result.errors.some((e) => e.startsWith('SUPABASE_SERVICE_ROLE_KEY')))
  })

  it('rejects a missing football-data.org key — GET /league-table calls it directly in production', () => {
    const env = adminEnv()
    delete env.FOOTBALL_DATA_API_KEY
    const result = validateEnvironment({ app: 'admin', vercelEnvironment: 'production', env })
    assert.equal(result.ok, false)
    assert.ok(result.errors.some((e) => e.startsWith('FOOTBALL_DATA_API_KEY')))
  })

  // Data Sync (QStash dispatch + the Transfermarkt adapter) is local-only by
  // design: it runs against a locally-started admin talking to an adapter on
  // localhost:8000, never against the deployed Vercel admin. A Production
  // deploy must not fail the gate over these.
  it('does not require QStash or the Transfermarkt adapter URL in production — Data Sync is local-only', () => {
    const env = adminEnv()
    delete env.QSTASH_TOKEN
    delete env.QSTASH_CURRENT_SIGNING_KEY
    delete env.QSTASH_NEXT_SIGNING_KEY
    delete env.TRANSFERMARKT_API_URL
    const result = validateEnvironment({ app: 'admin', vercelEnvironment: 'production', env })
    assert.equal(result.ok, true)
    assert.deepEqual(result.errors, [])
    assert.ok(result.warnings.some((w) => w.includes('QSTASH_TOKEN')))
    assert.ok(result.warnings.some((w) => w.includes('TRANSFERMARKT_API_URL')))
  })

  it('rejects a missing publishable key', () => {
    const env = adminEnv({ SUPABASE_ANON_KEY: '   ' })
    const result = validateEnvironment({ app: 'admin', vercelEnvironment: 'production', env })
    assert.equal(result.ok, false)
    assert.ok(result.errors.some((e) => e.startsWith('SUPABASE_ANON_KEY')))
  })

  it('rejects placeholder values', () => {
    const result = validateEnvironment({
      app: 'admin',
      vercelEnvironment: 'production',
      env: adminEnv({ ADMIN_PASSWORD: 'change-me' }),
    })
    assert.equal(result.ok, false)
    assert.ok(result.errors.some((e) => e.startsWith('ADMIN_PASSWORD')))
  })

  it('requires the production admin APP_URL to be the live app host', () => {
    const result = validateEnvironment({
      app: 'admin',
      vercelEnvironment: 'production',
      env: adminEnv({ APP_URL: 'http://localhost:5173' }),
    })
    assert.equal(result.ok, false)
    assert.ok(result.errors.some((e) => e.includes('APP_URL')))
  })

  it('warns, but does not fail, when the Analyst key is absent', () => {
    const env = adminEnv()
    delete env.OPENAI_API_KEY
    const result = validateEnvironment({ app: 'admin', vercelEnvironment: 'production', env })
    assert.equal(result.ok, true)
    assert.ok(result.warnings.some((w) => w.includes('OPENAI_API_KEY')))
  })

  it('rejects an unknown app', () => {
    const result = validateEnvironment({ app: 'nope', vercelEnvironment: 'production', env: {} })
    assert.equal(result.ok, false)
  })
})
