import 'server-only'

import { redirect } from 'next/navigation'
import { cache } from 'react'
import { canWrite } from '@/lib/permissions'
import { createClient } from '@/lib/supabase/server'
import type { ProfileRow } from '@/types/database'

// Capability predicates live in `@/lib/permissions` so client components can
// use them too; re-exported here so server code has a single import.
export {
  canViewGiving,
  canWrite,
  isAdmin,
  ROLE_DESCRIPTIONS,
  ROLE_LABELS,
} from '@/lib/permissions'

/**
 * Session and permission helpers for server code.
 *
 * These decide what the *interface* offers. They are not the security
 * boundary — Row Level Security is. A bug here hides a button; it does not
 * expose a row.
 */

/** Deduplicated per request, so a layout and its pages share one round-trip. */
export const getCurrentProfile = cache(async (): Promise<ProfileRow | null> => {
  const supabase = await createClient()

  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const { data } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle()

  return data ?? null
})

/**
 * Guarantees an active profile, or navigates away.
 *
 * A signed-in user whose profile has been deactivated is sent to a page that
 * explains why, rather than to the login screen — which would look like a
 * broken password and generate a support ticket.
 */
export async function requireProfile(): Promise<ProfileRow> {
  const profile = await getCurrentProfile()
  if (!profile) redirect('/login')
  if (!profile.is_active) redirect('/no-access')
  return profile
}

export async function requireWriteAccess(): Promise<ProfileRow> {
  const profile = await requireProfile()
  if (!canWrite(profile)) redirect('/dashboard?denied=write')
  return profile
}

export async function requireAdmin(): Promise<ProfileRow> {
  const profile = await requireProfile()
  if (profile.role !== 'admin') redirect('/dashboard?denied=admin')
  return profile
}

