import 'server-only'
import path from 'node:path'

/**
 * env — validated, server-only environment for the admin panel. Values are read
 * through getters so a missing var throws at first use (with a clear message)
 * rather than at module load, which keeps `next build` from crashing on pages
 * that never touch a given secret. Nothing here is ever bundled to the client:
 * none of these names carry the NEXT_PUBLIC_ prefix.
 */

function required(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing required env var: ${name} (see apps/admin/.env.example)`)
  return v
}

// From apps/admin (Next runs with cwd = the app dir) up 2 = repo root, so we can
// spawn `pnpm --filter @85percent/api …`. Overridable via REPO_ROOT.
const defaultRepoRoot = path.resolve(process.cwd(), '../..')

export const env = {
  get isProd(): boolean {
    return process.env['NODE_ENV'] === 'production'
  },
  get supabaseUrl(): string {
    return required('SUPABASE_URL')
  },
  get supabaseServiceKey(): string {
    return required('SUPABASE_SERVICE_ROLE_KEY')
  },
  get adminUsername(): string {
    return required('ADMIN_USERNAME')
  },
  get adminPassword(): string {
    return required('ADMIN_PASSWORD')
  },
  get sessionSecret(): string {
    return required('ADMIN_SESSION_SECRET')
  },
  get repoRoot(): string {
    return process.env['REPO_ROOT']?.trim() || defaultRepoRoot
  },
  // Base URL of the main web app — used as the redirect target for Supabase
  // account-provisioning invites (the invitee lands on `${appUrl}/set-password`).
  // Defaults to the Vite dev server so local provisioning works out of the box.
  get appUrl(): string {
    return process.env['APP_URL']?.trim().replace(/\/+$/, '') || 'http://localhost:5173'
  },
}
