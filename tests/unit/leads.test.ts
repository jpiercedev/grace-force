import { describe, expect, it } from 'vitest'
import { DEFAULT_FORM_KEY, isValidFormKey, parseFormKey } from '@/lib/leads/form'
import {
  DEDUPE_WINDOW_SECONDS,
  clientIpFrom,
  hashIp,
  intakeFieldErrors,
  isHoneypotTripped,
  isOriginAllowed,
  leadDedupeKey,
  leadIntakeSchema,
  matchesIntakeSecret,
  normalizeOrigin,
  rateLimitBucket,
  utmFrom,
} from '@/lib/leads/intake'
import {
  ASSIGNEE_ANYONE,
  ASSIGNEE_ME,
  ASSIGNEE_UNASSIGNED,
  INTENT_STATUS,
  STATUS_ANY,
  interestLabel,
  leadDisplayName,
  parseLeadAssigneeFilter,
  parseLeadIntent,
  parseLeadStatusFilter,
} from '@/lib/leads/triage'

/**
 * The intake endpoint is the only unauthenticated write path in the app, so its
 * defences are tested directly rather than through the route: a regression in
 * any one of them is invisible from the outside until it is being abused.
 */

const NOW = new Date('2026-08-05T12:00:00.000Z')
const SALT = 'a-deployment-secret'

const BASE_LEAD = {
  form_key: 'default',
  email: 'jane@example.org',
  phone: null,
  message: 'I would love to help at the next event.',
}

describe('leadDedupeKey', () => {
  it('is stable for the same submission inside one window', () => {
    const first = leadDedupeKey(BASE_LEAD, NOW)
    const later = leadDedupeKey(BASE_LEAD, new Date(NOW.getTime() + 30_000))
    expect(first).toBe(later)
  })

  it('changes once the window rolls over, so a genuine second enquiry survives', () => {
    const first = leadDedupeKey(BASE_LEAD, NOW)
    const nextWindow = leadDedupeKey(
      BASE_LEAD,
      new Date(NOW.getTime() + (DEDUPE_WINDOW_SECONDS + 1) * 1000),
    )
    expect(nextWindow).not.toBe(first)
  })

  it('ignores the casing and padding of an email, as the database does', () => {
    expect(leadDedupeKey({ ...BASE_LEAD, email: '  JANE@Example.org ' }, NOW)).toBe(
      leadDedupeKey(BASE_LEAD, NOW),
    )
  })

  it('separates different people, forms and messages', () => {
    const baseline = leadDedupeKey(BASE_LEAD, NOW)
    expect(leadDedupeKey({ ...BASE_LEAD, email: 'someone@example.org' }, NOW)).not.toBe(baseline)
    expect(leadDedupeKey({ ...BASE_LEAD, form_key: 'spring-appeal' }, NOW)).not.toBe(baseline)
    expect(leadDedupeKey({ ...BASE_LEAD, message: 'Something else' }, NOW)).not.toBe(baseline)
  })

  it('falls back to the phone number when there is no email', () => {
    const phoneOnly = { ...BASE_LEAD, email: null, phone: '(555) 123-4567' }
    expect(leadDedupeKey(phoneOnly, NOW)).toBe(
      leadDedupeKey({ ...phoneOnly, phone: '555-123-4567' }, NOW),
    )
    expect(leadDedupeKey(phoneOnly, NOW)).not.toBe(leadDedupeKey(BASE_LEAD, NOW))
  })

  it('never embeds the raw contact detail it was derived from', () => {
    expect(leadDedupeKey(BASE_LEAD, NOW)).not.toContain('jane@example.org')
  })
})

describe('isHoneypotTripped', () => {
  it('ignores the empty values a real submission produces', () => {
    expect(isHoneypotTripped(undefined)).toBe(false)
    expect(isHoneypotTripped(null)).toBe(false)
    expect(isHoneypotTripped('')).toBe(false)
    expect(isHoneypotTripped('   ')).toBe(false)
    expect(isHoneypotTripped(false)).toBe(false)
  })

  it('catches anything a bot puts in the field', () => {
    expect(isHoneypotTripped('http://example.com')).toBe(true)
    expect(isHoneypotTripped('on')).toBe(true)
    expect(isHoneypotTripped(['a', 'b'])).toBe(true)
    expect(isHoneypotTripped(true)).toBe(true)
  })
})

describe('isOriginAllowed', () => {
  const SELF = 'https://crm.graceforce.org'

  it('allows the app itself even when an allow-list is configured', () => {
    expect(isOriginAllowed(SELF, ['https://graceforce.org'], SELF)).toBe(true)
  })

  it('allows a configured origin regardless of trailing slash or casing', () => {
    expect(isOriginAllowed('https://GraceForce.org', ['https://graceforce.org/'], SELF)).toBe(true)
  })

  it('refuses an origin that is on neither list', () => {
    expect(isOriginAllowed('https://evil.example', ['https://graceforce.org'], SELF)).toBe(false)
  })

  it('refuses any cross-origin browser request when no list is configured', () => {
    expect(isOriginAllowed('https://graceforce.org', [], SELF)).toBe(false)
    expect(isOriginAllowed(SELF, [], SELF)).toBe(true)
  })

  it('allows a request with no Origin header, which is not a browser claiming a site', () => {
    expect(isOriginAllowed(null, ['https://graceforce.org'], SELF)).toBe(true)
    expect(isOriginAllowed('', [], SELF)).toBe(false)
  })
})

describe('normalizeOrigin', () => {
  it('strips trailing slashes and casing so comparisons are textual', () => {
    expect(normalizeOrigin(' HTTPS://Example.ORG// ')).toBe('https://example.org')
  })
})

describe('matchesIntakeSecret', () => {
  it('accepts everything when no secret is configured', () => {
    expect(matchesIntakeSecret(null, null)).toBe(true)
    expect(matchesIntakeSecret('anything', null)).toBe(true)
  })

  it('requires an exact match when one is', () => {
    expect(matchesIntakeSecret('s3cret', 's3cret')).toBe(true)
    expect(matchesIntakeSecret('s3crf7', 's3cret')).toBe(false)
    expect(matchesIntakeSecret(null, 's3cret')).toBe(false)
  })

  it('survives a length mismatch, which timingSafeEqual would throw on', () => {
    expect(() => matchesIntakeSecret('short', 'a-much-longer-secret')).not.toThrow()
    expect(matchesIntakeSecret('short', 'a-much-longer-secret')).toBe(false)
  })
})

describe('hashIp', () => {
  it('is stable for the same address and salt', () => {
    expect(hashIp('203.0.113.7', SALT)).toBe(hashIp('203.0.113.7', SALT))
    expect(hashIp(' 203.0.113.7 ', SALT)).toBe(hashIp('203.0.113.7', SALT))
  })

  it('never yields the address it was given', () => {
    const hashed = hashIp('203.0.113.7', SALT)
    expect(hashed).not.toBe('203.0.113.7')
    expect(hashed).not.toContain('203.0.113')
    expect(hashed).toMatch(/^[0-9a-f]{64}$/)
  })

  it('separates addresses, and separates deployments', () => {
    expect(hashIp('203.0.113.7', SALT)).not.toBe(hashIp('203.0.113.8', SALT))
    expect(hashIp('203.0.113.7', SALT)).not.toBe(hashIp('203.0.113.7', 'another-salt'))
  })

  it('feeds a namespaced rate-limit bucket', () => {
    expect(rateLimitBucket(hashIp('203.0.113.7', SALT))).toMatch(/^lead:[0-9a-f]{64}$/)
  })
})

describe('clientIpFrom', () => {
  it('takes the client entry from the forwarding chain, not the proxy', () => {
    const headers = new Headers({ 'x-forwarded-for': '203.0.113.7, 70.41.3.18, 150.172.238.178' })
    expect(clientIpFrom(headers)).toBe('203.0.113.7')
  })

  it('falls back to x-real-ip, then to nothing at all', () => {
    expect(clientIpFrom(new Headers({ 'x-real-ip': '203.0.113.9' }))).toBe('203.0.113.9')
    expect(clientIpFrom(new Headers())).toBeNull()
    expect(clientIpFrom(new Headers({ 'x-forwarded-for': '  ' }))).toBeNull()
  })
})

describe('leadIntakeSchema', () => {
  it('accepts an enquiry with only an email', () => {
    const parsed = leadIntakeSchema.safeParse({ email: 'jane@example.org' })
    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data.phone).toBeNull()
    // An absent form key is the default form, not a rejection.
    expect(parsed.success && parsed.data.form_key).toBe(DEFAULT_FORM_KEY)
  })

  it('accepts an enquiry with only a phone number', () => {
    const parsed = leadIntakeSchema.safeParse({ phone: '555-123-4567' })
    expect(parsed.success).toBe(true)
    expect(parsed.success && parsed.data.email).toBeNull()
  })

  it('rejects one with neither, mirroring the check constraint', () => {
    const parsed = leadIntakeSchema.safeParse({ first_name: 'Jane', message: 'Hello' })
    expect(parsed.success).toBe(false)
    expect(parsed.success ? {} : intakeFieldErrors(parsed.error)).toHaveProperty('email')
  })

  it('rejects an email that is not one', () => {
    const parsed = leadIntakeSchema.safeParse({ email: 'not-an-address' })
    expect(parsed.success).toBe(false)
  })

  it('trims to null, so blank form fields do not reach the database as empty strings', () => {
    const parsed = leadIntakeSchema.safeParse({
      email: 'jane@example.org',
      first_name: '  ',
      organization_name: '',
    })
    expect(parsed.success && parsed.data.first_name).toBeNull()
    expect(parsed.success && parsed.data.organization_name).toBeNull()
  })

  it('keeps a known interest and drops one that no longer exists', () => {
    expect(
      leadIntakeSchema.safeParse({ email: 'jane@example.org', interest: 'volunteer' }),
    ).toMatchObject({ data: { interest: 'volunteer' } })
    expect(
      leadIntakeSchema.safeParse({ email: 'jane@example.org', interest: 'retired_option' }),
    ).toMatchObject({ data: { interest: null } })
  })

  it('keeps only http(s) page urls, so nothing scriptable reaches the queue', () => {
    expect(
      leadIntakeSchema.safeParse({
        email: 'jane@example.org',
        page_url: 'https://graceforce.org/give',
      }),
    ).toMatchObject({ data: { page_url: 'https://graceforce.org/give' } })
    expect(
      leadIntakeSchema.safeParse({
        email: 'jane@example.org',
        page_url: 'javascript:alert(1)',
      }),
    ).toMatchObject({ data: { page_url: null } })
  })

  it('ignores unknown fields, including the honeypot', () => {
    const parsed = leadIntakeSchema.safeParse({ email: 'jane@example.org', website: 'spam.example' })
    expect(parsed.success && 'website' in parsed.data).toBe(false)
  })
})

describe('utmFrom', () => {
  it('keeps only the parameters that were supplied', () => {
    expect(
      utmFrom({ utm_source: 'newsletter', utm_medium: null, utm_campaign: 'spring' }),
    ).toEqual({ utm_source: 'newsletter', utm_campaign: 'spring' })
    expect(utmFrom({})).toEqual({})
  })
})

describe('parseFormKey', () => {
  it('accepts a slug and normalises its casing', () => {
    expect(parseFormKey('Spring-Appeal')).toBe('spring-appeal')
    expect(isValidFormKey('spring-appeal')).toBe(true)
  })

  it('falls back to the default rather than losing the enquiry', () => {
    expect(parseFormKey(undefined)).toBe(DEFAULT_FORM_KEY)
    expect(parseFormKey('')).toBe(DEFAULT_FORM_KEY)
    expect(parseFormKey('<script>alert(1)</script>')).toBe(DEFAULT_FORM_KEY)
    expect(parseFormKey('a'.repeat(80))).toBe(DEFAULT_FORM_KEY)
  })
})

describe('triage filters', () => {
  const UUID = '11111111-1111-4111-8111-111111111111'

  it('opens on what has just arrived', () => {
    expect(parseLeadStatusFilter(undefined)).toBe('new')
    expect(parseLeadStatusFilter('nonsense')).toBe('new')
    expect(parseLeadStatusFilter('spam')).toBe('spam')
    expect(parseLeadStatusFilter(STATUS_ANY)).toBe(STATUS_ANY)
  })

  it('opens on the whole team, and never passes junk through as a filter value', () => {
    expect(parseLeadAssigneeFilter(undefined)).toBe(ASSIGNEE_ANYONE)
    expect(parseLeadAssigneeFilter("' or true --")).toBe(ASSIGNEE_ANYONE)
    expect(parseLeadAssigneeFilter(ASSIGNEE_ME)).toBe(ASSIGNEE_ME)
    expect(parseLeadAssigneeFilter(ASSIGNEE_UNASSIGNED)).toBe(ASSIGNEE_UNASSIGNED)
    expect(parseLeadAssigneeFilter(UUID)).toBe(UUID)
  })

  it('only recognises the intents its buttons offer', () => {
    expect(parseLeadIntent('convert')).toBe('convert')
    expect(parseLeadIntent('delete')).toBeNull()
    expect(parseLeadIntent(undefined)).toBeNull()
  })

  it('never offers `converted` as a status a button can set', () => {
    expect(Object.values(INTENT_STATUS)).not.toContain('converted')
    expect(INTENT_STATUS.convert).toBeUndefined()
  })
})

describe('leadDisplayName', () => {
  it('uses the best identifier the enquiry actually carried', () => {
    expect(leadDisplayName({ first_name: 'Jane', last_name: 'Doe' })).toBe('Jane Doe')
    expect(leadDisplayName({ last_name: 'Doe' })).toBe('Doe')
    expect(leadDisplayName({ organization_name: 'Hope Church' })).toBe('Hope Church')
    expect(leadDisplayName({ email: 'jane@example.org' })).toBe('jane@example.org')
    expect(leadDisplayName({ phone: '555-123-4567' })).toBe('555-123-4567')
    expect(leadDisplayName({})).toBe('Anonymous enquiry')
  })
})

describe('interestLabel', () => {
  it('shows the public wording, and falls back to a retired slug', () => {
    expect(interestLabel('volunteer')).toBe('Volunteering')
    expect(interestLabel('retired_option')).toBe('retired_option')
    expect(interestLabel(null)).toBeNull()
  })
})
