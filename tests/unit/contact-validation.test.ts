import { describe, expect, it } from 'vitest'
import {
  MAX_TAGS,
  contactBaseSchema,
  contactFormSchema,
  parseTagList,
  toFieldErrors,
} from '@/lib/validation/contact'

/** The payload a browser produces for a form where only a first name was typed. */
function formValues(overrides: Record<string, unknown> = {}) {
  return {
    first_name: 'Grace',
    last_name: '',
    preferred_name: '',
    email: '',
    secondary_email: '',
    phone: '',
    mobile_phone: '',
    address_line1: '',
    address_line2: '',
    city: '',
    region: '',
    postal_code: '',
    country: '',
    organization_name: '',
    job_title: '',
    lifecycle_stage: 'prospect',
    status: 'active',
    source: 'manual',
    source_detail: '',
    owner_id: '',
    birthday: '',
    tags: '',
    notes: '',
    ...overrides,
  }
}

describe('parseTagList', () => {
  it('splits the comma entry the form offers and trims each tag', () => {
    expect(parseTagList('board member, spanish-speaking ,  usher ')).toEqual([
      'board member',
      'spanish-speaking',
      'usher',
    ])
  })

  it('folds duplicates that differ only in case, keeping the first spelling', () => {
    // Otherwise "Donor" and "donor" both live on the record and neither filter finds both.
    expect(parseTagList('Donor, donor, DONOR')).toEqual(['Donor'])
  })

  it('collapses internal whitespace and drops empty entries', () => {
    expect(parseTagList('board   member,, ,usher')).toEqual(['board member', 'usher'])
  })

  it('accepts an array, which is the shape the database column already holds', () => {
    expect(parseTagList(['a', ' b '])).toEqual(['a', 'b'])
    expect(parseTagList(null)).toEqual([])
    expect(parseTagList(undefined)).toEqual([])
  })

  it('caps the list so one paste cannot dump a whole taxonomy onto a contact', () => {
    const many = Array.from({ length: MAX_TAGS + 10 }, (_, i) => `tag${i}`).join(',')
    expect(parseTagList(many)).toHaveLength(MAX_TAGS)
  })
})

describe('contactFormSchema', () => {
  it('turns the empty strings a browser submits into the NULLs Postgres wants', () => {
    const parsed = contactFormSchema.parse(formValues())
    expect(parsed.last_name).toBeNull()
    expect(parsed.email).toBeNull()
    expect(parsed.city).toBeNull()
    expect(parsed.owner_id).toBeNull()
    expect(parsed.birthday).toBeNull()
  })

  it('mirrors the has-a-name check constraint instead of letting it 500', () => {
    const result = contactFormSchema.safeParse(formValues({ first_name: '' }))
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(toFieldErrors(result.error).first_name).toMatch(/first or last name/i)
    }
  })

  it('accepts an organisation on its own, for a partner church with no named contact', () => {
    const result = contactFormSchema.safeParse(
      formValues({ first_name: '', organization_name: 'Hope Chapel' }),
    )
    expect(result.success).toBe(true)
  })

  it('reads an unchecked box as false and a checked one as true', () => {
    // An unchecked checkbox is absent from the payload entirely.
    const unchecked = contactFormSchema.parse(formValues())
    expect(unchecked.do_not_contact).toBe(false)
    expect(unchecked.do_not_email).toBe(false)

    const checked = contactFormSchema.parse(formValues({ do_not_email: 'on' }))
    expect(checked.do_not_email).toBe(true)
  })

  it('rejects a malformed email against the field rather than the whole form', () => {
    const result = contactFormSchema.safeParse(formValues({ email: 'not-an-email' }))
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(toFieldErrors(result.error).email).toMatch(/valid email/i)
    }
  })

  it('only accepts the YYYY-MM-DD a date input produces', () => {
    expect(contactFormSchema.safeParse(formValues({ birthday: '1980-04-02' })).success).toBe(true)
    expect(contactFormSchema.safeParse(formValues({ birthday: '02/04/1980' })).success).toBe(false)
    expect(contactFormSchema.safeParse(formValues({ birthday: '1980-13-40' })).success).toBe(false)
  })

  it('rejects an owner id that is not a uuid', () => {
    expect(contactFormSchema.safeParse(formValues({ owner_id: 'me' })).success).toBe(false)
    expect(
      contactFormSchema.safeParse(
        formValues({ owner_id: '3f1c2a44-5b6d-4e7f-8a90-1b2c3d4e5f60' }),
      ).success,
    ).toBe(true)
  })

  it('rejects a lifecycle stage outside the enum', () => {
    expect(contactFormSchema.safeParse(formValues({ lifecycle_stage: 'vip' })).success).toBe(false)
  })

  it('never produces the generated columns, which the database refuses to be told', () => {
    const parsed = contactFormSchema.parse(formValues({ first_name: 'Grace', last_name: 'Lee' }))
    expect(parsed).not.toHaveProperty('full_name')
    expect(parsed).not.toHaveProperty('email_normalized')
    expect(parsed).not.toHaveProperty('phone_normalized')
    expect(parsed).not.toHaveProperty('search_vector')
  })
})

describe('contactBaseSchema', () => {
  it('stays an unrefined object so the import slice can reshape it', () => {
    // `.partial()` is only available on ZodObject — this is the reason the
    // cross-field name rule lives on `contactFormSchema` instead.
    const partial = contactBaseSchema.partial()
    expect(partial.safeParse({ email: 'grace@example.org' }).success).toBe(true)

    const picked = contactBaseSchema.pick({ first_name: true, last_name: true })
    expect(picked.parse({ first_name: ' Grace ', last_name: '' })).toEqual({
      first_name: 'Grace',
      last_name: null,
    })
  })
})

describe('toFieldErrors', () => {
  it('keeps the first message per field, since a control can only show one', () => {
    const result = contactFormSchema.safeParse(
      formValues({ first_name: '', email: 'nope', owner_id: 'nope' }),
    )
    expect(result.success).toBe(false)
    if (!result.success) {
      const errors = toFieldErrors(result.error)
      expect(Object.keys(errors).sort()).toEqual(['email', 'first_name', 'owner_id'])
      expect(typeof errors.email).toBe('string')
    }
  })
})
