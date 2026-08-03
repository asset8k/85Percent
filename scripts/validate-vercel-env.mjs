#!/usr/bin/env node

const app = process.argv[2]
const vercelEnvironment = process.env.VERCEL_ENV

const configurations = {
  admin: {
    required: [
      'SUPABASE_URL',
      'SUPABASE_SERVICE_ROLE_KEY',
      'SUPABASE_ANON_KEY',
      'ADMIN_USERNAME',
      'ADMIN_PASSWORD',
      'ADMIN_SESSION_SECRET',
      'APP_URL',
      'INTERNAL_JOB_SECRET',
      'UPSTASH_REDIS_REST_URL',
      'UPSTASH_REDIS_REST_TOKEN',
    ],
    recommended: ['ANTHROPIC_API_KEY'],
    supabaseUrl: 'SUPABASE_URL',
  },
  web: {
    required: ['VITE_SUPABASE_URL', 'VITE_SUPABASE_ANON_KEY'],
    supabaseUrl: 'VITE_SUPABASE_URL',
  },
  landing: {
    required: [
      'NEXT_PUBLIC_SUPABASE_URL',
      'SUPABASE_ANON_KEY',
      'UPSTASH_REDIS_REST_URL',
      'UPSTASH_REDIS_REST_TOKEN',
    ],
    supabaseUrl: 'NEXT_PUBLIC_SUPABASE_URL',
  },
}

const configuration = configurations[app]
if (!configuration) {
  console.error('Usage: node scripts/validate-vercel-env.mjs <admin|web|landing>')
  process.exit(2)
}

if (!vercelEnvironment) {
  console.log(`Skipping ${app} Vercel environment validation outside Vercel.`)
  process.exit(0)
}

const placeholderPattern = /^(?:your-|<)|(?:change-me|placeholder|undefined|null)$/i
const invalid = configuration.required.filter((name) => {
  const value = process.env[name]?.trim()
  return !value || placeholderPattern.test(value)
})

const errors = invalid.map((name) => `${name} is missing, blank, or a placeholder`)

const expectedProjectRef =
  vercelEnvironment === 'production'
    ? 'fkyexcddvogkngbbrefz'
    : 'deebcfzsgdwnmeoqphgm'
const supabaseUrl = process.env[configuration.supabaseUrl]?.trim()

if (supabaseUrl && !supabaseUrl.includes(expectedProjectRef)) {
  errors.push(
    `${configuration.supabaseUrl} must target the ${vercelEnvironment} Supabase project (${expectedProjectRef})`,
  )
}

if (app === 'admin' && vercelEnvironment === 'production') {
  const appUrl = process.env.APP_URL?.trim()
  if (appUrl && appUrl !== 'https://app.85percent.pro') {
    errors.push('APP_URL must be https://app.85percent.pro in production')
  }
}

if (errors.length > 0) {
  console.error(`Invalid ${app} environment for Vercel ${vercelEnvironment}:`)
  for (const error of errors) console.error(`- ${error}`)
  console.error('Deployment stopped before the application build.')
  process.exit(1)
}

const warnings = (configuration.recommended ?? []).filter(
  (name) => !process.env[name]?.trim(),
)
for (const name of warnings) {
  console.warn(`Warning: ${name} is not configured; its feature will be unavailable.`)
}

console.log(`Validated ${app} environment for Vercel ${vercelEnvironment}.`)
