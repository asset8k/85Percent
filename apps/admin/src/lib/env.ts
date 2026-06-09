/**
 * env — validated environment for the admin panel. Fails fast at boot with a
 * clear message rather than a cryptic runtime error deep in a handler.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

function required(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing required env var: ${name} (see apps/admin/.env.example)`)
  return v
}

// Resolve the monorepo root so we can spawn `pnpm --filter @85percent/api …`.
// From apps/admin/src/lib → up 4 = repo root. Overridable via REPO_ROOT.
const here = path.dirname(fileURLToPath(import.meta.url))
const defaultRepoRoot = path.resolve(here, '../../../..')

export const env = {
  port: parseInt(process.env['PORT'] ?? '4000', 10),
  isProd: process.env['NODE_ENV'] === 'production',
  supabaseUrl: required('SUPABASE_URL'),
  supabaseServiceKey: required('SUPABASE_SERVICE_ROLE_KEY'),
  adminUsername: required('ADMIN_USERNAME'),
  adminPassword: required('ADMIN_PASSWORD'),
  sessionSecret: required('ADMIN_SESSION_SECRET'),
  repoRoot: process.env['REPO_ROOT']?.trim() || defaultRepoRoot,
}
