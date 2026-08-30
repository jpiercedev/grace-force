import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Regression tests for the production redirect loop.
 *
 * The failure was: `getUser()` refreshes an expired token and `@supabase/ssr`
 * writes the new token pair onto the response — but the redirect branches
 * returned a fresh `NextResponse.redirect()`, discarding them. With refresh
 * rotation the old token is already spent, so the next request fails auth and
 * bounces back, forever.
 *
 * A test that only checks "signed-in user at /login gets a 307 to /dashboard"
 * passes against the broken code. What distinguishes broken from fixed is
 * whether the refreshed cookies survive the redirect — and, decisively,
 * whether a browser carrying those cookies converges. The chain simulation at
 * the bottom is the test that would have caught this.
 */

const AUTH_COOKIE = 'sb-phhkhvewcclzjkdbjmqw-auth-token'

// State the fake Supabase client reads, set per test.
let currentUser: { id: string } | null = null
let cookiesToWrite: Array<{ name: string; value: string; options?: Record<string, unknown> }> = []

vi.mock('@supabase/ssr', () => ({
  createServerClient: (_url: string, _key: string, opts: any) => ({
    auth: {
      getUser: async () => {
        // Mirrors the real client: any token refresh (or clearance) is handed
        // to setAll *before* getUser resolves.
        if (cookiesToWrite.length > 0) opts.cookies.setAll(cookiesToWrite)
        return { data: { user: currentUser }, error: currentUser ? null : { message: 'invalid' } }
      },
    },
  }),
}))

vi.mock('@/lib/env', () => ({
  isSupabaseConfigured: () => true,
  publicEnv: () => ({
    supabaseUrl: 'https://phhkhvewcclzjkdbjmqw.supabase.co',
    supabaseAnonKey: 'sb_publishable_test',
  }),
}))

const { NextRequest } = await import('next/server')
const { updateSession } = await import('@/lib/supabase/middleware')

function request(path: string, cookies: Record<string, string> = {}) {
  const req = new NextRequest(new URL(`https://crm.example.org${path}`))
  for (const [name, value] of Object.entries(cookies)) {
    req.cookies.set(name, value)
  }
  return req
}

function location(response: { headers: Headers }): string | null {
  const raw = response.headers.get('location')
  return raw ? new URL(raw).pathname + new URL(raw).search : null
}

beforeEach(() => {
  currentUser = null
  cookiesToWrite = []
})

describe('signed-in user visiting /login', () => {
  it('redirects exactly once to /dashboard', async () => {
    currentUser = { id: 'user-1' }
    const response = await updateSession(request('/login', { [AUTH_COOKIE]: 'valid-token' }))

    expect(response.status).toBe(307)
    expect(location(response)).toBe('/dashboard')
  })

  it('preserves cookies refreshed during that redirect', async () => {
    currentUser = { id: 'user-1' }
    cookiesToWrite = [
      { name: AUTH_COOKIE, value: 'REFRESHED-token', options: { path: '/', httpOnly: true } },
    ]

    const response = await updateSession(request('/login', { [AUTH_COOKIE]: 'stale-token' }))

    // Without this the browser keeps the spent token and the loop begins.
    expect(response.cookies.get(AUTH_COOKIE)?.value).toBe('REFRESHED-token')
  })

  it('keeps the cookie attributes, not just the value', async () => {
    currentUser = { id: 'user-1' }
    cookiesToWrite = [
      {
        name: AUTH_COOKIE,
        value: 'REFRESHED-token',
        options: { path: '/', httpOnly: true, sameSite: 'lax', maxAge: 3600 },
      },
    ]

    const response = await updateSession(request('/login', { [AUTH_COOKIE]: 'stale-token' }))
    const cookie = response.cookies.get(AUTH_COOKIE)

    // A cookie that loses its path or httpOnly flag may not be sent back at
    // all, which reproduces the same symptom by a different route.
    expect(cookie?.path).toBe('/')
    expect(cookie?.httpOnly).toBe(true)
    expect(cookie?.sameSite).toBe('lax')
  })

  it('carries chunked session cookies across the redirect', async () => {
    // Large sessions are split into .0/.1 — dropping one corrupts the session
    // just as thoroughly as dropping both.
    currentUser = { id: 'user-1' }
    cookiesToWrite = [
      { name: `${AUTH_COOKIE}.0`, value: 'part-one', options: { path: '/' } },
      { name: `${AUTH_COOKIE}.1`, value: 'part-two', options: { path: '/' } },
    ]

    const response = await updateSession(request('/login', { [`${AUTH_COOKIE}.0`]: 'old' }))

    expect(response.cookies.get(`${AUTH_COOKIE}.0`)?.value).toBe('part-one')
    expect(response.cookies.get(`${AUTH_COOKIE}.1`)?.value).toBe('part-two')
  })
})

describe('signed-in user visiting /dashboard', () => {
  it('is not redirected back to /login', async () => {
    currentUser = { id: 'user-1' }
    const response = await updateSession(request('/dashboard', { [AUTH_COOKIE]: 'valid-token' }))

    expect(response.status).not.toBe(307)
    expect(location(response)).toBeNull()
  })

  it('still receives refreshed cookies on the pass-through', async () => {
    currentUser = { id: 'user-1' }
    cookiesToWrite = [{ name: AUTH_COOKIE, value: 'REFRESHED', options: { path: '/' } }]

    const response = await updateSession(request('/dashboard', { [AUTH_COOKIE]: 'stale' }))

    expect(response.cookies.get(AUTH_COOKIE)?.value).toBe('REFRESHED')
  })
})

describe('unauthenticated user', () => {
  it('is redirected from /dashboard to /login with the destination preserved', async () => {
    const response = await updateSession(request('/dashboard'))

    expect(response.status).toBe(307)
    expect(location(response)).toBe('/login?next=%2Fdashboard')
  })

  it('reaches /login without a redirect', async () => {
    const response = await updateSession(request('/login'))
    expect(location(response)).toBeNull()
  })

  it('can reach the unlisted tutorial and its video without signing in', async () => {
    const guide = await updateSession(request('/guide/grace-lead-manager-4f7c2a9d'))
    const video = await updateSession(
      request('/guide/grace-lead-manager-4f7c2a9d/grace-lead-manager-tutorial.mp4'),
    )

    expect(location(guide)).toBeNull()
    expect(location(video)).toBeNull()
  })

  it('short-circuits without contacting the auth server when no session cookie exists', async () => {
    // A user with no cookie must never cost a getUser() round-trip.
    currentUser = { id: 'should-not-be-consulted' }
    const response = await updateSession(request('/dashboard'))

    expect(response.status).toBe(307)
    expect(location(response)).toBe('/login?next=%2Fdashboard')
  })
})

describe('invalid or expired session', () => {
  it('terminates at /login rather than looping', async () => {
    currentUser = null
    const response = await updateSession(request('/dashboard', { [AUTH_COOKIE]: 'expired' }))

    expect(response.status).toBe(307)
    expect(location(response)).toBe('/login?next=%2Fdashboard')
  })

  it('propagates the cookie clearance so the next request cannot retry the dead refresh', async () => {
    currentUser = null
    cookiesToWrite = [{ name: AUTH_COOKIE, value: '', options: { path: '/', maxAge: 0 } }]

    const response = await updateSession(request('/dashboard', { [AUTH_COOKIE]: 'expired' }))

    expect(response.cookies.get(AUTH_COOKIE)?.value).toBe('')
    expect(response.cookies.get(AUTH_COOKIE)?.maxAge).toBe(0)
  })

  it('does not bounce a dead session away from /login', async () => {
    currentUser = null
    const response = await updateSession(request('/login', { [AUTH_COOKIE]: 'expired' }))

    expect(location(response)).toBeNull()
  })
})

/**
 * The decisive test. A miniature browser: it carries cookies between requests
 * and follows Location headers, exactly as Chrome does.
 *
 * Against the pre-fix middleware this hits the hop limit, because the refreshed
 * cookie never reaches the jar. Against the fix it settles in one hop.
 */
describe('redirect chain convergence', () => {
  async function followChain(
    start: string,
    jar: Record<string, string>,
    maxHops = 10,
  ): Promise<{ path: string; hops: number }> {
    let path = start
    let hops = 0

    while (hops < maxHops) {
      const response = await updateSession(request(path, jar))

      // Apply Set-Cookie exactly as a browser would, including deletions.
      for (const cookie of response.cookies.getAll()) {
        if (cookie.value === '' || cookie.maxAge === 0) delete jar[cookie.name]
        else jar[cookie.name] = cookie.value
      }

      const next = location(response)
      if (!next) return { path, hops }
      path = next
      hops += 1
    }

    throw new Error(`redirect loop: still bouncing after ${maxHops} hops, last at ${path}`)
  }

  it('settles a signed-in user at /dashboard in one hop', async () => {
    currentUser = { id: 'user-1' }
    // The token is refreshed on first touch, as it would be near expiry.
    cookiesToWrite = [{ name: AUTH_COOKIE, value: 'REFRESHED', options: { path: '/' } }]

    const jar: Record<string, string> = { [AUTH_COOKIE]: 'about-to-expire' }
    const result = await followChain('/login', jar)

    expect(result).toEqual({ path: '/dashboard', hops: 1 })
    expect(jar[AUTH_COOKIE]).toBe('REFRESHED')
  })

  it('settles an unauthenticated user at /login in one hop', async () => {
    currentUser = null
    const result = await followChain('/dashboard', {})

    expect(result.path).toBe('/login?next=%2Fdashboard')
    expect(result.hops).toBe(1)
  })

  it('settles a dead session at /login and clears the cookie on the way', async () => {
    currentUser = null
    cookiesToWrite = [{ name: AUTH_COOKIE, value: '', options: { path: '/', maxAge: 0 } }]

    const jar: Record<string, string> = { [AUTH_COOKIE]: 'expired' }
    const result = await followChain('/dashboard', jar)

    expect(result.path).toBe('/login?next=%2Fdashboard')
    expect(jar[AUTH_COOKIE]).toBeUndefined()
  })

  it('does not loop when the session refreshes on every single request', async () => {
    // The pathological case the bug depended on: rotation on each touch. If
    // any hop drops the new cookie the chain cannot converge.
    currentUser = { id: 'user-1' }
    let rotation = 0
    const jar: Record<string, string> = { [AUTH_COOKIE]: 'rotation-0' }

    const originalWrite = cookiesToWrite
    void originalWrite

    let path = '/login'
    for (let hop = 0; hop < 4; hop += 1) {
      rotation += 1
      cookiesToWrite = [
        { name: AUTH_COOKIE, value: `rotation-${rotation}`, options: { path: '/' } },
      ]

      const response = await updateSession(request(path, jar))
      for (const cookie of response.cookies.getAll()) jar[cookie.name] = cookie.value

      const next = location(response)
      if (!next) break
      path = next
    }

    expect(path).toBe('/dashboard')
    expect(jar[AUTH_COOKIE]).toBe(`rotation-${rotation}`)
  })
})
