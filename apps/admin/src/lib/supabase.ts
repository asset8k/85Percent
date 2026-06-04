/**
 * Service-role Supabase client — full DB + auth-admin access. Admin-tool only;
 * the service-role key never reaches a browser (this is a server-rendered app).
 */

import { createClient } from '@supabase/supabase-js'
import { env } from './env.js'

export const supabase = createClient(env.supabaseUrl, env.supabaseServiceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})
