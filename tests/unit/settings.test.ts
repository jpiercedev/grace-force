import { describe, expect, it } from 'vitest'
import {
  isLastAdminRefusal,
  memberAccessSchema,
} from '@/app/(app)/settings/team/access'
import {
  ENGAGEMENT_COLORS,
  WIRED_SLUGS,
  createEngagementTypeSchema,
  slugify,
  updateEngagementTypeSchema,
} from '@/app/(app)/settings/engagement-types/catalogue'

/**
 * Administration input handling.
 *
 * Two things here are load-bearing beyond ordinary validation: recognising the
 * database's refusal to remove the last administrator, so it reads as a
 * sentence rather than a 500; and keeping a type's slug out of every update,
 * because lead intake and the Mailchimp sync resolve types by slug alone.
 */

const UUID = '11111111-1111-4111-8111-111111111111'

describe('memberAccessSchema', () => {
  it('reads the checkboxes a browser actually submits', () => {
    const parsed = memberAccessSchema.parse({
      id: UUID,
      role: 'staff',
      // An unchecked box is absent from the payload entirely.
      is_active: null,
    })

    expect(parsed).toEqual({
      id: UUID,
      role: 'staff',
      is_active: false,
    })
  })

  it('refuses a role outside the three the database knows', () => {
    const result = memberAccessSchema.safeParse({
      id: UUID,
      role: 'superuser',
      is_active: 'on',
    })

    expect(result.success).toBe(false)
  })

  it('refuses an id that is not a uuid rather than sending it to Postgres', () => {
    const result = memberAccessSchema.safeParse({
      id: 'me',
      role: 'admin',
      is_active: 'on',
    })

    expect(result.success).toBe(false)
  })
})

describe('isLastAdminRefusal', () => {
  it('recognises the trigger message whatever its casing', () => {
    expect(isLastAdminRefusal({ message: 'Cannot remove the last active administrator' })).toBe(true)
    expect(
      isLastAdminRefusal({ message: 'ERROR: cannot remove the LAST ACTIVE ADMINISTRATOR' }),
    ).toBe(true)
  })

  it('does not claim every check violation is about administrators', () => {
    expect(isLastAdminRefusal({ message: 'new row violates check constraint' })).toBe(false)
    expect(isLastAdminRefusal({ message: null })).toBe(false)
    expect(isLastAdminRefusal(null)).toBe(false)
  })
})

describe('createEngagementTypeSchema', () => {
  it('normalises a slug and takes the column default for a blank position', () => {
    const parsed = createEngagementTypeSchema.parse({
      slug: '  Prayer_Team  ',
      label: '  Prayer Team  ',
      description: '',
      color: 'violet',
      sort_order: '',
      is_active: 'on',
    })

    expect(parsed.slug).toBe('prayer_team')
    expect(parsed.label).toBe('Prayer Team')
    expect(parsed.description).toBeNull()
    expect(parsed.sort_order).toBe(100)
    expect(parsed.is_active).toBe(true)
  })

  it('refuses a slug the check constraint would reject', () => {
    for (const slug of ['prayer team', 'prayer-team', 'Prayer!', 'p']) {
      expect(createEngagementTypeSchema.safeParse({
        slug,
        label: 'Prayer Team',
        description: '',
        color: 'violet',
        sort_order: '10',
        is_active: 'on',
      }).success).toBe(false)
    }
  })

  it('refuses a colour Tailwind never compiled a class for', () => {
    const result = createEngagementTypeSchema.safeParse({
      slug: 'prayer_team',
      label: 'Prayer Team',
      description: '',
      color: '#7c3aed',
      sort_order: '10',
      is_active: 'on',
    })

    expect(result.success).toBe(false)
  })

  it('refuses a position that is not a whole number in range', () => {
    for (const sort_order of ['1.5', '-1', '10000', 'first']) {
      expect(createEngagementTypeSchema.safeParse({
        slug: 'prayer_team',
        label: 'Prayer Team',
        description: '',
        color: 'violet',
        sort_order,
        is_active: 'on',
      }).success).toBe(false)
    }
  })
})

describe('updateEngagementTypeSchema', () => {
  it('drops a slug even when the payload carries one', () => {
    const parsed = updateEngagementTypeSchema.parse({
      id: UUID,
      slug: 'something_else',
      label: 'Prayer Team',
      description: 'Committed to praying',
      color: 'violet',
      sort_order: '30',
      is_active: 'on',
    })

    expect(parsed).not.toHaveProperty('slug')
    expect(parsed.sort_order).toBe(30)
  })
})

describe('slugify', () => {
  it('produces a slug the create schema accepts', () => {
    expect(slugify('Prayer Partner')).toBe('prayer_partner')
    expect(slugify('  Major Gift — Cultivation!  ')).toBe('major_gift_cultivation')
    expect(slugify('Team 2026')).toBe('team_2026')
  })

  it('leaves nothing that would need trimming at either end', () => {
    expect(slugify('--- ---')).toBe('')
    expect(slugify('!Donor!')).toBe('donor')
  })
})

describe('catalogue vocabulary', () => {
  it('names the slugs other parts of the app resolve by name', () => {
    // `convert_lead()` starts these from the public form, and the Mailchimp
    // sync needs `newsletter`; the screen warns before any of them change.
    expect(WIRED_SLUGS.newsletter).toBeTruthy()
    expect(WIRED_SLUGS.donor).toBeTruthy()
    expect(WIRED_SLUGS.staff_team).toBeUndefined()
  })

  it('offers only colours the badge component can render', () => {
    expect(ENGAGEMENT_COLORS).toContain('slate')
    expect(ENGAGEMENT_COLORS).not.toContain('purple')
  })
})
