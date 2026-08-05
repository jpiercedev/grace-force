import 'server-only'

import { cookies } from 'next/headers'
import { createServerClient } from '@supabase/ssr'
import { publicEnv } from '@/lib/env'
import type { Database } from '@/types/database'

/**
 * Request-scoped Supabase client for server components, server actions and
 * route handlers.
 *
 * Every query made through this client runs as the signed-in user, so Row
 * Level Security is what decides which rows come back. That is deliberate:
 * application code never has to remember to filter by permission.
 */
export async function createClient() {
  const cookieStore = await cookies()
  const { supabaseUrl, supabaseAnonKey } = publicEnv()

  return createServerClient<Database>(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll()
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options)
          }
        } catch {
          // Server components cannot set cookies. The middleware refreshes the
          // session on every request, so ignoring this is safe.
        }
      },
    },
  })
}
