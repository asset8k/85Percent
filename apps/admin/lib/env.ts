import 'server-only'

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
  // Base URL of the Fastify API. The admin panel POSTs here to trigger the
  // maintenance jobs (the API runs them; this serverless panel cannot spawn a
  // subprocess). Defaults to the local API dev server.
  get apiBaseUrl(): string {
    return process.env['API_BASE_URL']?.trim().replace(/\/+$/, '') || 'http://localhost:3001'
  },
  // Shared secret authenticating the admin → API job-trigger call. Must match
  // INTERNAL_JOB_SECRET on the API. Required (no default) so a job can't be
  // fired with an empty credential.
  get internalJobSecret(): string {
    return required('INTERNAL_JOB_SECRET')
  },
  // Base URL of the main web app — used as the redirect target for Supabase
  // account-provisioning invites (the invitee lands on `${appUrl}/set-password`).
  // Defaults to the Vite dev server so local provisioning works out of the box.
  get appUrl(): string {
    return process.env['APP_URL']?.trim().replace(/\/+$/, '') || 'http://localhost:5173'
  },
}
