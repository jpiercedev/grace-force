import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Regression tests for the *second* half of the production redirect loop.
 *
 * Middleware sends a signed-in user away from /login. So if any server-side
 * guard sends a signed-in user *to* /login, the two layers form a perfect
 * cycle:
 *
 *     /login     --(middleware: signed in)--> /dashboard
 *     /dashboard --(guard: no profile row)--> /login        ...forever
 *
 * `requireProfile` did exactly that on a null profile, without checking whether
 * the null meant "no session" or "session but never provisioned". Only the
 * first is a login problem. The second — the `handle_new_user` trigger not
 * firing, or a user predating it — is an access problem, and sending it to
 * /login guarantees the loop no matter how carefully cookies are handled.
 */

// `@/lib/auth` imports `server-only`, which throws outside a server render.
// Stubbing it lets the guard logic be unit-tested without a Next runtime.
vi.mock('server-only', () => ({}))

class RedirectError extends Error {
  constructor(readonly to: string) {
    super(`redirect:${to}`)
  }
}

vi.mock('next/navigation', () => ({
  redirect: (to: string) => {
    throw new RedirectError(to)
  },
}))

// React's cache() memoises per request; identity keeps tests independent.
vi.mock('react', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react')>()),
  cache: <T,>(fn: T) => fn,
}))

let sessionUser:
  | { id: string; email: string; app_metadata?: Record<string, unknown> }
  | null = null
let profileRow: Record<string, unknown> | null = null
let queryError: { code: string; message: string } | null = null

/** How many clients were built, and whether each had resolved its session. */
let clientsCreated = 0
let queriedWithoutSession = 0

vi.mock('@/lib/env', () => ({
  publicEnv: () => ({
    supabaseUrl: 'https://phhkhvewcclzjkdbjmqw.supabase.co',
    supabaseAnonKey: 'sb_publishable_test',
  }),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => {
    clientsCreated += 1
    // Mirrors supabase-js: the access token is attached from auth state, so a
    // client that never resolved its session queries as `anon`.
    let sessionResolved = false
    return {
      auth: {
        getUser: async () => {
          sessionResolved = true
          return { data: { user: sessionUser } }
        },
      },
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => {
              if (!sessionResolved) {
                queriedWithoutSession += 1
                // `anon` has no table privileges in this schema.
                return {
                  data: null,
                  error: { code: '42501', message: 'permission denied for table profiles' },
                }
              }
              if (queryError) return { data: null, error: queryError }
              return { data: profileRow, error: null }
            },
          }),
        }),
      }),
    }
  },
}))

const { requireProfile, getSessionUser, getCurrentProfile, loadProfile } = await import(
  '@/lib/auth'
)

async function redirectFrom(fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await fn()
    return null
  } catch (error) {
    if (error instanceof RedirectError) return error.to
    throw error
  }
}

const ACTIVE_PROFILE = {
  id: 'user-1',
  email: 'staff@gracelead.test',
  role: 'staff',
  is_active: true,
  can_view_giving: false,
}

beforeEach(() => {
  sessionUser = null
  profileRow = null
  queryError = null
  clientsCreated = 0
  queriedWithoutSession = 0
})

describe('requireProfile', () => {
  it('returns the profile when the account is active', async () => {
    sessionUser = { id: 'user-1', email: 'staff@gracelead.test' }
    profileRow = ACTIVE_PROFILE

    await expect(requireProfile()).resolves.toMatchObject({ id: 'user-1', is_active: true })
  })

  it('sends an account that must rotate its password to /change-password', async () => {
    sessionUser = {
      id: 'user-1',
      email: 'staff@gracelead.test',
      app_metadata: { must_change_password: true },
    }
    profileRow = ACTIVE_PROFILE

    expect(await redirectFrom(requireProfile)).toBe('/change-password')
  })

  it('lets an account through once the flag is gone', async () => {
    // The database drops the flag when the password hash changes, so its
    // absence is the same fact as "the password was rotated".
    sessionUser = { id: 'user-1', email: 'staff@gracelead.test', app_metadata: {} }
    profileRow = ACTIVE_PROFILE

    await expect(requireProfile()).resolves.toMatchObject({ id: 'user-1' })
  })

  it('treats a deactivated account as deactivated even if it must rotate', async () => {
    // /no-access is terminal; /change-password would not be, and would hand a
    // revoked account a working route back into the app.
    sessionUser = {
      id: 'user-1',
      email: 'staff@gracelead.test',
      app_metadata: { must_change_password: true },
    }
    profileRow = { ...ACTIVE_PROFILE, is_active: false }

    expect(await redirectFrom(requireProfile)).toBe('/no-access')
  })

  it('does not accept a non-boolean flag as a demand to rotate', async () => {
    sessionUser = {
      id: 'user-1',
      email: 'staff@gracelead.test',
      app_metadata: { must_change_password: 'false' },
    }
    profileRow = ACTIVE_PROFILE

    await expect(requireProfile()).resolves.toMatchObject({ id: 'user-1' })
  })

  it('sends a genuinely signed-out visitor to /login', async () => {
    sessionUser = null
    profileRow = null

    expect(await redirectFrom(requireProfile)).toBe('/login')
  })

  it('does NOT send a signed-in user without a profile to /login', async () => {
    // This is the loop. Middleware would bounce them straight back.
    sessionUser = { id: 'orphan', email: 'orphan@gracelead.test' }
    profileRow = null

    const target = await redirectFrom(requireProfile)

    expect(target).not.toBe('/login')
    expect(target).toBe('/no-access?reason=unprovisioned')
  })

  it('sends a deactivated account to /no-access', async () => {
    sessionUser = { id: 'user-1', email: 'staff@gracelead.test' }
    profileRow = { ...ACTIVE_PROFILE, is_active: false }

    expect(await redirectFrom(requireProfile)).toBe('/no-access')
  })
})

describe('getSessionUser and getCurrentProfile distinguish the two nulls', () => {
  it('reports a session even when no profile row exists', async () => {
    sessionUser = { id: 'orphan', email: 'orphan@gracelead.test' }
    profileRow = null

    await expect(getSessionUser()).resolves.toMatchObject({ id: 'orphan' })
    await expect(getCurrentProfile()).resolves.toBeNull()
  })

  it('reports neither when signed out', async () => {
    await expect(getSessionUser()).resolves.toBeNull()
    await expect(getCurrentProfile()).resolves.toBeNull()
  })
})

/**
 * Composes both layers. Middleware decides whether a path is reachable; the
 * guard decides whether the app will render it. Walking the two together is
 * the only way to prove the pair terminates — either layer alone looks fine.
 */
describe('middleware and guard compose without looping', () => {
  /** Mirrors middleware for a request that carries a valid session. */
  function middlewareTarget(path: string, signedIn: boolean): string | null {
    const publicPrefixes = ['/login', '/signup', '/check-email', '/auth', '/intake', '/setup']
    const isPublic = publicPrefixes.some((p) => path === p || path.startsWith(`${p}/`))

    if (!signedIn) return isPublic ? null : `/login?next=${encodeURIComponent(path)}`
    if (path === '/login' || path === '/signup') return '/dashboard'
    return null
  }

  /** Mirrors the guard that runs inside the protected layout. */
  async function guardTarget(path: string): Promise<string | null> {
    if (!path.startsWith('/dashboard')) return null
    return redirectFrom(requireProfile)
  }

  async function walk(start: string, signedIn: boolean, maxHops = 10) {
    let path = start
    const visited: string[] = []

    for (let hop = 0; hop < maxHops; hop += 1) {
      visited.push(path)

      const viaMiddleware = middlewareTarget(path.split('?')[0]!, signedIn)
      if (viaMiddleware) {
        path = viaMiddleware
        continue
      }

      const viaGuard = await guardTarget(path.split('?')[0]!)
      if (viaGuard) {
        path = viaGuard
        continue
      }

      return { path, visited }
    }

    throw new Error(`redirect loop: ${visited.join(' -> ')}`)
  }

  it('settles an active user at /dashboard', async () => {
    sessionUser = { id: 'user-1', email: 'staff@gracelead.test' }
    profileRow = ACTIVE_PROFILE

    const { path } = await walk('/login', true)
    expect(path).toBe('/dashboard')
  })

  it('settles an unprovisioned signed-in user at /no-access instead of looping', async () => {
    sessionUser = { id: 'orphan', email: 'orphan@gracelead.test' }
    profileRow = null

    // Pre-fix this threw: /login -> /dashboard -> /login -> /dashboard -> ...
    const { path } = await walk('/login', true)
    expect(path).toBe('/no-access?reason=unprovisioned')
  })

  it('settles a deactivated user at /no-access', async () => {
    sessionUser = { id: 'user-1', email: 'staff@gracelead.test' }
    profileRow = { ...ACTIVE_PROFILE, is_active: false }

    const { path } = await walk('/dashboard', true)
    expect(path).toBe('/no-access')
  })

  it('settles a signed-out visitor at /login', async () => {
    const { path } = await walk('/dashboard', false)
    expect(path).toBe('/login?next=%2Fdashboard')
  })
})

/**
 * Read-path contract.
 *
 * The refactor that split session and profile lookup introduced a second
 * Supabase client which queried before resolving its session. `supabase-js`
 * attaches the caller's token from auth state, so that request went out as
 * `anon` — and `anon` has no table privileges in this schema, so it failed
 * with a permission error that the old `const { data }` destructuring then
 * discarded into `null`. A signed-in admin was told their account was not set
 * up.
 *
 * These pin the two properties that prevent it recurring: query on a
 * session-resolved client, and never swallow the error.
 */
describe('profile read path', () => {
  it('resolves the session before querying, so the query is never anonymous', async () => {
    sessionUser = { id: 'user-1', email: 'staff@gracelead.test' }
    profileRow = ACTIVE_PROFILE

    const result = await loadProfile()

    expect(result.status).toBe('ok')
    expect(queriedWithoutSession).toBe(0)
  })

  it('uses a single client for the session and the profile', async () => {
    sessionUser = { id: 'user-1', email: 'staff@gracelead.test' }
    profileRow = ACTIVE_PROFILE

    await loadProfile()

    // Two clients is how the anonymous-query bug got in.
    expect(clientsCreated).toBe(1)
  })

  it('reports a query failure as an error rather than a missing profile', async () => {
    sessionUser = { id: 'user-1', email: 'staff@gracelead.test' }
    profileRow = ACTIVE_PROFILE
    queryError = { code: '42501', message: 'permission denied for table profiles' }

    const result = await loadProfile()

    expect(result.status).toBe('error')
    if (result.status === 'error') {
      expect(result.code).toBe('42501')
      expect(result.message).toContain('permission denied')
    }
  })

  it('sends a query failure to /no-access?reason=error, not to /login or "not set up"', async () => {
    sessionUser = { id: 'user-1', email: 'staff@gracelead.test' }
    queryError = { code: 'PGRST301', message: 'JWT expired' }

    const target = await redirectFrom(requireProfile)

    // Not /login: that would misdiagnose a fault as a credentials problem and
    // re-enter the middleware loop.
    expect(target).toBe('/no-access?reason=error')
  })

  it('still distinguishes a genuinely absent row from a failure', async () => {
    sessionUser = { id: 'orphan', email: 'orphan@gracelead.test' }
    profileRow = null

    const result = await loadProfile()
    expect(result.status).toBe('not-found')
  })
})
