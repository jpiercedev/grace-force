import { z } from 'zod'
import {
  csvBoolean,
  csvCents,
  csvCurrencyCode,
  csvDate,
  csvEmail,
  csvText,
  csvUuid,
  issueMessages,
} from '@/lib/csv/cells'
import { externalKey, type ContactMatchIndex } from '@/lib/csv/contacts'
import { buildMapping, fieldLabels, mapCells, type FieldDefinition } from '@/lib/csv/mapping'
import type { CsvRow } from '@/lib/csv/parse'
import { countActions, type ImportAction, type ImportCounts } from '@/lib/csv/types'
import { normalizeEmail } from '@/lib/utils'
import type { GiftMethod } from '@/types/database'

/**
 * Giving history import.
 *
 * A gift is meaningless without the person it came from, so a row whose
 * contact cannot be resolved fails loudly. Skipping it quietly would leave
 * the giving totals wrong by exactly the amount nobody noticed was missing.
 */

export type GiftImportField =
  | 'id'
  | 'external_id'
  | 'contact_id'
  | 'contact_external_id'
  | 'contact_email'
  | 'amount'
  | 'amount_cents'
  | 'currency'
  | 'given_on'
  | 'method'
  | 'fund'
  | 'campaign'
  | 'is_recurring'
  | 'recurrence'
  | 'is_anonymous'
  | 'receipt_number'
  | 'notes'

export const GIFT_IMPORT_FIELDS: readonly FieldDefinition<GiftImportField>[] = [
  { field: 'id', label: 'Gift ID', aliases: ['gift id', 'crm gift id'] },
  {
    field: 'external_id',
    label: 'External ID',
    aliases: ['transaction id', 'donation id', 'payment id', 'source id', 'reference', 'gift reference'],
  },
  { field: 'contact_id', label: 'Contact ID', aliases: ['crm contact id', 'contact uuid'] },
  {
    field: 'contact_external_id',
    label: 'Contact external ID',
    aliases: ['donor id', 'supporter id', 'constituent id', 'external contact id', 'giver id'],
  },
  {
    field: 'contact_email',
    label: 'Contact email',
    aliases: ['email', 'email address', 'donor email', 'supporter email', 'giver email'],
  },
  {
    field: 'amount',
    label: 'Amount',
    aliases: ['gift amount', 'donation amount', 'total', 'value', 'gross amount', 'amount usd'],
  },
  // Exports carry integer cents, which is the exact figure; a file that has
  // both wins with this one rather than a rounded decimal of the same money.
  { field: 'amount_cents', label: 'Amount in cents', aliases: [] },
  { field: 'currency', label: 'Currency', aliases: ['currency code'] },
  {
    field: 'given_on',
    label: 'Gift date',
    aliases: ['date', 'gift date', 'donation date', 'transaction date', 'date given', 'received on'],
  },
  { field: 'method', label: 'Method', aliases: ['payment method', 'payment type', 'tender', 'gift type'] },
  { field: 'fund', label: 'Fund', aliases: ['designation', 'purpose', 'account'] },
  { field: 'campaign', label: 'Campaign', aliases: ['appeal', 'initiative'] },
  { field: 'is_recurring', label: 'Recurring', aliases: ['recurring'] },
  { field: 'recurrence', label: 'Recurrence', aliases: ['frequency', 'schedule'] },
  { field: 'is_anonymous', label: 'Anonymous', aliases: ['anonymous'] },
  { field: 'receipt_number', label: 'Receipt number', aliases: ['receipt', 'receipt no'] },
  { field: 'notes', label: 'Notes', aliases: ['note', 'memo', 'comments'] },
]

const GIFT_LABELS = fieldLabels(GIFT_IMPORT_FIELDS)

/**
 * Payment methods as the rest of the world spells them. An unrecognised
 * method lands on `other` rather than failing the row — the money and the
 * person are what matter, and the original text stays visible in the batch.
 */
const METHOD_SYNONYMS: Record<string, GiftMethod> = {
  cash: 'cash',
  currency: 'cash',
  check: 'check',
  cheque: 'check',
  card: 'card',
  creditcard: 'card',
  credit: 'card',
  debitcard: 'card',
  debit: 'card',
  ach: 'ach',
  bank: 'ach',
  banktransfer: 'ach',
  directdebit: 'ach',
  eft: 'ach',
  wire: 'ach',
  stock: 'stock',
  securities: 'stock',
  shares: 'stock',
  inkind: 'in_kind',
  goods: 'in_kind',
  other: 'other',
}

export function parseGiftMethod(value: string): GiftMethod {
  return METHOD_SYNONYMS[value.toLowerCase().replace(/[^a-z0-9]+/g, '')] ?? 'other'
}

const giftImportSchema = z.object({
  id: csvUuid().optional(),
  external_id: csvText(120).optional(),
  contact_id: csvUuid().optional(),
  contact_external_id: csvText(120).optional(),
  contact_email: csvEmail().optional(),
  amount: csvCents().optional(),
  amount_cents: csvCents().optional(),
  currency: csvCurrencyCode().optional(),
  given_on: csvDate().optional(),
  method: z.string().transform(parseGiftMethod).optional(),
  fund: csvText(120).optional(),
  campaign: csvText(120).optional(),
  is_recurring: csvBoolean().optional(),
  recurrence: csvText(60).optional(),
  is_anonymous: csvBoolean().optional(),
  receipt_number: csvText(60).optional(),
  notes: csvText(2000).optional(),
})

export type GiftImportValues = z.infer<typeof giftImportSchema>

export interface GiftMatchIndex {
  /** Gift ids this CRM currently holds. */
  ids: ReadonlySet<string>
  /** Gift `external_id` → gift id, within the batch's external source. */
  byExternalId: ReadonlyMap<string, string>
  /** Gift id → the external key it already carries, as `source:id`. */
  externalKeys: ReadonlyMap<string, string>
}

export const EMPTY_GIFT_INDEX: GiftMatchIndex = {
  ids: new Set(),
  byExternalId: new Map(),
  externalKeys: new Map(),
}

/** Mirrors the contact rule: an external key that points elsewhere stays put. */
export function canWriteGiftExternalKey(
  giftId: string | null,
  values: GiftImportValues,
  index: GiftMatchIndex,
  externalSource: string,
): boolean {
  if (!values.external_id) return false
  if (giftId === null) return true
  const existing = index.externalKeys.get(giftId)
  return existing === undefined || existing === externalKey(externalSource, values.external_id)
}

export interface GiftPlanOptions {
  fields: Readonly<Record<string, string>>
  gifts: GiftMatchIndex
  contacts: ContactMatchIndex
  externalSource: string
}

export type GiftContactMatchMethod = 'id' | 'external_id' | 'email'

export interface PlannedGiftRow {
  number: number
  raw: Record<string, string>
  values: GiftImportValues
  action: ImportAction
  errors: string[]
  /** The gift this row will update; null when it will create one. */
  giftId: string | null
  contactId: string | null
  contactMatchedBy: GiftContactMatchMethod | null
  duplicateOf: number | null
}

export interface GiftImportPlan {
  rows: PlannedGiftRow[]
  counts: ImportCounts
}

export function mapGiftColumns(headers: readonly string[]) {
  return buildMapping(headers, GIFT_IMPORT_FIELDS)
}

/** Cents to write, preferring the exact column when a file carries both. */
export function giftAmountCents(values: GiftImportValues): number | undefined {
  return values.amount_cents ?? values.amount
}

export function collectGiftKeys(
  rows: readonly CsvRow[],
  fields: Readonly<Record<string, string>>,
): {
  giftIds: string[]
  giftExternalIds: string[]
  contactIds: string[]
  contactExternalIds: string[]
  contactEmails: string[]
} {
  const giftIds = new Set<string>()
  const giftExternalIds = new Set<string>()
  const contactIds = new Set<string>()
  const contactExternalIds = new Set<string>()
  const contactEmails = new Set<string>()

  for (const row of rows) {
    const cells = mapCells(row.cells, fields, GIFT_IMPORT_FIELDS)
    if (cells.id) giftIds.add(cells.id)
    if (cells.external_id) giftExternalIds.add(cells.external_id)
    if (cells.contact_id) contactIds.add(cells.contact_id)
    if (cells.contact_external_id) contactExternalIds.add(cells.contact_external_id)
    const email = normalizeEmail(cells.contact_email)
    if (email) contactEmails.add(email)
  }

  return {
    giftIds: [...giftIds],
    giftExternalIds: [...giftExternalIds],
    contactIds: [...contactIds],
    contactExternalIds: [...contactExternalIds],
    contactEmails: [...contactEmails],
  }
}

/**
 * Only an explicit identifier makes two gift rows the same gift.
 *
 * Two rows for the same person, day and amount are two genuine gifts often
 * enough — a household putting two cheques in one envelope — that treating
 * them as one would quietly understate what was given.
 */
export function giftIdentityKey(
  values: GiftImportValues,
  externalSource: string,
): string | null {
  if (values.id) return `id:${values.id}`
  if (values.external_id) return `external:${externalKey(externalSource, values.external_id)}`
  return null
}

export function planGiftImport(
  rows: readonly CsvRow[],
  options: GiftPlanOptions,
): GiftImportPlan {
  const { fields, gifts, contacts, externalSource } = options
  const seen = new Map<string, number>()
  const planned: PlannedGiftRow[] = []

  for (const row of rows) {
    const cells = mapCells(row.cells, fields, GIFT_IMPORT_FIELDS)
    const base = { number: row.number, raw: row.cells }

    const parsed = giftImportSchema.safeParse(cells)
    if (!parsed.success) {
      planned.push({
        ...base,
        values: {},
        action: 'error',
        errors: issueMessages(parsed.error, GIFT_LABELS),
        giftId: null,
        contactId: null,
        contactMatchedBy: null,
        duplicateOf: null,
      })
      continue
    }

    const values = parsed.data
    const identity = giftIdentityKey(values, externalSource)
    const earlier = identity === null ? undefined : seen.get(identity)
    if (earlier !== undefined) {
      planned.push({
        ...base,
        values,
        action: 'skip',
        errors: [`Row ${earlier} in this file already covers this gift.`],
        giftId: null,
        contactId: null,
        contactMatchedBy: null,
        duplicateOf: earlier,
      })
      continue
    }
    if (identity !== null) seen.set(identity, row.number)

    const errors: string[] = []

    const byExternal = values.external_id
      ? (gifts.byExternalId.get(values.external_id) ?? null)
      : null

    let giftId: string | null = null
    if (values.id) {
      if (gifts.ids.has(values.id)) {
        giftId = values.id
      } else {
        errors.push('Gift ID does not match any gift here. Clear it to record a new gift.')
      }
      if (byExternal !== null && byExternal !== values.id) {
        errors.push(`External ID "${values.external_id}" already belongs to a different gift.`)
      }
    } else {
      giftId = byExternal
    }

    const contact = matchGiftContact(values, contacts)
    if (contact.error) errors.push(contact.error)

    // NOT NULL columns with no default, so a new gift has to carry all three.
    if (giftId === null && errors.length === 0) {
      if (contact.contactId === null) {
        errors.push('No contact reference, so there is nobody to record this gift against.')
      }
      if (giftAmountCents(values) === undefined) errors.push('Amount is needed to record a gift.')
      if (values.given_on === undefined) errors.push('Gift date is needed to record a gift.')
    }

    if (errors.length > 0) {
      planned.push({
        ...base,
        values,
        action: 'error',
        errors,
        giftId,
        contactId: contact.contactId,
        contactMatchedBy: contact.method,
        duplicateOf: null,
      })
      continue
    }

    planned.push({
      ...base,
      values,
      action: giftId === null ? 'create' : 'update',
      errors: [],
      giftId,
      contactId: contact.contactId,
      contactMatchedBy: contact.method,
      duplicateOf: null,
    })
  }

  return { rows: planned, counts: countActions(planned) }
}

interface GiftContactMatch {
  contactId: string | null
  method: GiftContactMatchMethod | null
  error?: string
}

/**
 * A reference that was supplied but resolves to nobody is an error, not an
 * absent reference: the operator believed they had named someone.
 */
export function matchGiftContact(
  values: GiftImportValues,
  contacts: ContactMatchIndex,
): GiftContactMatch {
  if (values.contact_id) {
    if (!contacts.ids.has(values.contact_id)) {
      return { contactId: null, method: null, error: 'Contact ID does not match any contact here.' }
    }
    return { contactId: values.contact_id, method: 'id' }
  }

  if (values.contact_external_id) {
    const matched = contacts.byExternalId.get(values.contact_external_id) ?? null
    if (matched === null) {
      return {
        contactId: null,
        method: null,
        error: `No contact carries the external ID "${values.contact_external_id}". Import the contacts first.`,
      }
    }
    return { contactId: matched, method: 'external_id' }
  }

  const email = normalizeEmail(values.contact_email)
  if (email) {
    const matched = contacts.byEmail.get(email) ?? null
    if (matched === null) {
      return {
        contactId: null,
        method: null,
        error: `No contact has the email ${email}. Import the contacts first.`,
      }
    }
    return { contactId: matched, method: 'email' }
  }

  return { contactId: null, method: null }
}
