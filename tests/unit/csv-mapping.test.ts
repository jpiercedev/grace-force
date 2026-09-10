import { describe, expect, it } from 'vitest'
import { CONTACT_IMPORT_FIELDS, mapContactColumns } from '@/lib/csv/contacts'
import {
  assignmentsFromMapping,
  conflictingAssignments,
  resolveAssignments,
} from '@/lib/csv/mapping'

/**
 * The hand-edited mapping behind the People-tab import. What it must never
 * do is let two columns feed one field: the later column would be dropped
 * without a word, and the operator would find out when a phone number
 * turned up where an email should be.
 */

const HEADERS = ['First', 'Surname', 'E-mail', 'Cell', 'Membership no.'] as const

describe('assignmentsFromMapping', () => {
  it('lists every column in file order, mapped or not', () => {
    const assignments = assignmentsFromMapping(mapContactColumns([...HEADERS]))
    expect(Object.keys(assignments)).toEqual([...HEADERS])
    expect(assignments).toMatchObject({
      First: 'first_name',
      Surname: 'last_name',
      'E-mail': 'email',
      Cell: 'mobile_phone',
      'Membership no.': null,
    })
  })

  it('leaves the second of two columns that looked like the same field unmapped', () => {
    const assignments = assignmentsFromMapping(mapContactColumns(['Email', 'Email address']))
    expect(assignments).toEqual({ Email: 'email', 'Email address': null })
  })
})

describe('conflictingAssignments', () => {
  it('is empty while every field has at most one column', () => {
    const conflicts = conflictingAssignments({ First: 'first_name', Last: 'last_name', Note: null })
    expect(conflicts.size).toBe(0)
  })

  it('names the earlier column for each later one that repeats its field', () => {
    const conflicts = conflictingAssignments({
      Email: 'email',
      Phone: 'phone',
      'Email 2': 'email',
      'Email 3': 'email',
    })
    expect([...conflicts.entries()]).toEqual([
      ['Email 2', 'Email'],
      ['Email 3', 'Email'],
    ])
  })
})

describe('resolveAssignments', () => {
  it('turns a header → field choice back into the field → header mapping the planner uses', () => {
    const resolved = resolveAssignments(
      { First: 'first_name', Surname: 'last_name', 'E-mail': 'email', Cell: '', 'Membership no.': 'external_id' },
      [...HEADERS],
      CONTACT_IMPORT_FIELDS,
    )
    expect(resolved.error).toBeUndefined()
    expect(resolved.mapping?.fields).toEqual({
      first_name: 'First',
      last_name: 'Surname',
      email: 'E-mail',
      external_id: 'Membership no.',
    })
    expect(resolved.mapping?.ignored).toEqual(['Cell'])
    expect(resolved.mapping?.columns.map((column) => column.field)).toEqual([
      'first_name',
      'last_name',
      'email',
      null,
      'external_id',
    ])
  })

  it('treats a column the choice does not mention as left out', () => {
    const resolved = resolveAssignments({ First: 'first_name' }, [...HEADERS], CONTACT_IMPORT_FIELDS)
    expect(resolved.mapping?.fields).toEqual({ first_name: 'First' })
    expect(resolved.mapping?.ignored).toEqual(['Surname', 'E-mail', 'Cell', 'Membership no.'])
  })

  it('refuses two columns for one field, naming both', () => {
    const resolved = resolveAssignments(
      { First: 'first_name', Surname: 'first_name' },
      [...HEADERS],
      CONTACT_IMPORT_FIELDS,
    )
    expect(resolved.mapping).toBeUndefined()
    expect(resolved.error).toContain('"Surname"')
    expect(resolved.error).toContain('"First"')
    expect(resolved.error).toContain('First name')
  })

  it('refuses a header the file does not have', () => {
    const resolved = resolveAssignments({ Given: 'first_name' }, [...HEADERS], CONTACT_IMPORT_FIELDS)
    expect(resolved.error).toContain('"Given"')
  })

  it('refuses a field that does not exist', () => {
    const resolved = resolveAssignments({ First: 'password' }, [...HEADERS], CONTACT_IMPORT_FIELDS)
    expect(resolved.error).toContain('"password"')
  })
})
