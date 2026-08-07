#!/usr/bin/env node

/**
 * Vercel build gate. Fails the deployment when the environment is missing
 * credentials or points at the wrong Supabase project. The rules live in
 * scripts/lib/validate-env.mjs so they can be unit-tested; this file only wires
 * them to the process.
 */

import { APP_CONFIGURATIONS, validateEnvironment } from './lib/validate-env.mjs'

const app = process.argv[2]
const vercelEnvironment = process.env.VERCEL_ENV

if (!APP_CONFIGURATIONS[app]) {
  console.error('Usage: node scripts/validate-vercel-env.mjs <admin|web|landing>')
  process.exit(2)
}

if (!vercelEnvironment) {
  console.log(`Skipping ${app} Vercel environment validation outside Vercel.`)
  process.exit(0)
}

const { ok, errors, warnings } = validateEnvironment({
  app,
  vercelEnvironment,
  env: process.env,
})

if (!ok) {
  console.error(`Invalid ${app} environment for Vercel ${vercelEnvironment}:`)
  for (const error of errors) console.error(`- ${error}`)
  console.error('Deployment stopped before the application build.')
  process.exit(1)
}

for (const warning of warnings) console.warn(`Warning: ${warning}`)

console.log(`Validated ${app} environment for Vercel ${vercelEnvironment}.`)
