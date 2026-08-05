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
    return NextResponse.redirect(url)
  }

  if (!hasSessionCookie(request)) {
    if (isPublicPath(pathname)) {
      return NextResponse.next({ request })
    }
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    // Preserve where they were heading so login can return them there.
    url.search = pathname === '/' ? '' : `?next=${encodeURIComponent(pathname)}`
    return NextResponse.redirect(url)
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

  if (!user && !isPublicPath(pathname)) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.search = pathname === '/' ? '' : `?next=${encodeURIComponent(pathname)}`
    return NextResponse.redirect(url)
  }

  // A signed-in user landing on the login screen belongs in the app.
  if (user && (pathname === '/login' || pathname === '/signup')) {
    const url = request.nextUrl.clone()
    url.pathname = '/dashboard'
    url.search = ''
    return NextResponse.redirect(url)
  }

  return response
}
