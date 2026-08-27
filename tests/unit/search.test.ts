import { describe, expect, it, vi } from 'vitest'

// `search.ts` is a server module; the guard import has no meaning under Vitest's
// node environment, where it would otherwise throw on load.
vi.mock('server-only', () => ({}))

const { sanitizeLikeTerm, snippet } = await import('@/lib/queries/search')

describe('sanitizeLikeTerm', () => {
  it('removes the characters that would rewrite a PostgREST or= filter', () => {
    expect(sanitizeLikeTerm('smith,(or)')).toBe('smith or')
    expect(sanitizeLikeTerm('o"neill')).toBe('o neill')
    expect(sanitizeLikeTerm("o'neill")).toBe('o neill')
  })

  it('removes wildcards so a typed % searches for text', () => {
    expect(sanitizeLikeTerm('%')).toBe('')
    expect(sanitizeLikeTerm('gr%ce*')).toBe('gr ce')
  })

  it('keeps underscores, which only ever widen a match', () => {
    expect(sanitizeLikeTerm('first_last@example.org')).toBe('first_last@example.org')
  })

  it('collapses whitespace and trims', () => {
    expect(sanitizeLikeTerm('  ruth   adeyemi  ')).toBe('ruth adeyemi')
  })
})

describe('snippet', () => {
  it('returns nothing for empty text', () => {
    expect(snippet(null, 'grace')).toBeNull()
    expect(snippet('   ', 'grace')).toBeNull()
  })

  it('windows the text around the match and marks both elisions', () => {
    const text = `${'a'.repeat(100)} needle ${'b'.repeat(100)}`
    // The radius counts the spaces around the match, so nine letters survive
    // on each side of a ten-character window.
    const result = snippet(text, 'needle', { radius: 10 })
    expect(result).toBe(`…${'a'.repeat(9)} needle ${'b'.repeat(9)}…`)
  })

  it('matches case-insensitively', () => {
    expect(snippet('Called Pastor Grace about the retreat', 'grace', { radius: 5 })).toContain(
      'Grace',
    )
  })

  it('does not mark an elision that is not there', () => {
    expect(snippet('Short note', 'note')).toBe('Short note')
  })

  it('falls back to the most specific word when the phrase is absent', () => {
    const result = snippet('Spoke with Yolanda after the service', 'yolanda smith', { radius: 4 })
    expect(result).toContain('Yolanda')
  })

  it('collapses whitespace so a snippet stays one line', () => {
    expect(snippet('first line\n\n  second line', 'second')).toBe('first line second line')
  })

  it('returns the head of the text when nothing matches and a fallback is allowed', () => {
    expect(snippet('An unrelated note', 'grace', { radius: 4 })).toBe('An unrel…')
  })

  it('returns nothing when nothing matches and no fallback is allowed', () => {
    expect(snippet('An unrelated note', 'grace', { fallback: false })).toBeNull()
  })
})
