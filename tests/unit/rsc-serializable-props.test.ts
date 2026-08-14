import { describe, expect, it } from 'vitest'
import * as navModule from '@/components/layout/nav'
import { visibleNavigation } from '@/components/layout/nav'
import type { ProfileRow, UserRole } from '@/types/database'

/**
 * Guards the server → client boundary.
 *
 * React has to serialise props handed to a Client Component, and a function is
 * not serialisable. Passing one fails at runtime, in production, with:
 *
 *   Functions cannot be passed directly to Client Components unless you
 *   explicitly expose it by marking it with "use server".
 *
 * That is exactly what happened: nav items carried a `visible` predicate, and
 * the resolver filtered with `Array.prototype.filter`, which returns the
 * *same* objects — predicate attached — straight into `<AppShell>`.
 *
 * Nothing in the type system catches a stray function on a plain object, and
 * the build does not either: it only surfaces when the component actually
 * renders. Hence this test.
 */

/** Every path at which a function is reachable, for a legible failure. */
function findFunctionPaths(value: unknown, path = '$', seen = new Set<object>()): string[] {
  if (typeof value === 'function') return [path]
  if (value === null || typeof value !== 'object') return []

  // Cycles would otherwise recurse forever; they are also not serialisable,
  // but that is a different failure and worth keeping separate.
  if (seen.has(value)) return []
  seen.add(value)

  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => findFunctionPaths(entry, `${path}[${index}]`, seen))
  }

  return Object.entries(value).flatMap(([key, entry]) =>
    findFunctionPaths(entry, `${path}.${key}`, seen),
  )
}

function profile(overrides: Partial<ProfileRow> = {}): ProfileRow {
  return {
    id: 'user-1',
    email: 'person@graceforce.test',
    full_name: 'Test Person',
    avatar_url: null,
    title: null,
    phone: null,
    role: 'staff',
    can_view_giving: false,
    is_active: true,
    last_seen_at: null,
    created_at: '2026-08-05T00:00:00Z',
    updated_at: '2026-08-05T00:00:00Z',
    ...overrides,
  }
}

/** Every capability combination the navigation branches on. */
const PROFILES: Array<[string, ProfileRow]> = [
  ['admin', profile({ role: 'admin', can_view_giving: true })],
  ['admin without giving', profile({ role: 'admin', can_view_giving: false })],
  ['staff', profile({ role: 'staff' })],
  ['staff with giving', profile({ role: 'staff', can_view_giving: true })],
  ['viewer', profile({ role: 'viewer' })],
  ['viewer with giving', profile({ role: 'viewer', can_view_giving: true })],
  ['inactive admin', profile({ role: 'admin', is_active: false, can_view_giving: true })],
]

describe('findFunctionPaths', () => {
  it('detects functions at any depth, which is what makes the guard trustworthy', () => {
    expect(findFunctionPaths({ a: 1 })).toEqual([])
    expect(findFunctionPaths({ a: () => true })).toEqual(['$.a'])
    expect(findFunctionPaths([{ items: [{ visible: () => true }] }])).toEqual([
      '$[0].items[0].visible',
    ])
  })

  it('does not hang on a cycle', () => {
    const cyclic: Record<string, unknown> = { name: 'loop' }
    cyclic.self = cyclic
    expect(findFunctionPaths(cyclic)).toEqual([])
  })
})

describe('navigation crossing to the client', () => {
  for (const [label, row] of PROFILES) {
    it(`carries no function values for a ${label}`, () => {
      const navigation = visibleNavigation(row)
      const functions = findFunctionPaths(navigation)

      expect(
        functions,
        `visibleNavigation() returned function-valued props at: ${functions.join(', ')}. ` +
          'These reach <AppShell>, a Client Component, and will throw in production. ' +
          'Evaluate the predicate on the server and emit plain data instead.',
      ).toEqual([])
    })

    it(`survives a serialisation round-trip for a ${label}`, () => {
      const navigation = visibleNavigation(row)
      // JSON is stricter than React's serialiser, but anything that survives it
      // is certainly safe to hand across the boundary.
      expect(JSON.parse(JSON.stringify(navigation))).toEqual(navigation)
    })
  }

  it('emits exactly the wire fields, so nothing can ride along unnoticed', () => {
    const navigation = visibleNavigation(profile({ role: 'admin', can_view_giving: true }))
    expect(Object.keys(navigation).sort()).toEqual(['more', 'primary', 'settings'])
    for (const item of [...navigation.primary, ...navigation.more, navigation.settings]) {
      expect(item).not.toBeNull()
      expect(Object.keys(item!).sort()).toEqual(['href', 'icon', 'label'])
    }
  })

  it('does not export the predicate-bearing definitions', () => {
    // If the definitions were exported, a server component could pass them
    // straight through and reintroduce the bug.
    const exported = Object.keys(navModule)
    expect(exported).not.toContain('PRIMARY')
    expect(exported).not.toContain('MORE')
    expect(exported).not.toContain('SETTINGS')

    for (const name of exported) {
      const value = navModule[name as keyof typeof navModule]
      if (typeof value === 'object' && value !== null) {
        expect(findFunctionPaths(value), `exported \`${name}\` contains a function`).toEqual([])
      }
    }
  })
})

describe('navigation still filters correctly after the refactor', () => {
  function hrefs(row: ProfileRow): string[] {
    const navigation = visibleNavigation(row)
    return [
      ...navigation.primary.map((item) => item.href),
      ...navigation.more.map((item) => item.href),
      ...(navigation.settings ? [navigation.settings.href] : []),
    ]
  }

  it('shows the settings entry to admins only', () => {
    expect(hrefs(profile({ role: 'admin', can_view_giving: true }))).toContain('/settings/team')
    expect(hrefs(profile({ role: 'staff' }))).not.toContain('/settings/team')
  })

  it('hides write tooling from viewers, but never shared records', () => {
    const visible = hrefs(profile({ role: 'viewer' }))
    expect(visible).not.toContain('/import')
    expect(visible).not.toContain('/export')
    // Shared business records remain — leads and sales included.
    expect(visible).toEqual(
      expect.arrayContaining(['/dashboard', '/contacts', '/sales', '/leads', '/events']),
    )
  })

  it('shares giving and proposals with every active profile, whatever the old flag says', () => {
    const withFlag = hrefs(profile({ role: 'staff', can_view_giving: true }))
    const withoutFlag = hrefs(profile({ role: 'staff', can_view_giving: false }))
    const viewer = hrefs(profile({ role: 'viewer' }))
    for (const shared of ['/giving', '/proposals']) {
      expect(withFlag).toContain(shared)
      expect(withoutFlag).toContain(shared)
      expect(viewer).toContain(shared)
    }
  })

  it('keeps the primary rail to seven destinations at most', () => {
    // The rail is a short list of everyday places, not an index of the
    // database. Seven: Dashboard, People, Sales, Follow-ups, Leads, Events,
    // Call reports.
    for (const [, row] of PROFILES) {
      expect(visibleNavigation(row).primary.length).toBeLessThanOrEqual(7)
    }
  })

  it('never puts search in the rail — it is a field in the header', () => {
    expect(hrefs(profile({ role: 'admin', can_view_giving: true }))).not.toContain('/search')
  })

  it('shows nothing capability-gated to an inactive profile', () => {
    const visible = hrefs(profile({ role: 'admin', is_active: false, can_view_giving: true }))
    for (const gated of ['/import', '/export', '/settings/team']) {
      expect(visible).not.toContain(gated)
    }
  })
})

describe('role coverage', () => {
  it('exercises every role the schema defines', () => {
    const roles: UserRole[] = ['admin', 'staff', 'viewer']
    const covered = new Set(PROFILES.map(([, row]) => row.role))
    for (const role of roles) expect(covered.has(role)).toBe(true)
  })
})
