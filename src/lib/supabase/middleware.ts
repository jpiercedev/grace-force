import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { isSupabaseConfigured, publicEnv } from '@/lib/env'
import type { Database } from '@/types/database'

/** Paths reachable without a session. Everything else requires one. */
const PUBLIC_PREFIXES = [
  '/login',
  '/signup',
  '/check-email',
  '/auth',
  '/intake',
  '/setup',
  '/guide/grace-lead-manager-4f7c2a9d',
  '/api/leads',
  '/api/cron',
]

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  )
}

/**
 * Supabase stores the session in `sb-<ref>-auth-token`, chunked across
 * `.0`/`.1` cookies when large. Checking for it lets an unauthenticated
 * request be rejected without a round-trip to the auth server — which keeps
 * the redirect fast and makes route protection testable without a live
 * backend.
 */
export function hasSessionCookie(request: NextRequest): boolean {
  return request.cookies
    .getAll()
    .some((cookie) => cookie.name.startsWith('sb-') && cookie.name.includes('auth-token'))
}

/**
 * Redirect while keeping every cookie already written to `carrier`.
 *
 * This is the whole ballgame for session handling in middleware. When
 * `getUser()` refreshes an expired access token, `@supabase/ssr` writes the new
 * token pair onto the response it was handed — but `NextResponse.redirect()`
 * creates a *fresh* response, so returning one directly throws those cookies
 * away.
 *
 * With refresh-token rotation that is not merely lossy, it is a trap: the
 * refresh consumed server-side succeeds and invalidates the old token, while
 * the browser keeps the stale cookie because the replacement never reached it.
 * The next request presents a token that has already been spent, `getUser()`
 * returns null, and middleware bounces to /login — where the same stale cookie
 * triggers the same doomed refresh. That is the ERR_TOO_MANY_REDIRECTS loop.
 *
 * Copying the cookies across makes the redirect carry the session forward, so
 * the chain converges after one hop.
 */
function redirectPreservingCookies(url: URL, carrier?: NextResponse): NextResponse {
  const redirect = NextResponse.redirect(url)
  if (!carrier) return redirect

  for (const cookie of carrier.cookies.getAll()) {
    // Passing the whole ResponseCookie keeps maxAge/path/httpOnly/sameSite,
    // which the session cookies depend on to be sent back at all.
    redirect.cookies.set(cookie)
  }
  return redirect
}

export async function updateSession(request: NextRequest): Promise<NextResponse> {
  const { pathname } = request.nextUrl

  // Without credentials the app cannot do anything useful; send operators to
  // the setup page rather than failing with a stack trace.
  if (!isSupabaseConfigured()) {
    if (pathname === '/setup' || pathname.startsWith('/_next') || pathname.startsWith('/api/')) {
      return NextResponse.next({ request })
    }
    const url = request.nextUrl.clone()
    url.pathname = '/setup'
    url.search = ''
    // No Supabase client exists yet, so there is nothing to carry — but every
    // redirect in this file goes through the helper so that the one case which
    // *does* need a carrier can never be the odd one out.
    return redirectPreservingCookies(url)
  }

  if (!hasSessionCookie(request)) {
    if (isPublicPath(pathname)) {
      return NextResponse.next({ request })
    }
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    // Preserve where they were heading so login can return them there.
    url.search = pathname === '/' ? '' : `?next=${encodeURIComponent(pathname)}`
    return redirectPreservingCookies(url)
  }

  let response = NextResponse.next({ request })
  const { supabaseUrl, supabaseAnonKey } = publicEnv()

  const supabase = createServerClient<Database>(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value)
        }
        response = NextResponse.next({ request })
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options)
        }
      },
    },
  })

  // getUser() revalidates the token with the auth server. getSession() only
  // decodes the cookie, which a client could have forged.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Every redirect below happens *after* getUser(), so each one must carry
  // `response` — it may hold a refreshed (or cleared) session.
  if (!user && !isPublicPath(pathname)) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.search = pathname === '/' ? '' : `?next=${encodeURIComponent(pathname)}`
    // Carrying the cookies matters here too: when the session is genuinely
    // dead, Supabase clears them, and propagating that clearance is what lets
    // the next request short-circuit at `hasSessionCookie` instead of
    // re-attempting a hopeless refresh on every navigation.
    return redirectPreservingCookies(url, response)
  }

  // A signed-in user landing on the login screen belongs in the app.
  if (user && (pathname === '/login' || pathname === '/signup')) {
    const url = request.nextUrl.clone()
    url.pathname = '/dashboard'
    url.search = ''
    return redirectPreservingCookies(url, response)
  }

  return response
}
