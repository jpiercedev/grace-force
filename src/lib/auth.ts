import 'server-only'

import { redirect } from 'next/navigation'
import { cache } from 'react'
import { publicEnv } from '@/lib/env'
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
 * Why the profile lookup came back without a profile.
 *
 * These four outcomes look identical from a `null`, and treating them alike is
 * how a configuration fault masquerades as "your account is not set up".
 */
export type ProfileLookup =
  | { status: 'ok'; user: SessionUser; profile: ProfileRow }
  | { status: 'no-session' }
  | { status: 'not-found'; user: SessionUser }
  | { status: 'error'; user: SessionUser; code: string | null; message: string }

type SessionUser = {
  id: string
  email?: string | null
  /**
   * Read from `app_metadata`, which GoTrue refuses to let a user write, and
   * which `getUser()` returns fresh from the auth server rather than from
   * whatever the JWT was minted with. See
   * `20260827000200_force_password_rotation.sql` for why it does not live on
   * `profiles`.
   */
  mustChangePassword: boolean
}

/**
 * Loads the session and the profile using **one** Supabase client.
 *
 * The single client matters. `supabase-js` attaches the caller's access token
 * to PostgREST requests from the auth state it has hydrated; a client that has
 * not resolved its session yet can issue the query as `anon`. In this schema
 * `anon` holds no table privileges at all, so that request does not come back
 * empty — it comes back as a permission error, which then reads as "no
 * profile" if the error is discarded. Calling `getUser()` first, on the same
 * client, is what guarantees the query runs as the signed-in user.
 *
 * Deduplicated per request, so a layout and its pages share one round-trip.
 */
export const loadProfile = cache(async (): Promise<ProfileLookup> => {
  const supabase = await createClient()

  const {
    data: { user: authUser },
  } = await supabase.auth.getUser()
  if (!authUser) return { status: 'no-session' }

  const user: SessionUser = {
    id: authUser.id,
    email: authUser.email,
    mustChangePassword: authUser.app_metadata?.must_change_password === true,
  }

  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle()

  if (error) {
    // Loud, and specific enough to act on: a PostgREST code plus the project
    // being queried separates "RLS denied" from "pointed at the wrong project"
    // without ever touching a key.
    console.error('[auth] profile lookup failed', {
      userId: user.id,
      supabaseProject: projectRef(),
      code: error.code,
      message: error.message,
      details: error.details,
      hint: error.hint,
    })
    return { status: 'error', user, code: error.code ?? null, message: error.message }
  }

  if (!data) {
    console.warn('[auth] no profile row for authenticated user', {
      userId: user.id,
      supabaseProject: projectRef(),
    })
    return { status: 'not-found', user }
  }

  return { status: 'ok', user, profile: data }
})

/** Project ref from the configured URL. Identifies the project, reveals no secret. */
function projectRef(): string {
  try {
    return new URL(publicEnv().supabaseUrl).hostname.split('.')[0] ?? 'unknown'
  } catch {
    return 'unconfigured'
  }
}

/** The signed-in auth user, independent of whether a profile row exists. */
export async function getSessionUser(): Promise<SessionUser | null> {
  const result = await loadProfile()
  return result.status === 'no-session' ? null : result.user
}

/** Deduplicated per request, so a layout and its pages share one round-trip. */
export async function getCurrentProfile(): Promise<ProfileRow | null> {
  const result = await loadProfile()
  return result.status === 'ok' ? result.profile : null
}

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
  const result = await loadProfile()

  switch (result.status) {
    case 'ok':
      if (!result.profile.is_active) redirect('/no-access')
      // Terminal for every other route: an account whose first password was
      // chosen by someone else is not usable until its owner has replaced it.
      // /change-password guards itself with `loadProfile`, not this, so the
      // two do not bounce off each other.
      if (result.user.mustChangePassword) redirect('/change-password')
      return result.profile

    // The only state that is actually a credentials problem.
    case 'no-session':
      redirect('/login')

    case 'not-found':
      redirect('/no-access?reason=unprovisioned')

    // A failed query is a fault, not a verdict on the account. Sending it to
    // /login would both misdiagnose it and re-enter the middleware loop; the
    // real cause is in the server logs.
    case 'error':
      redirect('/no-access?reason=error')
  }
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

