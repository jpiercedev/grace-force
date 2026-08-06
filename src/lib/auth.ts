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

/**
 * The signed-in auth user, independent of whether a profile row exists.
 *
 * Keeping this separate from `getCurrentProfile` is what lets the guards tell
 * "not signed in" apart from "signed in but unprovisioned" — two states that
 * look identical from a null profile and must be handled differently, because
 * only one of them can safely be sent to /login.
 *
 * Deduplicated per request, so a layout and its pages share one round-trip.
 */
export const getSessionUser = cache(async () => {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  return user
})

/** Deduplicated per request, so a layout and its pages share one round-trip. */
export const getCurrentProfile = cache(async (): Promise<ProfileRow | null> => {
  const user = await getSessionUser()
  if (!user) return null

  const supabase = await createClient()
  const { data } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle()

  return data ?? null
})

/**
 * Guarantees an active profile, or navigates away.
 *
 * Every branch here must terminate somewhere middleware will not bounce back,
 * or the two layers form an infinite redirect. Middleware sends a signed-in
 * user away from /login, so a signed-in user must never be redirected *to*
 * /login — that pair is exactly the ERR_TOO_MANY_REDIRECTS loop:
 *
 *     /login --(middleware: user is signed in)--> /dashboard
 *     /dashboard --(this guard: no profile row)--> /login   ...forever
 *
 * So a null profile is only a login problem when there is also no session.
 * With a session, it means the account exists in auth but was never
 * provisioned — the `handle_new_user` trigger did not fire, or the user
 * predates it — which is an access problem, not a credentials problem, and
 * belongs on /no-access where it can be explained and is terminal.
 */
export async function requireProfile(): Promise<ProfileRow> {
  const profile = await getCurrentProfile()
  if (profile) {
    if (!profile.is_active) redirect('/no-access')
    return profile
  }

  const user = await getSessionUser()
  if (!user) redirect('/login')
  redirect('/no-access?reason=unprovisioned')
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

