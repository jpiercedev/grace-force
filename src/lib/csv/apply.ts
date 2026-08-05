import {
  canWriteExternalKey,
  externalKey,
  hasName,
  matchContact,
  type ContactImportValues,
  type ContactMatchIndex,
  type PlannedContactRow,
} from '@/lib/csv/contacts'
import {
  canWriteGiftExternalKey,
  giftAmountCents,
  matchGiftContact,
  type GiftImportValues,
  type GiftMatchIndex,
  type PlannedGiftRow,
} from '@/lib/csv/gifts'
import { normalizeEmail } from '@/lib/utils'
import type { ContactSource, GiftMethod } from '@/types/database'

/**
 * Applying a planned import.
 *
 * Everything that touches the database goes through a store port, so the
 * orchestration below — which rows are written, in what order, and what a
 * second run of the same file does — is testable without one.
 *
 * Matches are resolved again here rather than trusted from the preview.
 * Minutes or days can pass between validating a file and committing it, and
 * the contact a row matched then may have been created, merged or renamed
 * since. Re-resolving is what keeps a re-import an update rather than a
 * duplicate.
 */

export interface ContactLookupKeys {
  ids: string[]
  externalIds: string[]
  emails: string[]
}

export type ContactWritePayload = Omit<ContactImportValues, 'id'> & {
  external_source?: string
  source?: ContactSource
}

export interface ContactStore {
  lookup(keys: ContactLookupKeys): Promise<ContactMatchIndex>
  create(payload: ContactWritePayload): Promise<string>
  update(id: string, payload: ContactWritePayload): Promise<void>
}

export interface GiftWritePayload {
  contact_id?: string
  amount_cents?: number
  currency?: string
  given_on?: string
  method?: GiftMethod
  fund?: string
  campaign?: string
  is_recurring?: boolean
  recurrence?: string
  is_anonymous?: boolean
  receipt_number?: string
  notes?: string
  external_source?: string
  external_id?: string
}

export interface GiftCreatePayload extends GiftWritePayload {
  contact_id: string
  amount_cents: number
  given_on: string
}

export interface GiftStore {
  lookupGifts(keys: { ids: string[]; externalIds: string[] }): Promise<GiftMatchIndex>
  lookupContacts(keys: ContactLookupKeys): Promise<ContactMatchIndex>
  create(payload: GiftCreatePayload): Promise<string>
  update(id: string, payload: GiftWritePayload): Promise<void>
}

export type ApplyOutcome = 'created' | 'updated' | 'failed'

export interface AppliedRow {
  number: number
  outcome: ApplyOutcome
  contactId: string | null
  giftId: string | null
  error: string | null
}

export interface ApplyResult {
  created: number
  updated: number
  failed: number
  rows: AppliedRow[]
}

function emptyResult(): ApplyResult {
  return { created: 0, updated: 0, failed: 0, rows: [] }
}

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** A mutable copy, so rows written earlier in the batch are visible to later ones. */
function workingContactIndex(index: ContactMatchIndex) {
  return {
    ids: new Set(index.ids),
    byExternalId: new Map(index.byExternalId),
    byEmail: new Map(index.byEmail),
    externalKeys: new Map(index.externalKeys),
  }
}

export async function applyContactRows(
  rows: readonly PlannedContactRow[],
  store: ContactStore,
  options: { externalSource: string },
): Promise<ApplyResult> {
  const { externalSource } = options
  const applicable = rows.filter((row) => row.action === 'create' || row.action === 'update')
  const result = emptyResult()
  if (applicable.length === 0) return result

  const keys: ContactLookupKeys = { ids: [], externalIds: [], emails: [] }
  const ids = new Set<string>()
  const externalIds = new Set<string>()
  const emails = new Set<string>()
  for (const row of applicable) {
    if (row.values.id) ids.add(row.values.id)
    if (row.values.external_id) externalIds.add(row.values.external_id)
    const email = normalizeEmail(row.values.email)
    if (email) emails.add(email)
  }
  keys.ids = [...ids]
  keys.externalIds = [...externalIds]
  keys.emails = [...emails]

  const index = workingContactIndex(await store.lookup(keys))

  for (const row of applicable) {
    const match = matchContact(row.values, index)
    if (match.error) {
      result.failed += 1
      result.rows.push({ number: row.number, outcome: 'failed', contactId: null, giftId: null, error: match.error })
      continue
    }

    const writesKey = canWriteExternalKey(match.contactId, row.values, index, externalSource)
    const payload = contactPayload(row.values, match.contactId === null, writesKey, externalSource)

    if (match.contactId === null && !hasName(row.values)) {
      result.failed += 1
      result.rows.push({
        number: row.number,
        outcome: 'failed',
        contactId: null,
        giftId: null,
        error: 'A new contact needs a first name, a last name or an organisation.',
      })
      continue
    }

    try {
      if (match.contactId === null) {
        const contactId = await store.create(payload)
        registerContact(index, contactId, row.values, writesKey, externalSource)
        result.created += 1
        result.rows.push({ number: row.number, outcome: 'created', contactId, giftId: null, error: null })
      } else {
        await store.update(match.contactId, payload)
        registerContact(index, match.contactId, row.values, writesKey, externalSource)
        result.updated += 1
        result.rows.push({
          number: row.number,
          outcome: 'updated',
          contactId: match.contactId,
          giftId: null,
          error: null,
        })
      }
    } catch (error) {
      // One unwritable row must not abandon the rest of the batch half-applied.
      result.failed += 1
      result.rows.push({
        number: row.number,
        outcome: 'failed',
        contactId: null,
        giftId: null,
        error: messageFrom(error),
      })
    }
  }

  return result
}

function contactPayload(
  values: ContactImportValues,
  isNew: boolean,
  writesExternalKey: boolean,
  externalSource: string,
): ContactWritePayload {
  const { id: _id, external_id: externalId, ...rest } = values
  const payload: ContactWritePayload = { ...rest }
  if (writesExternalKey && externalId !== undefined) {
    payload.external_id = externalId
    payload.external_source = externalSource
  }
  // `source` records how a record first arrived, so it is only set on the way in.
  if (isNew) payload.source = 'import'
  return payload
}

function registerContact(
  index: ReturnType<typeof workingContactIndex>,
  contactId: string,
  values: ContactImportValues,
  wroteExternalKey: boolean,
  externalSource: string,
): void {
  index.ids.add(contactId)
  if (wroteExternalKey && values.external_id) {
    index.byExternalId.set(values.external_id, contactId)
    index.externalKeys.set(contactId, externalKey(externalSource, values.external_id))
  }
  const email = normalizeEmail(values.email)
  // First claim wins, matching how the database's own lookup would resolve a
  // shared household address.
  if (email && !index.byEmail.has(email)) index.byEmail.set(email, contactId)
}

export async function applyGiftRows(
  rows: readonly PlannedGiftRow[],
  store: GiftStore,
  options: { externalSource: string },
): Promise<ApplyResult> {
  const { externalSource } = options
  const applicable = rows.filter((row) => row.action === 'create' || row.action === 'update')
  const result = emptyResult()
  if (applicable.length === 0) return result

  const giftIds = new Set<string>()
  const giftExternalIds = new Set<string>()
  const contactIds = new Set<string>()
  const contactExternalIds = new Set<string>()
  const contactEmails = new Set<string>()
  for (const row of applicable) {
    if (row.values.id) giftIds.add(row.values.id)
    if (row.values.external_id) giftExternalIds.add(row.values.external_id)
    if (row.values.contact_id) contactIds.add(row.values.contact_id)
    if (row.values.contact_external_id) contactExternalIds.add(row.values.contact_external_id)
    const email = normalizeEmail(row.values.contact_email)
    if (email) contactEmails.add(email)
  }

  const [gifts, contacts] = await Promise.all([
    store.lookupGifts({ ids: [...giftIds], externalIds: [...giftExternalIds] }),
    store.lookupContacts({
      ids: [...contactIds],
      externalIds: [...contactExternalIds],
      emails: [...contactEmails],
    }),
  ])

  const index = {
    ids: new Set(gifts.ids),
    byExternalId: new Map(gifts.byExternalId),
    externalKeys: new Map(gifts.externalKeys),
  }

  for (const row of applicable) {
    const contact = matchGiftContact(row.values, contacts)
    if (contact.error) {
      result.failed += 1
      result.rows.push({ number: row.number, outcome: 'failed', contactId: null, giftId: null, error: contact.error })
      continue
    }

    const existingId = row.values.id
      ? (index.ids.has(row.values.id) ? row.values.id : null)
      : row.values.external_id
        ? (index.byExternalId.get(row.values.external_id) ?? null)
        : null

    const writesKey = canWriteGiftExternalKey(existingId, row.values, index, externalSource)
    const payload = giftPayload(row.values, contact.contactId, writesKey, externalSource)

    try {
      if (existingId === null) {
        const create = asGiftCreate(payload)
        if (create === null) {
          result.failed += 1
          result.rows.push({
            number: row.number,
            outcome: 'failed',
            contactId: contact.contactId,
            giftId: null,
            error: 'A new gift needs a contact, an amount and a date.',
          })
          continue
        }
        const giftId = await store.create(create)
        index.ids.add(giftId)
        if (writesKey && row.values.external_id) {
          index.byExternalId.set(row.values.external_id, giftId)
          index.externalKeys.set(giftId, externalKey(externalSource, row.values.external_id))
        }
        result.created += 1
        result.rows.push({
          number: row.number,
          outcome: 'created',
          contactId: contact.contactId,
          giftId,
          error: null,
        })
      } else {
        await store.update(existingId, payload)
        result.updated += 1
        result.rows.push({
          number: row.number,
          outcome: 'updated',
          contactId: contact.contactId,
          giftId: existingId,
          error: null,
        })
      }
    } catch (error) {
      result.failed += 1
      result.rows.push({
        number: row.number,
        outcome: 'failed',
        contactId: contact.contactId,
        giftId: existingId,
        error: messageFrom(error),
      })
    }
  }

  return result
}

function giftPayload(
  values: GiftImportValues,
  contactId: string | null,
  writesExternalKey: boolean,
  externalSource: string,
): GiftWritePayload {
  const payload: GiftWritePayload = {}
  if (contactId !== null) payload.contact_id = contactId
  const amount = giftAmountCents(values)
  if (amount !== undefined) payload.amount_cents = amount
  if (values.currency !== undefined) payload.currency = values.currency
  if (values.given_on !== undefined) payload.given_on = values.given_on
  if (values.method !== undefined) payload.method = values.method
  if (values.fund !== undefined) payload.fund = values.fund
  if (values.campaign !== undefined) payload.campaign = values.campaign
  if (values.is_recurring !== undefined) payload.is_recurring = values.is_recurring
  if (values.recurrence !== undefined) payload.recurrence = values.recurrence
  if (values.is_anonymous !== undefined) payload.is_anonymous = values.is_anonymous
  if (values.receipt_number !== undefined) payload.receipt_number = values.receipt_number
  if (values.notes !== undefined) payload.notes = values.notes
  if (writesExternalKey && values.external_id !== undefined) {
    payload.external_id = values.external_id
    payload.external_source = externalSource
  }
  return payload
}

/** Narrows a payload to the three columns a new gift row cannot do without. */
function asGiftCreate(payload: GiftWritePayload): GiftCreatePayload | null {
  const { contact_id: contactId, amount_cents: amountCents, given_on: givenOn } = payload
  if (contactId === undefined || amountCents === undefined || givenOn === undefined) return null
  return { ...payload, contact_id: contactId, amount_cents: amountCents, given_on: givenOn }
}
