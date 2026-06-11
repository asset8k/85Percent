import 'server-only'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { env } from './env'

/**
 * Service-role Supabase client — full DB + auth-admin access. Admin-tool only;
 * the service-role key never reaches a browser (every caller is a Server
 * Component or Server Action). Created lazily so importing this module during a
 * build that never queries the DB doesn't require the secret to be present.
 */

let client: SupabaseClient | null = null

export function getSupabase(): SupabaseClient {
  if (!client) {
    client = createClient(env.supabaseUrl, env.supabaseServiceKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
  }
  return client
}
