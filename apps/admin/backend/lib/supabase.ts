import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Service role client — used server-side only, bypasses RLS for admin ops
let client: SupabaseClient | null = null

function getClient(): SupabaseClient {
  if (client) return client
  const supabaseUrl = process.env['SUPABASE_URL']
  const supabaseServiceKey = process.env['SUPABASE_SERVICE_ROLE_KEY']
  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set')
  }
  client = createClient(supabaseUrl, supabaseServiceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  return client
}

// Lazy proxy: `next build` can collect the Route Handler without requiring
// runtime secrets, while every real method call still fails closed.
export const supabase = new Proxy({} as SupabaseClient, {
  get(_target, property) {
    const live = getClient()
    const value = Reflect.get(live, property, live) as unknown
    return typeof value === 'function' ? value.bind(live) : value
  },
})
