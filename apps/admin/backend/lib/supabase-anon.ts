import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Anon (publishable) client — used server-side ONLY to verify a user's password
// via signInWithPassword during the backend-proxied login + 2FA flow. The
// service-role client cannot verify passwords, so this is the one place we need
// the publishable key on the server. It never persists a session: every call is
// a one-shot credential check, and the resulting tokens are handed straight back
// to the browser (or withheld until TOTP passes).
let client: SupabaseClient | null = null

function getClient(): SupabaseClient {
  if (client) return client
  const supabaseUrl = process.env['SUPABASE_URL']
  const supabaseAnonKey = process.env['SUPABASE_ANON_KEY']
  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error('SUPABASE_URL and SUPABASE_ANON_KEY must be set')
  }
  client = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  return client
}

export const supabaseAnon = new Proxy({} as SupabaseClient, {
  get(_target, property) {
    const live = getClient()
    const value = Reflect.get(live, property, live) as unknown
    return typeof value === 'function' ? value.bind(live) : value
  },
})
