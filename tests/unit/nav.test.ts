import { describe, expect, it } from 'vitest'
import { visibleNavigation } from '@/components/layout/nav'
import type { ProfileRow, UserRole } from '@/types/database'

/**
 * The Sales consolidation moved the boards under one /sales destination.
 * These tests pin the navigation's contract for it: Sales is an everyday
 * primary destination for everyone, the old /pipelines entry is gone, and the
 * quieter "more" group keeps shared records visible to viewers while holding
 * write tooling back for staff.
 */

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

const ROLES: UserRole[] = ['admin', 'staff', 'viewer']

function allHrefs(row: ProfileRow): string[] {
  const navigation = visibleNavigation(row)
  return [
    ...navigation.primary.map((item) => item.href),
    ...navigation.more.map((item) => item.href),
    ...(navigation.settings ? [navigation.settings.href] : []),
  ]
}

describe('visibleNavigation and the Sales surfaces', () => {
  it('puts /sales in the primary rail for every active role', () => {
    for (const role of ROLES) {
      const navigation = visibleNavigation(profile({ role }))
      expect(
        navigation.primary.map((item) => item.href),
        `primary rail for a ${role}`,
      ).toContain('/sales')
    }
  })

  it('labels the /sales destination "Sales"', () => {
    const navigation = visibleNavigation(profile())
    const sales = navigation.primary.find((item) => item.href === '/sales')
    expect(sales?.label).toBe('Sales')
  })

  it('offers no /pipelines destination anywhere — the boards live under Sales now', () => {
    for (const role of ROLES) {
      expect(allHrefs(profile({ role })), `navigation for a ${role}`).not.toContain('/pipelines')
    }
  })

  it('keeps giving and planned gifts in the more group even for a viewer', () => {
    const navigation = visibleNavigation(profile({ role: 'viewer' }))
    const more = navigation.more.map((item) => item.href)
    expect(more).toContain('/giving')
    expect(more).toContain('/proposals')
  })

  it('shows import and export to staff but never to a viewer', () => {
    const staffMore = visibleNavigation(profile({ role: 'staff' })).more.map((item) => item.href)
    expect(staffMore).toContain('/import')
    expect(staffMore).toContain('/export')

    const viewerMore = visibleNavigation(profile({ role: 'viewer' })).more.map((item) => item.href)
    expect(viewerMore).not.toContain('/import')
    expect(viewerMore).not.toContain('/export')
  })
})
