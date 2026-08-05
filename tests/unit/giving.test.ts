import { describe, expect, it, vi } from 'vitest'

// `giving.ts` is a server module; the guard import has no meaning under Vitest's
// node environment, where it would otherwise throw on load.
vi.mock('server-only', () => ({}))

const {
  parseDateParam,
  parseGivingFilters,
  hasGivingFilters,
  resolveGivingRange,
  toDateParam,
  trailingWindowStart,
} = await import('@/lib/queries/giving')

// Built from local parts so the formatted day cannot drift with the runner's
// timezone — the same reason the query layer formats rather than serialises.
const NOW = new Date(2026, 7, 5, 14, 30)

describe('toDateParam', () => {
  it('formats a local calendar day for a DATE column', () => {
    expect(toDateParam(NOW)).toBe('2026-08-05')
  })
})

describe('parseDateParam', () => {
  it('accepts a plain ISO day', () => {
    expect(parseDateParam('2026-08-05')).toBe('2026-08-05')
  })

  it('rejects anything else, so a hand-edited URL cannot reach the database', () => {
    expect(parseDateParam('2026-13-45')).toBeNull()
    expect(parseDateParam('05/08/2026')).toBeNull()
    expect(parseDateParam('2026-08-05T10:00:00Z')).toBeNull()
    expect(parseDateParam('')).toBeNull()
    expect(parseDateParam(undefined)).toBeNull()
  })
})

describe('parseGivingFilters', () => {
  it('reads the three supported parameters', () => {
    expect(
      parseGivingFilters({ from: '2026-01-01', to: '2026-06-30', fund: 'General Fund' }),
    ).toEqual({ from: '2026-01-01', to: '2026-06-30', fund: 'General Fund' })
  })

  it('takes the first value when a parameter repeats', () => {
    expect(parseGivingFilters({ fund: ['Missions', 'Building'] }).fund).toBe('Missions')
  })

  it('treats blank and malformed values as absent', () => {
    expect(parseGivingFilters({ from: 'yesterday', to: '', fund: '  ' })).toEqual({
      from: null,
      to: null,
      fund: null,
    })
  })
})

describe('hasGivingFilters', () => {
  it('is false only when nothing is set', () => {
    expect(hasGivingFilters({ from: null, to: null, fund: null })).toBe(false)
    expect(hasGivingFilters({ from: '2026-01-01', to: null, fund: null })).toBe(true)
    expect(hasGivingFilters({ from: null, to: null, fund: 'Missions' })).toBe(true)
  })
})

describe('resolveGivingRange', () => {
  it('defaults to the trailing twelve months, matching the rollup view', () => {
    expect(resolveGivingRange({ from: null, to: null, fund: null }, NOW)).toEqual({
      from: trailingWindowStart(NOW),
      to: '2026-08-05',
    })
    expect(trailingWindowStart(NOW)).toBe('2025-08-05')
  })

  it('keeps whichever bound was supplied', () => {
    expect(resolveGivingRange({ from: '2026-01-01', to: null, fund: null }, NOW)).toEqual({
      from: '2026-01-01',
      to: '2026-08-05',
    })
  })

  it('rights a reversed range rather than reporting nothing', () => {
    expect(resolveGivingRange({ from: '2026-06-30', to: '2026-01-01', fund: null }, NOW)).toEqual({
      from: '2026-01-01',
      to: '2026-06-30',
    })
  })
})
