import { describe, expect, it } from 'vitest'
import {
  applyGiftRows,
  type GiftCreatePayload,
  type GiftStore,
  type GiftWritePayload,
} from '@/lib/csv/apply'
import type { ContactMatchIndex } from '@/lib/csv/contacts'
import {
  collectGiftKeys,
  mapGiftColumns,
  parseGiftMethod,
  planGiftImport,
  type GiftMatchIndex,
} from '@/lib/csv/gifts'
import { parseCsv } from '@/lib/csv/parse'

/**
 * Giving is the part of this data nobody can reconstruct from memory, so the
 * importer is held to a stricter standard than the rest: money is exact, the
 * person is resolved or the row fails, and importing the same statement twice
 * cannot inflate a total.
 */

const EXTERNAL_SOURCE = 'csv'

const CONTACTS: ContactMatchIndex = {
  ids: new Set(['aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee']),
  byExternalId: new Map([['DONOR-1', 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee']]),
  byEmail: new Map([['jane@example.org', 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee']]),
  externalKeys: new Map(),
}

interface FakeGift {
  id: string
  external_source: string | null
  external_id: string | null
  values: GiftWritePayload
}

function createFakeGiftStore(seed: FakeGift[] = []) {
  const gifts = new Map<string, FakeGift>(seed.map((gift) => [gift.id, gift]))
  let sequence = seed.length

  const index = (keys: { ids: string[]; externalIds: string[] }): GiftMatchIndex => {
    const ids = new Set<string>()
    const byExternalId = new Map<string, string>()
    const externalKeys = new Map<string, string>()

    for (const gift of gifts.values()) {
      const matchesId = keys.ids.includes(gift.id)
      const matchesExternal =
        gift.external_source === EXTERNAL_SOURCE &&
        gift.external_id !== null &&
        keys.externalIds.includes(gift.external_id)
      if (!matchesId && !matchesExternal) continue

      ids.add(gift.id)
      if (gift.external_source && gift.external_id) {
        externalKeys.set(gift.id, `${gift.external_source}:${gift.external_id}`)
        if (gift.external_source === EXTERNAL_SOURCE) byExternalId.set(gift.external_id, gift.id)
      }
    }

    return { ids, byExternalId, externalKeys }
  }

  const store: GiftStore = {
    async lookupGifts(keys) {
      return index(keys)
    },
    async lookupContacts() {
      return CONTACTS
    },
    async create(payload: GiftCreatePayload) {
      sequence += 1
      const id = `gift-${sequence}`
      gifts.set(id, {
        id,
        external_source: payload.external_source ?? null,
        external_id: payload.external_id ?? null,
        values: { ...payload },
      })
      return id
    },
    async update(id, payload) {
      const existing = gifts.get(id)
      if (!existing) throw new Error(`No gift ${id}`)
      gifts.set(id, {
        ...existing,
        external_source: payload.external_source ?? existing.external_source,
        external_id: payload.external_id ?? existing.external_id,
        values: { ...existing.values, ...payload },
      })
      return undefined
    },
  }

  return { gifts, index, store }
}

function plan(text: string, fake = createFakeGiftStore()) {
  const parsed = parseCsv(text)
  const mapping = mapGiftColumns(parsed.headers)
  const keys = collectGiftKeys(parsed.rows, mapping.fields)
  return {
    fake,
    mapping,
    plan: planGiftImport(parsed.rows, {
      fields: mapping.fields,
      gifts: fake.index({ ids: keys.giftIds, externalIds: keys.giftExternalIds }),
      contacts: CONTACTS,
      externalSource: EXTERNAL_SOURCE,
    }),
  }
}

async function importFile(text: string, fake = createFakeGiftStore()) {
  const planned = plan(text, fake)
  const result = await applyGiftRows(planned.plan.rows, fake.store, {
    externalSource: EXTERNAL_SOURCE,
  })
  return { ...planned, result }
}

function snapshot(fake: ReturnType<typeof createFakeGiftStore>): string {
  return JSON.stringify([...fake.gifts.values()].sort((a, b) => a.id.localeCompare(b.id)))
}

describe('mapGiftColumns', () => {
  it('maps the headers a giving platform actually exports', () => {
    const mapping = mapGiftColumns([
      'Donation Date',
      'Gift Amount',
      'Payment Method',
      'Designation',
      'Donor Email',
      'Transaction ID',
    ])

    expect(mapping.fields).toEqual({
      given_on: 'Donation Date',
      amount: 'Gift Amount',
      method: 'Payment Method',
      fund: 'Designation',
      contact_email: 'Donor Email',
      external_id: 'Transaction ID',
    })
  })
})

describe('amount parsing', () => {
  const cases: { cell: string; cents?: number; error?: string }[] = [
    { cell: '$1,234.56', cents: 123456 },
    { cell: '1234.56', cents: 123456 },
    { cell: '  $25 ', cents: 2500 },
    { cell: '0.99', cents: 99 },
    { cell: 'abc', error: 'Amount could not be read as an amount' },
    { cell: '-50.00', error: 'Amount must be greater than zero' },
    { cell: '0', error: 'Amount must be greater than zero' },
  ]

  for (const { cell, cents, error } of cases) {
    it(`reads "${cell}" as ${cents === undefined ? 'an error' : `${cents} cents`}`, () => {
      const { plan: planned } = plan(
        `Donor Email,Amount,Date\njane@example.org,"${cell}",2026-03-01\n`,
      )
      const row = planned.rows[0]

      if (cents === undefined) {
        expect(row?.action).toBe('error')
        expect(row?.errors).toContain(error)
      } else {
        expect(row?.action).toBe('create')
        expect(row?.values.amount).toBe(cents)
      }
    })
  }

  it('treats an empty amount as missing rather than zero', () => {
    const { plan: planned } = plan('Donor Email,Amount,Date\njane@example.org,,2026-03-01\n')

    expect(planned.rows[0]?.action).toBe('error')
    expect(planned.rows[0]?.errors).toContain('Amount is needed to record a gift.')
  })

  it('reads an amount_cents column as cents, not as currency', () => {
    const { plan: planned } = plan(
      'contact_id,amount_cents,given_on\naaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee,123456,2026-03-01\n',
    )

    expect(planned.rows[0]?.values.amount_cents).toBe(123456)
  })
})

describe('planGiftImport', () => {
  it('resolves the contact by email, external ID or CRM id', () => {
    const byEmail = plan('Donor Email,Amount,Date\njane@example.org,25,2026-03-01\n')
    const byExternal = plan('Donor ID,Amount,Date\nDONOR-1,25,2026-03-01\n')
    const byId = plan(
      'contact_id,Amount,Date\naaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee,25,2026-03-01\n',
    )

    expect(byEmail.plan.rows[0]).toMatchObject({ action: 'create', contactMatchedBy: 'email' })
    expect(byExternal.plan.rows[0]).toMatchObject({ action: 'create', contactMatchedBy: 'external_id' })
    expect(byId.plan.rows[0]).toMatchObject({ action: 'create', contactMatchedBy: 'id' })
  })

  it('fails a gift whose contact cannot be found instead of dropping it', () => {
    const { plan: planned } = plan('Donor Email,Amount,Date\nstranger@example.org,25,2026-03-01\n')

    expect(planned.rows[0]?.action).toBe('error')
    expect(planned.rows[0]?.errors[0]).toContain('stranger@example.org')
    expect(planned.counts).toMatchObject({ error: 1, skip: 0 })
  })

  it('fails a gift with no contact reference at all', () => {
    const { plan: planned } = plan('Amount,Date\n25,2026-03-01\n')

    expect(planned.rows[0]?.errors).toContain(
      'No contact reference, so there is nobody to record this gift against.',
    )
  })

  it('requires a date, because the column has no default to fall back on', () => {
    const { plan: planned } = plan('Donor Email,Amount\njane@example.org,25\n')

    expect(planned.rows[0]?.errors).toContain('Gift date is needed to record a gift.')
  })

  it('reads the date spellings a spreadsheet produces', () => {
    const { plan: planned } = plan(
      'Donor Email,Amount,Date\n' +
        'jane@example.org,25,2026-3-1\n' +
        'jane@example.org,25,3/1/2026\n' +
        'jane@example.org,25,"Mar 1, 2026"\n',
    )

    expect(planned.rows.map((row) => row.values.given_on)).toEqual([
      '2026-03-01',
      '2026-03-01',
      '2026-03-01',
    ])
  })

  it('skips a second row carrying the same transaction ID', () => {
    const { plan: planned } = plan(
      'Transaction ID,Donor Email,Amount,Date\n' +
        'T-1,jane@example.org,25,2026-03-01\n' +
        'T-1,jane@example.org,25,2026-03-01\n',
    )

    expect(planned.rows[1]).toMatchObject({ action: 'skip', duplicateOf: 1 })
  })

  it('keeps two identical gifts that carry no identifier, because they may be two gifts', () => {
    const { plan: planned } = plan(
      'Donor Email,Amount,Date\njane@example.org,25,2026-03-01\njane@example.org,25,2026-03-01\n',
    )

    expect(planned.counts).toMatchObject({ create: 2, skip: 0 })
  })
})

describe('parseGiftMethod', () => {
  it('recognises the spellings people use', () => {
    expect(parseGiftMethod('Credit Card')).toBe('card')
    expect(parseGiftMethod('cheque')).toBe('check')
    expect(parseGiftMethod('Bank Transfer')).toBe('ach')
    expect(parseGiftMethod('In Kind')).toBe('in_kind')
  })

  it('falls back to "other" rather than failing a row over a payment label', () => {
    expect(parseGiftMethod('Venmo')).toBe('other')
  })
})

describe('applyGiftRows', () => {
  it('leaves the giving total unchanged when the same statement is imported twice', async () => {
    const file =
      'Transaction ID,Donor Email,Amount,Date,Fund,Payment Method\n' +
      'T-1,jane@example.org,"$1,234.56",2026-03-01,General Fund,Check\n' +
      'T-2,jane@example.org,$25.00,2026-03-08,Missions,Card\n'

    const fake = createFakeGiftStore()

    const first = await importFile(file, fake)
    expect(first.result).toMatchObject({ created: 2, updated: 0, failed: 0 })
    const afterFirst = snapshot(fake)

    const second = await importFile(file, fake)
    expect(second.plan.counts).toMatchObject({ create: 0, update: 2 })
    expect(second.result).toMatchObject({ created: 0, updated: 2, failed: 0 })
    expect(snapshot(fake)).toBe(afterFirst)
    expect(fake.gifts.size).toBe(2)
  })

  it('writes cents, a resolved contact and the external key on the way in', async () => {
    const { fake } = await importFile(
      'Transaction ID,Donor Email,Amount,Date\nT-9,jane@example.org,$40,2026-03-01\n',
    )

    expect([...fake.gifts.values()][0]).toMatchObject({
      external_source: 'csv',
      external_id: 'T-9',
      values: {
        amount_cents: 4000,
        contact_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        given_on: '2026-03-01',
      },
    })
  })

  it('never writes a row the plan marked as an error', async () => {
    const { result, fake } = await importFile(
      'Donor Email,Amount,Date\nstranger@example.org,25,2026-03-01\n',
    )

    expect(result).toMatchObject({ created: 0, updated: 0, failed: 0 })
    expect(fake.gifts.size).toBe(0)
  })
})
