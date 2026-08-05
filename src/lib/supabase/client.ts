'use client'

import { createBrowserClient } from '@supabase/ssr'
import { publicEnv } from '@/lib/env'
import type { Database } from '@/types/database'

/**
 * Browser Supabase client. Only ever holds the anon key, and the anon role has
 * no table privileges in this schema — so a leaked key cannot read CRM data.
 * Interactive reads still happen through the signed-in user's session.
 */
export function createClient() {
  const { supabaseUrl, supabaseAnonKey } = publicEnv()
  return createBrowserClient<Database>(supabaseUrl, supabaseAnonKey)
}
