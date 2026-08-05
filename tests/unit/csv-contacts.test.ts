import { describe, expect, it } from 'vitest'
import { applyContactRows, type ContactStore, type ContactWritePayload } from '@/lib/csv/apply'
import {
  collectContactKeys,
  mapContactColumns,
  planContactImport,
  type ContactMatchIndex,
} from '@/lib/csv/contacts'
import { parseCsv } from '@/lib/csv/parse'
import { normalizeEmail } from '@/lib/utils'

/**
 * The import path is where a spreadsheet meets the database, and its failures
 * are the quiet kind: a duplicated household, a wiped phone number, an amount
 * off by a factor of a hundred. These tests pin the decisions that prevent
 * them rather than the code that implements them.
 */

const EXTERNAL_SOURCE = 'csv'

interface FakeContact {
  id: string
  email_normalized: string | null
  external_source: string | null
  external_id: string | null
  values: Record<string, unknown>
}

/**
 * An in-memory stand-in for the contacts table, recording every operation so
 * a second run of the same file can be checked for having done nothing.
 */
function createFakeContactStore(seed: FakeContact[] = []) {
  const contacts = new Map<string, FakeContact>(seed.map((contact) => [contact.id, contact]))
  const operations: { op: 'create' | 'update'; id: string; payload: ContactWritePayload }[] = []
  let sequence = seed.length

  const index = (keys: {
    ids: string[]
    externalIds: string[]
    emails: string[]
  }): ContactMatchIndex => {
    const ids = new Set<string>()
    const byExternalId = new Map<string, string>()
    const byEmail = new Map<string, string>()
    const externalKeys = new Map<string, string>()

    for (const contact of contacts.values()) {
      const matchesId = keys.ids.includes(contact.id)
      const matchesExternal =
        contact.external_source === EXTERNAL_SOURCE &&
        contact.external_id !== null &&
        keys.externalIds.includes(contact.external_id)
      const matchesEmail =
        contact.email_normalized !== null && keys.emails.includes(contact.email_normalized)
      if (!matchesId && !matchesExternal && !matchesEmail) continue

      ids.add(contact.id)
      if (contact.external_source && contact.external_id) {
        externalKeys.set(contact.id, `${contact.external_source}:${contact.external_id}`)
        if (contact.external_source === EXTERNAL_SOURCE && !byExternalId.has(contact.external_id)) {
          byExternalId.set(contact.external_id, contact.id)
        }
      }
      if (contact.email_normalized && !byEmail.has(contact.email_normalized)) {
        byEmail.set(contact.email_normalized, contact.id)
      }
    }

    return { ids, byExternalId, byEmail, externalKeys }
  }

  const store: ContactStore = {
    async lookup(keys) {
      return index(keys)
    },
    async create(payload) {
      sequence += 1
      const id = `contact-${sequence}`
      contacts.set(id, {
        id,
        email_normalized: normalizeEmail(typeof payload.email === 'string' ? payload.email : null),
        external_source: payload.external_source ?? null,
        external_id: payload.external_id ?? null,
        values: { ...payload },
      })
      operations.push({ op: 'create', id, payload })
      return id
    },
    async update(id, payload) {
      const existing = contacts.get(id)
      if (!existing) throw new Error(`No contact ${id}`)
      contacts.set(id, {
        ...existing,
        email_normalized:
          typeof payload.email === 'string'
            ? normalizeEmail(payload.email)
            : existing.email_normalized,
        external_source: payload.external_source ?? existing.external_source,
        external_id: payload.external_id ?? existing.external_id,
        values: { ...existing.values, ...payload },
      })
      operations.push({ op: 'update', id, payload })
      return undefined
    },
  }

  return { contacts, operations, index, store }
}

/** One pass of the whole path: parse, map, plan against the store, apply. */
async function importFile(text: string, fake: ReturnType<typeof createFakeContactStore>) {
  const parsed = parseCsv(text)
  const mapping = mapContactColumns(parsed.headers)
  const keys = collectContactKeys(parsed.rows, mapping.fields)
  const plan = planContactImport(parsed.rows, {
    fields: mapping.fields,
    index: fake.index(keys),
    externalSource: EXTERNAL_SOURCE,
  })
  const result = await applyContactRows(plan.rows, fake.store, { externalSource: EXTERNAL_SOURCE })
  return { parsed, mapping, plan, result }
}

function snapshot(fake: ReturnType<typeof createFakeContactStore>): string {
  return JSON.stringify([...fake.contacts.values()].sort((a, b) => a.id.localeCompare(b.id)))
}

describe('parseCsv', () => {
  it('reads a byte order mark, CRLF endings and a blank final line', () => {
    const parsed = parseCsv('﻿First Name,Email\r\nJane,jane@example.org\r\n\r\n')

    expect(parsed.headers).toEqual(['First Name', 'Email'])
    expect(parsed.rows).toHaveLength(1)
    expect(parsed.rows[0]?.cells).toEqual({ 'First Name': 'Jane', Email: 'jane@example.org' })
  })

  it('keeps a quoted comma, quote and newline inside one cell', () => {
    const parsed = parseCsv('Name,Notes\n"Doe, Jane","Said ""yes"" on\nthe second call"')

    expect(parsed.rows[0]?.cells.Name).toBe('Doe, Jane')
    expect(parsed.rows[0]?.cells.Notes).toBe('Said "yes" on\nthe second call')
  })

  it('fills short rows rather than shifting the columns along', () => {
    const parsed = parseCsv('First Name,Last Name,Email\nJane,Doe\n')

    expect(parsed.rows[0]?.cells).toEqual({
      'First Name': 'Jane',
      'Last Name': 'Doe',
      Email: '',
    })
  })

  it('stops at the row ceiling and says so', () => {
    const rows = Array.from({ length: 5 }, (_, index) => `Person ${index}`).join('\n')
    const parsed = parseCsv(`First Name\n${rows}`, { maxRows: 3 })

    expect(parsed.rows).toHaveLength(3)
    expect(parsed.truncated).toBe(true)
  })

  it('refuses a file with no header row', () => {
    expect(parseCsv('').errors).toHaveLength(1)
    expect(parseCsv('').rows).toEqual([])
  })
})

describe('mapContactColumns', () => {
  it('maps common spellings regardless of case, spacing and punctuation', () => {
    const mapping = mapContactColumns([
      'First Name',
      'last_name',
      'E-Mail Address',
      'Mobile Phone',
      'Organisation',
      'ZIP Code',
      'Tags',
    ])

    expect(mapping.fields).toEqual({
      first_name: 'First Name',
      last_name: 'last_name',
      email: 'E-Mail Address',
      mobile_phone: 'Mobile Phone',
      organization_name: 'Organisation',
      postal_code: 'ZIP Code',
      tags: 'Tags',
    })
    expect(mapping.ignored).toEqual([])
  })

  it('reads a file this CRM exported without any configuration', () => {
    const mapping = mapContactColumns([
      'id',
      'external_source',
      'external_id',
      'first_name',
      'organization_name',
      'do_not_email',
    ])

    expect(mapping.fields.id).toBe('id')
    expect(mapping.fields.external_id).toBe('external_id')
    expect(mapping.fields.do_not_email).toBe('do_not_email')
    // Not a field anyone maps: the batch's own source names it.
    expect(mapping.ignored).toContain('external_source')
  })

  it('ignores a second column claiming a field the first already filled', () => {
    const mapping = mapContactColumns(['Email', 'Email Address', 'Nickname'])

    expect(mapping.fields.email).toBe('Email')
    expect(mapping.ignored).toEqual(['Email Address'])
    expect(mapping.columns[1]?.reason).toBe('already-mapped')
  })
})

describe('planContactImport', () => {
  it('creates a row that matches nothing here', async () => {
    const fake = createFakeContactStore()
    const { plan } = await importFile('First Name,Last Name\nJane,Doe\n', fake)

    expect(plan.counts).toMatchObject({ total: 1, create: 1, update: 0, skip: 0, error: 0 })
  })

  it('updates a row whose email already belongs to someone', async () => {
    const fake = createFakeContactStore([
      {
        id: 'contact-1',
        email_normalized: 'jane@example.org',
        external_source: null,
        external_id: null,
        values: {},
      },
    ])
    const { plan } = await importFile('First Name,Email\nJane, JANE@Example.org \n', fake)

    expect(plan.rows[0]).toMatchObject({ action: 'update', contactId: 'contact-1', matchedBy: 'email' })
  })

  it('prefers the external ID over the email when both are present', async () => {
    const fake = createFakeContactStore([
      {
        id: 'contact-1',
        email_normalized: 'shared@example.org',
        external_source: null,
        external_id: null,
        values: {},
      },
      {
        id: 'contact-2',
        email_normalized: null,
        external_source: 'csv',
        external_id: 'A-1',
        values: {},
      },
    ])
    const { plan } = await importFile(
      'External ID,First Name,Email\nA-1,Jane,shared@example.org\n',
      fake,
    )

    expect(plan.rows[0]).toMatchObject({ action: 'update', contactId: 'contact-2', matchedBy: 'external_id' })
  })

  it('skips a row the file has already covered, naming the row it duplicates', async () => {
    const fake = createFakeContactStore()
    const { plan } = await importFile(
      'First Name,Email\nJane,jane@example.org\nJan,JANE@EXAMPLE.ORG\n',
      fake,
    )

    expect(plan.rows[0]?.action).toBe('create')
    expect(plan.rows[1]).toMatchObject({ action: 'skip', duplicateOf: 1 })
    expect(plan.rows[1]?.errors[0]).toContain('Row 1')
  })

  it('treats two people at one household address as two people', async () => {
    const fake = createFakeContactStore()
    const { plan } = await importFile(
      'External ID,First Name,Email\nA-1,Jane,house@example.org\nA-2,John,house@example.org\n',
      fake,
    )

    expect(plan.counts).toMatchObject({ create: 2, skip: 0 })
  })

  it('fails a row with no name and nothing to match on', async () => {
    const fake = createFakeContactStore()
    const { plan } = await importFile('First Name,Phone\n,555-0100\n', fake)

    expect(plan.rows[0]?.action).toBe('error')
    expect(plan.rows[0]?.errors[0]).toContain('first name')
  })

  it('reports the field that is wrong rather than failing the whole file', async () => {
    const fake = createFakeContactStore()
    const { plan } = await importFile(
      'First Name,Email,Birthday\nJane,not-an-email,1990-02-30\n',
      fake,
    )

    expect(plan.rows[0]?.action).toBe('error')
    expect(plan.rows[0]?.errors).toEqual([
      'Email is not a valid email address',
      'Birthday could not be read as a date — try YYYY-MM-DD',
    ])
  })

  it('normalises the values a person actually types', async () => {
    const fake = createFakeContactStore()
    const { plan } = await importFile(
      'First Name,Tags,Birthday,Do Not Email,Lifecycle Stage\nJane,"donor; prayer team, VIP",3/4/1990,Yes,Engaged\n',
      fake,
    )

    expect(plan.rows[0]?.values).toMatchObject({
      tags: ['donor', 'prayer team', 'VIP'],
      birthday: '1990-03-04',
      do_not_email: true,
      lifecycle_stage: 'engaged',
    })
  })

  it('refuses a contact id this CRM never issued', async () => {
    const fake = createFakeContactStore()
    const { plan } = await importFile(
      'id,First Name\n11111111-2222-3333-4444-555555555555,Jane\n',
      fake,
    )

    expect(plan.rows[0]?.action).toBe('error')
    expect(plan.rows[0]?.errors[0]).toContain('does not match any contact')
  })
})

describe('applyContactRows', () => {
  it('writes only what the file carries, leaving other fields alone', async () => {
    const fake = createFakeContactStore([
      {
        id: 'contact-1',
        email_normalized: 'jane@example.org',
        external_source: null,
        external_id: null,
        values: { first_name: 'Jane', phone: '555-0100' },
      },
    ])

    await importFile('Email,City\njane@example.org,Springfield\n', fake)

    expect(fake.contacts.get('contact-1')?.values).toMatchObject({
      first_name: 'Jane',
      phone: '555-0100',
      city: 'Springfield',
    })
    // An empty cell means "unchanged", so no key arrives holding a blank.
    expect(fake.operations[0]?.payload).not.toHaveProperty('first_name')
  })

  it('leaves nothing changed when the same file is imported twice', async () => {
    const file =
      'External ID,First Name,Last Name,Email,Tags\n' +
      'A-1,Jane,Doe,jane@example.org,"donor, prayer"\n' +
      'A-2,John,Roe,john@example.org,volunteer\n'

    const fake = createFakeContactStore()

    const first = await importFile(file, fake)
    expect(first.result).toMatchObject({ created: 2, updated: 0, failed: 0 })
    const afterFirst = snapshot(fake)

    const second = await importFile(file, fake)
    expect(second.plan.counts).toMatchObject({ create: 0, update: 2 })
    expect(second.result).toMatchObject({ created: 0, updated: 2, failed: 0 })
    expect(snapshot(fake)).toBe(afterFirst)
    expect(fake.contacts.size).toBe(2)
  })

  it('does not move an external key that already points at another system', async () => {
    const fake = createFakeContactStore([
      {
        id: 'contact-1',
        email_normalized: 'jane@example.org',
        external_source: 'giving_platform',
        external_id: 'GP-9',
        values: {},
      },
    ])

    await importFile('External ID,Email,City\nA-1,jane@example.org,Springfield\n', fake)

    const stored = fake.contacts.get('contact-1')
    expect(stored?.external_source).toBe('giving_platform')
    expect(stored?.external_id).toBe('GP-9')
    expect(stored?.values).toMatchObject({ city: 'Springfield' })
  })

  it('records a row that the database refused without abandoning the rest', async () => {
    const fake = createFakeContactStore()
    const failing: ContactStore = {
      ...fake.store,
      async create(payload) {
        if (payload.first_name === 'Jane') throw new Error('permission denied')
        return fake.store.create(payload)
      },
    }

    const parsed = parseCsv('First Name\nJane\nJohn\n')
    const mapping = mapContactColumns(parsed.headers)
    const plan = planContactImport(parsed.rows, {
      fields: mapping.fields,
      index: fake.index({ ids: [], externalIds: [], emails: [] }),
      externalSource: EXTERNAL_SOURCE,
    })
    const result = await applyContactRows(plan.rows, failing, { externalSource: EXTERNAL_SOURCE })

    expect(result).toMatchObject({ created: 1, failed: 1 })
    expect(result.rows[0]).toMatchObject({ outcome: 'failed', error: 'permission denied' })
    expect(result.rows[1]?.outcome).toBe('created')
  })
})
