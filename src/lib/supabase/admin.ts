import 'server-only'

import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { publicEnv, serviceRoleKey } from '@/lib/env'
import type { Database } from '@/types/database'

/**
 * Service-role client. **Bypasses Row Level Security entirely.**
 *
 * Legitimate callers are narrow and all server-side:
 *   - the public lead-intake route, which must write for an unauthenticated
 *     visitor without giving the anon role any table privileges;
 *   - integration sync jobs (Mailchimp), which reconcile whole audiences;
 *   - the notification outbox, which claims and sends internal email.
 *
 * Anything reachable from a user session should use `@/lib/supabase/server`
 * instead, so that RLS remains the enforcement point. ESLint blocks importing
 * this module outside server code.
 */
export function createAdminClient() {
  const { supabaseUrl } = publicEnv()

  return createSupabaseClient<Database>(supabaseUrl, serviceRoleKey(), {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  })
}

export type AdminClient = ReturnType<typeof createAdminClient>
