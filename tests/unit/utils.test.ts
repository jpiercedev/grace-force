import { describe, expect, it } from 'vitest'
import {
  chunk,
  contactDisplayName,
  formatCurrency,
  formatRelative,
  initials,
  isOverdue,
  normalizeEmail,
  normalizePhone,
  parseCurrencyToCents,
  pluralize,
  truncate,
} from '@/lib/utils'

describe('formatCurrency', () => {
  it('formats from cents, dropping trailing zeros on whole amounts', () => {
    expect(formatCurrency(50000)).toBe('$500')
    expect(formatCurrency(123456)).toBe('$1,234.56')
    expect(formatCurrency(1)).toBe('$0.01')
    expect(formatCurrency(0)).toBe('$0')
  })

  it('renders an em dash rather than $0 for missing values', () => {
    // A contact with no giving history is different from one who gave nothing.
    expect(formatCurrency(null)).toBe('—')
    expect(formatCurrency(undefined)).toBe('—')
  })

  it('honours the currency code', () => {
    expect(formatCurrency(2500, 'EUR')).toContain('25')
  })
})

describe('parseCurrencyToCents', () => {
  it('parses the shapes that appear in real CSV exports', () => {
    expect(parseCurrencyToCents('$1,234.56')).toBe(123456)
    expect(parseCurrencyToCents('1234.56')).toBe(123456)
    expect(parseCurrencyToCents('1,000')).toBe(100000)
    expect(parseCurrencyToCents('  $25.00  ')).toBe(2500)
    expect(parseCurrencyToCents('-50')).toBe(-5000)
  })

  it('rounds rather than truncating, so half-cents do not silently vanish', () => {
    expect(parseCurrencyToCents('10.005')).toBe(1001)
    expect(parseCurrencyToCents(19.99)).toBe(1999)
  })

  it('returns null for anything unparseable', () => {
    expect(parseCurrencyToCents('')).toBeNull()
    expect(parseCurrencyToCents('abc')).toBeNull()
    expect(parseCurrencyToCents('$')).toBeNull()
    expect(parseCurrencyToCents('.')).toBeNull()
    expect(parseCurrencyToCents(null)).toBeNull()
    expect(parseCurrencyToCents(Number.NaN)).toBeNull()
  })
})

describe('formatRelative', () => {
  const now = new Date('2026-08-05T12:00:00Z')

  it('describes the past and the future differently', () => {
    expect(formatRelative('2026-08-05T11:00:00Z', now)).toBe('1h ago')
    expect(formatRelative('2026-08-05T13:00:00Z', now)).toBe('in 1h')
  })

  it('scales the unit with the distance', () => {
    expect(formatRelative('2026-08-05T11:55:00Z', now)).toBe('5m ago')
    expect(formatRelative('2026-08-02T12:00:00Z', now)).toBe('3d ago')
    expect(formatRelative('2026-05-05T12:00:00Z', now)).toBe('3mo ago')
    expect(formatRelative('2024-08-05T12:00:00Z', now)).toBe('2y ago')
  })

  it('collapses the last minute to "just now"', () => {
    expect(formatRelative('2026-08-05T11:59:30Z', now)).toBe('just now')
  })

  it('handles missing and malformed input', () => {
    expect(formatRelative(null, now)).toBe('—')
    expect(formatRelative('not-a-date', now)).toBe('—')
  })
})

describe('isOverdue', () => {
  const now = new Date('2026-08-05T12:00:00Z')

  it('is true only for a past due date', () => {
    expect(isOverdue('2026-08-05T11:59:00Z', now)).toBe(true)
    expect(isOverdue('2026-08-05T12:01:00Z', now)).toBe(false)
  })

  it('treats a missing due date as not overdue', () => {
    expect(isOverdue(null, now)).toBe(false)
  })
})

describe('contactDisplayName', () => {
  it('prefers the name someone actually goes by', () => {
    expect(
      contactDisplayName({ first_name: 'Katherine', preferred_name: 'Kate', last_name: 'Johnson' }),
    ).toBe('Kate Johnson')
  })

  it('falls back through the fields that might be present', () => {
    expect(contactDisplayName({ first_name: 'Ada', last_name: 'Lovelace' })).toBe('Ada Lovelace')
    expect(contactDisplayName({ organization_name: 'Grace Church' })).toBe('Grace Church')
    expect(contactDisplayName({ email: 'someone@example.org' })).toBe('someone@example.org')
    expect(contactDisplayName({})).toBe('Unnamed contact')
  })

  it('does not leave stray whitespace when only one name part exists', () => {
    expect(contactDisplayName({ first_name: 'Ada' })).toBe('Ada')
    expect(contactDisplayName({ last_name: 'Lovelace' })).toBe('Lovelace')
  })
})

describe('initials', () => {
  it('uses first and last for multi-part names', () => {
    expect(initials('Ada Lovelace')).toBe('AL')
    expect(initials('Mary Jackson Smith')).toBe('MS')
  })

  it('falls back sensibly for one word or none', () => {
    expect(initials('Grace')).toBe('GR')
    expect(initials('   ')).toBe('?')
  })
})

describe('normalisation matches the database generated columns', () => {
  it('lowercases and trims emails, treating blank as absent', () => {
    expect(normalizeEmail('  Ada@Example.ORG ')).toBe('ada@example.org')
    expect(normalizeEmail('')).toBeNull()
    expect(normalizeEmail('   ')).toBeNull()
    expect(normalizeEmail(null)).toBeNull()
  })

  it('reduces phones to digits, keeping a leading +', () => {
    expect(normalizePhone('(555) 123-4567')).toBe('5551234567')
    expect(normalizePhone('+1 555 123 4567')).toBe('+15551234567')
    expect(normalizePhone('abc')).toBeNull()
    expect(normalizePhone(null)).toBeNull()
  })
})

describe('truncate', () => {
  it('breaks on a word boundary when one is close enough', () => {
    const result = truncate('the quick brown fox jumps over the lazy dog', 20)
    expect(result.endsWith('…')).toBe(true)
    expect(result.length).toBeLessThanOrEqual(21)
    expect(result).not.toContain('jum…')
  })

  it('leaves short strings alone', () => {
    expect(truncate('short', 20)).toBe('short')
    expect(truncate(null)).toBe('')
  })
})

describe('pluralize', () => {
  it('agrees with the count', () => {
    expect(pluralize(1, 'contact')).toBe('1 contact')
    expect(pluralize(2, 'contact')).toBe('2 contacts')
    expect(pluralize(0, 'contact')).toBe('0 contacts')
    expect(pluralize(3, 'person', 'people')).toBe('3 people')
  })

  it('groups thousands so large counts stay readable', () => {
    expect(pluralize(1234, 'contact')).toBe('1,234 contacts')
  })
})

describe('chunk', () => {
  it('splits into fixed-size batches with a short remainder', () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
    expect(chunk([], 3)).toEqual([])
  })

  it('rejects a non-positive size rather than looping forever', () => {
    expect(() => chunk([1], 0)).toThrow(/positive/)
  })
})
