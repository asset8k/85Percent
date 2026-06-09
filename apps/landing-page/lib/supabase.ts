import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * The landing page's Supabase client — ANON key only, created server-side inside
 * the demo-request route (spec §5b). It can do exactly one thing the schema
 * allows anon to do: INSERT a row into demo_requests. It holds no service-role
 * key and has no read access to any core table.
 *
 * Lazily constructed so a missing env var fails loudly at request time (in the
 * route) rather than at module import — and never during the static build.
 */
export function getSupabaseAnon(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.SUPABASE_ANON_KEY
  if (!url || !anonKey) {
    throw new Error('NEXT_PUBLIC_SUPABASE_URL and SUPABASE_ANON_KEY must be set')
  }
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
