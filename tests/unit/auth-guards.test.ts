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

let sessionUser: { id: string; email: string } | null = null
let profileRow: Record<string, unknown> | null = null

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: sessionUser } }) },
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: profileRow }) }),
      }),
    }),
  }),
}))

const { requireProfile, getSessionUser, getCurrentProfile } = await import('@/lib/auth')

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
  email: 'staff@graceforce.test',
  role: 'staff',
  is_active: true,
  can_view_giving: false,
}

beforeEach(() => {
  sessionUser = null
  profileRow = null
})

describe('requireProfile', () => {
  it('returns the profile when the account is active', async () => {
    sessionUser = { id: 'user-1', email: 'staff@graceforce.test' }
    profileRow = ACTIVE_PROFILE

    await expect(requireProfile()).resolves.toMatchObject({ id: 'user-1', is_active: true })
  })

  it('sends a genuinely signed-out visitor to /login', async () => {
    sessionUser = null
    profileRow = null

    expect(await redirectFrom(requireProfile)).toBe('/login')
  })

  it('does NOT send a signed-in user without a profile to /login', async () => {
    // This is the loop. Middleware would bounce them straight back.
    sessionUser = { id: 'orphan', email: 'orphan@graceforce.test' }
    profileRow = null

    const target = await redirectFrom(requireProfile)

    expect(target).not.toBe('/login')
    expect(target).toBe('/no-access?reason=unprovisioned')
  })

  it('sends a deactivated account to /no-access', async () => {
    sessionUser = { id: 'user-1', email: 'staff@graceforce.test' }
    profileRow = { ...ACTIVE_PROFILE, is_active: false }

    expect(await redirectFrom(requireProfile)).toBe('/no-access')
  })
})

describe('getSessionUser and getCurrentProfile distinguish the two nulls', () => {
  it('reports a session even when no profile row exists', async () => {
    sessionUser = { id: 'orphan', email: 'orphan@graceforce.test' }
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
    sessionUser = { id: 'user-1', email: 'staff@graceforce.test' }
    profileRow = ACTIVE_PROFILE

    const { path } = await walk('/login', true)
    expect(path).toBe('/dashboard')
  })

  it('settles an unprovisioned signed-in user at /no-access instead of looping', async () => {
    sessionUser = { id: 'orphan', email: 'orphan@graceforce.test' }
    profileRow = null

    // Pre-fix this threw: /login -> /dashboard -> /login -> /dashboard -> ...
    const { path } = await walk('/login', true)
    expect(path).toBe('/no-access?reason=unprovisioned')
  })

  it('settles a deactivated user at /no-access', async () => {
    sessionUser = { id: 'user-1', email: 'staff@graceforce.test' }
    profileRow = { ...ACTIVE_PROFILE, is_active: false }

    const { path } = await walk('/dashboard', true)
    expect(path).toBe('/no-access')
  })

  it('settles a signed-out visitor at /login', async () => {
    const { path } = await walk('/dashboard', false)
    expect(path).toBe('/login?next=%2Fdashboard')
  })
})
