/**
 * Deployment environment validation — pure logic, no process/IO.
 *
 * This runs as a build gate on Vercel (see scripts/validate-vercel-env.mjs) so a
 * misconfigured environment fails the deployment instead of shipping a broken
 * app. It exists because the failure it guards against is invisible from the
 * outside: a web bundle or API pointed at the wrong Supabase project still
 * builds, still boots, and still serves — it just cannot authenticate anyone
 * whose account lives in the other project.
 *
 * Two independent checks matter:
 *
 *  1. TARGET — the Supabase URL must be the project this Vercel environment is
 *     supposed to use. Because that mapping changes when a project is migrated,
 *     `EXPECTED_SUPABASE_PROJECT_REF` can override the defaults below without a
 *     code change.
 *
 *  2. INTERNAL CONSISTENCY — every Supabase credential in the environment must
 *     belong to the SAME project as the URL. Legacy Supabase keys are JWTs that
 *     carry their project ref in the payload, so a key rotated to a new project
 *     while the URL still points at the old one is detectable here. That exact
 *     split (new anon key, old URL) authenticates nobody, and produces a plain
 *     "invalid credentials" error with nothing in the logs to explain it.
 *
 * Newer `sb_publishable_…` / `sb_secret_…` keys are opaque and carry no ref, so
 * check 2 can only report on the legacy JWT format. It reports what it can and
 * stays silent about the rest rather than guessing.
 */

/**
 * Supabase project each Vercel environment must target. Override per-deployment
 * with `EXPECTED_SUPABASE_PROJECT_REF` when a project is being migrated.
 */
export const DEFAULT_SUPABASE_PROJECT_REFS = {
  production: 'smhzdbyztyavwyuzuumz',
  preview: 'deebcfzsgdwnmeoqphgm',
  development: 'deebcfzsgdwnmeoqphgm',
}

/**
 * Supabase credentials per app, checked for project agreement with the URL.
 * `urlVar` is the authority; the others must not disagree with it.
 */
export const APP_CONFIGURATIONS = {
  admin: {
    // Data Sync (squad/player imports via the Transfermarkt adapter) is
    // intentionally local-only: it runs against an admin instance on the
    // operator's machine talking to a Transfermarkt adapter on localhost:8000,
    // dispatched in-process (DATA_IMPORT_DISPATCH_MODE=local). It is never
    // triggered against the deployed Vercel admin, so QStash (the dispatcher
    // for the *remote* worker path, apps/admin/app/api/data-imports/task/route.ts)
    // and the Transfermarkt adapter URL have nothing to configure in Production
    // — see `recommended` below. FOOTBALL_DATA_API_KEY is different: the
    // always-on GET /league-table route (backend/routes/league-table.ts) calls
    // football-data.org directly as its live-data tier, so it stays required.
    required: [
      'SUPABASE_URL',
      'SUPABASE_SERVICE_ROLE_KEY',
      'SUPABASE_ANON_KEY',
      'ADMIN_USERNAME',
      'ADMIN_PASSWORD',
      'ADMIN_SESSION_SECRET',
      'APP_URL',
      'UPSTASH_REDIS_REST_URL',
      'UPSTASH_REDIS_REST_TOKEN',
      'FOOTBALL_DATA_API_KEY',
    ],
    recommended: ['OPENAI_API_KEY', 'QSTASH_TOKEN', 'QSTASH_CURRENT_SIGNING_KEY', 'QSTASH_NEXT_SIGNING_KEY', 'TRANSFERMARKT_API_URL'],
    urlVar: 'SUPABASE_URL',
    keyVars: ['SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'],
  },
  web: {
    required: ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'],
    recommended: ['VITE_POSTHOG_KEY', 'VITE_POSTHOG_HOST', 'VITE_POSTHOG_ENABLED', 'VITE_POSTHOG_ENVIRONMENT'],
    urlVar: 'VITE_SUPABASE_URL',
    keyVars: ['VITE_SUPABASE_ANON_KEY'],
  },
  landing: {
    required: [
      'NEXT_PUBLIC_SUPABASE_URL',
      'SUPABASE_ANON_KEY',
      'UPSTASH_REDIS_REST_URL',
      'UPSTASH_REDIS_REST_TOKEN',
    ],
    recommended: ['NEXT_PUBLIC_POSTHOG_KEY', 'NEXT_PUBLIC_POSTHOG_HOST', 'NEXT_PUBLIC_POSTHOG_ENABLED', 'NEXT_PUBLIC_POSTHOG_ENVIRONMENT'],
    urlVar: 'NEXT_PUBLIC_SUPABASE_URL',
    keyVars: ['SUPABASE_ANON_KEY'],
  },
}

const PLACEHOLDER_PATTERN = /^(?:your-|<)|(?:change-me|placeholder|undefined|null)$/i

/** Project ref from a Supabase URL, or null when it is not one. */
export function supabaseRefFromUrl(url) {
  if (typeof url !== 'string') return null
  const match = url.trim().match(/^https?:\/\/([a-z0-9]{20})\.supabase\./i)
  return match ? match[1].toLowerCase() : null
}

/**
 * Project ref embedded in a legacy Supabase JWT key. Returns null for the newer
 * opaque `sb_publishable_` / `sb_secret_` formats, which carry no ref — callers
 * must treat null as "cannot tell", never as "mismatch".
 */
export function supabaseRefFromKey(key) {
  if (typeof key !== 'string') return null
  const parts = key.trim().split('.')
  if (parts.length !== 3) return null
  try {
    const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'))
    return typeof payload.ref === 'string' ? payload.ref.toLowerCase() : null
  } catch {
    return null
  }
}

function isBlankOrPlaceholder(value) {
  const trimmed = value?.trim()
  return !trimmed || PLACEHOLDER_PATTERN.test(trimmed)
}

/**
 * Validate one app's environment for one Vercel environment.
 *
 * @returns {{ ok: boolean, errors: string[], warnings: string[] }}
 */
export function validateEnvironment({ app, vercelEnvironment, env }) {
  const configuration = APP_CONFIGURATIONS[app]
  if (!configuration) {
    return { ok: false, errors: [`Unknown app "${app}"`], warnings: [] }
  }

  const errors = []
  const warnings = []

  for (const name of configuration.required) {
    if (isBlankOrPlaceholder(env[name])) {
      errors.push(`${name} is missing, blank, or a placeholder`)
    }
  }

  const expectedRef =
    env.EXPECTED_SUPABASE_PROJECT_REF?.trim() ||
    DEFAULT_SUPABASE_PROJECT_REFS[vercelEnvironment] ||
    DEFAULT_SUPABASE_PROJECT_REFS.preview

  const url = env[configuration.urlVar]?.trim()
  const urlRef = supabaseRefFromUrl(url)

  if (url && urlRef !== expectedRef) {
    errors.push(
      `${configuration.urlVar} must target the ${vercelEnvironment} Supabase project (${expectedRef})`,
    )
  }

  // Credentials must agree with the URL. A key from a different project is the
  // silent failure this whole gate exists for.
  if (urlRef) {
    for (const name of configuration.keyVars) {
      const keyRef = supabaseRefFromKey(env[name])
      if (keyRef && keyRef !== urlRef) {
        errors.push(
          `${name} belongs to Supabase project ${keyRef}, but ${configuration.urlVar} targets ${urlRef}`,
        )
      }
    }
  }

  if (app === 'admin' && vercelEnvironment === 'production') {
    const appUrl = env.APP_URL?.trim()
    if (appUrl && appUrl !== 'https://app.85percent.pro') {
      errors.push('APP_URL must be https://app.85percent.pro in production')
    }
  }

  for (const name of configuration.recommended) {
    if (!env[name]?.trim()) {
      warnings.push(`${name} is not configured; its feature will be unavailable.`)
    }
  }

  return { ok: errors.length === 0, errors, warnings }
}
