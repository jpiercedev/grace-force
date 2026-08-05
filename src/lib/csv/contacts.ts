import { z } from 'zod'
import {
  csvBoolean,
  csvDate,
  csvEmail,
  csvEnum,
  csvTags,
  csvText,
  csvUuid,
  issueMessages,
} from '@/lib/csv/cells'
import { buildMapping, fieldLabels, mapCells, type FieldDefinition } from '@/lib/csv/mapping'
import type { CsvRow } from '@/lib/csv/parse'
import { countActions, type ImportAction, type ImportCounts } from '@/lib/csv/types'
import { normalizeEmail, normalizePhone } from '@/lib/utils'
import { CONTACT_STATUSES, LIFECYCLE_STAGES } from '@/lib/validation/contact'

/**
 * Contact import: header mapping, per-row validation, and the decision about
 * what each row will do.
 *
 * The decision is the important part. A row updates when it names a record
 * this CRM already holds — by its own `id`, then by `(external_source,
 * external_id)`, then by normalised email — and creates otherwise. That
 * ordering is what makes a re-import of the same file a no-op rather than a
 * second copy of everybody, and it is why the file's own duplicates are
 * caught here too: two rows for one person would otherwise race, with the
 * later one silently winning.
 */

export type ContactImportField =
  | 'id'
  | 'external_id'
  | 'first_name'
  | 'last_name'
  | 'preferred_name'
  | 'email'
  | 'secondary_email'
  | 'phone'
  | 'mobile_phone'
  | 'address_line1'
  | 'address_line2'
  | 'city'
  | 'region'
  | 'postal_code'
  | 'country'
  | 'organization_name'
  | 'job_title'
  | 'lifecycle_stage'
  | 'status'
  | 'source_detail'
  | 'do_not_contact'
  | 'do_not_email'
  | 'birthday'
  | 'tags'
  | 'notes'

export const CONTACT_IMPORT_FIELDS: readonly FieldDefinition<ContactImportField>[] = [
  { field: 'id', label: 'Contact ID', aliases: ['contact id', 'crm id', 'contact uuid'] },
  {
    field: 'external_id',
    label: 'External ID',
    aliases: ['legacy id', 'source id', 'record id', 'original id', 'import id', 'reference'],
  },
  { field: 'first_name', label: 'First name', aliases: ['first', 'given name', 'fname', 'forename'] },
  { field: 'last_name', label: 'Last name', aliases: ['last', 'surname', 'family name', 'lname'] },
  { field: 'preferred_name', label: 'Preferred name', aliases: ['nickname', 'goes by', 'known as'] },
  { field: 'email', label: 'Email', aliases: ['email address', 'e mail', 'primary email', 'work email'] },
  {
    field: 'secondary_email',
    label: 'Secondary email',
    aliases: ['alternate email', 'other email', 'email 2', 'second email', 'personal email'],
  },
  { field: 'phone', label: 'Phone', aliases: ['phone number', 'telephone', 'home phone', 'primary phone'] },
  { field: 'mobile_phone', label: 'Mobile', aliases: ['mobile', 'cell', 'cell phone', 'mobile number'] },
  {
    field: 'address_line1',
    label: 'Address',
    aliases: ['address line 1', 'address1', 'street', 'street address', 'mailing address'],
  },
  {
    field: 'address_line2',
    label: 'Address line 2',
    aliases: ['address line 2', 'address2', 'apt', 'suite', 'unit'],
  },
  { field: 'city', label: 'City', aliases: ['town'] },
  { field: 'region', label: 'State', aliases: ['state', 'province', 'county', 'state province'] },
  { field: 'postal_code', label: 'Postal code', aliases: ['zip', 'zip code', 'postcode', 'post code'] },
  { field: 'country', label: 'Country', aliases: [] },
  {
    field: 'organization_name',
    label: 'Organisation',
    aliases: ['organization', 'organisation', 'company', 'church', 'org', 'employer', 'ministry'],
  },
  { field: 'job_title', label: 'Job title', aliases: ['title', 'position', 'role'] },
  { field: 'lifecycle_stage', label: 'Lifecycle stage', aliases: ['lifecycle', 'stage'] },
  { field: 'status', label: 'Status', aliases: ['contact status'] },
  {
    field: 'source_detail',
    label: 'Source detail',
    aliases: ['source', 'origin', 'referral source', 'lead source', 'how did you hear'],
  },
  { field: 'do_not_contact', label: 'Do not contact', aliases: ['dnc', 'opt out', 'no contact'] },
  { field: 'do_not_email', label: 'Do not email', aliases: ['email opt out', 'unsubscribed', 'no email'] },
  { field: 'birthday', label: 'Birthday', aliases: ['birth date', 'date of birth', 'dob'] },
  { field: 'tags', label: 'Tags', aliases: ['tag', 'labels', 'groups', 'keywords'] },
  { field: 'notes', label: 'Notes', aliases: ['note', 'comments', 'description', 'background'] },
]

const CONTACT_LABELS = fieldLabels(CONTACT_IMPORT_FIELDS)

/**
 * Every field optional: which columns a file carries is the operator's
 * business, and a spreadsheet of nothing but `id,email` is a legitimate
 * correction run.
 */
const contactImportSchema = z.object({
  id: csvUuid().optional(),
  external_id: csvText(120).optional(),
  first_name: csvText(80).optional(),
  last_name: csvText(80).optional(),
  preferred_name: csvText(80).optional(),
  email: csvEmail().optional(),
  secondary_email: csvEmail().optional(),
  phone: csvText(40).optional(),
  mobile_phone: csvText(40).optional(),
  address_line1: csvText(160).optional(),
  address_line2: csvText(160).optional(),
  city: csvText(80).optional(),
  region: csvText(80).optional(),
  postal_code: csvText(24).optional(),
  country: csvText(56).optional(),
  organization_name: csvText(160).optional(),
  job_title: csvText(120).optional(),
  lifecycle_stage: csvEnum(LIFECYCLE_STAGES).optional(),
  status: csvEnum(CONTACT_STATUSES).optional(),
  source_detail: csvText(160).optional(),
  do_not_contact: csvBoolean().optional(),
  do_not_email: csvBoolean().optional(),
  birthday: csvDate().optional(),
  tags: csvTags().optional(),
  notes: csvText(4000).optional(),
})

export type ContactImportValues = z.infer<typeof contactImportSchema>

export type ContactMatchMethod = 'id' | 'external_id' | 'email'

export interface ContactMatchIndex {
  /** Contact ids this CRM currently holds, for rows that carry one. */
  ids: ReadonlySet<string>
  /** `external_id` → contact id, within the batch's external source. */
  byExternalId: ReadonlyMap<string, string>
  /** Normalised email → contact id. */
  byEmail: ReadonlyMap<string, string>
  /** Contact id → the external key it already carries, as `source:id`. */
  externalKeys: ReadonlyMap<string, string>
}

export const EMPTY_CONTACT_INDEX: ContactMatchIndex = {
  ids: new Set(),
  byExternalId: new Map(),
  byEmail: new Map(),
  externalKeys: new Map(),
}

export function externalKey(source: string, externalId: string): string {
  return `${source}:${externalId}`
}

export interface ContactPlanOptions {
  /** field → header, as decided by `buildMapping`. */
  fields: Readonly<Record<string, string>>
  index: ContactMatchIndex
  /** Namespace for `external_id`, so ids from two systems cannot collide. */
  externalSource: string
}

export interface PlannedContactRow {
  number: number
  raw: Record<string, string>
  values: ContactImportValues
  action: ImportAction
  errors: string[]
  /** The contact this row will update; null when it will create one. */
  contactId: string | null
  matchedBy: ContactMatchMethod | null
  /** The earlier row in this file that already covers the same record. */
  duplicateOf: number | null
}

export interface ContactImportPlan {
  rows: PlannedContactRow[]
  counts: ImportCounts
}

export function mapContactColumns(headers: readonly string[]) {
  return buildMapping(headers, CONTACT_IMPORT_FIELDS)
}

/**
 * The identifiers a batch needs to look up before it can be planned.
 *
 * Read from the raw cells rather than validated values: a malformed email
 * simply matches nothing, and failing the row is validation's job, not this
 * function's.
 */
export function collectContactKeys(
  rows: readonly CsvRow[],
  fields: Readonly<Record<string, string>>,
): { ids: string[]; externalIds: string[]; emails: string[] } {
  const ids = new Set<string>()
  const externalIds = new Set<string>()
  const emails = new Set<string>()

  for (const row of rows) {
    const cells = mapCells(row.cells, fields, CONTACT_IMPORT_FIELDS)
    if (cells.id) ids.add(cells.id)
    if (cells.external_id) externalIds.add(cells.external_id)
    const email = normalizeEmail(cells.email)
    if (email) emails.add(email)
  }

  return { ids: [...ids], externalIds: [...externalIds], emails: [...emails] }
}

/**
 * Every identity a row carries, strongest first.
 *
 * A row duplicates an earlier one when its *strongest* key has already been
 * claimed, but claiming registers all of them: two rows sharing a household
 * email but carrying different external ids are two people, while a row with
 * only that email is the same person as whichever row introduced it.
 *
 * A row with nothing but a name claims nothing — two people can share a name,
 * and folding them together would lose a record silently.
 */
export function contactIdentityKeys(
  values: ContactImportValues,
  externalSource: string,
): string[] {
  const keys: string[] = []
  if (values.id) keys.push(`id:${values.id}`)
  if (values.external_id) keys.push(`external:${externalKey(externalSource, values.external_id)}`)
  const email = normalizeEmail(values.email)
  if (email) keys.push(`email:${email}`)
  return keys
}

export function planContactImport(
  rows: readonly CsvRow[],
  options: ContactPlanOptions,
): ContactImportPlan {
  const { fields, index, externalSource } = options
  const seen = new Map<string, number>()
  const planned: PlannedContactRow[] = []

  for (const row of rows) {
    const cells = mapCells(row.cells, fields, CONTACT_IMPORT_FIELDS)
    const base = { number: row.number, raw: row.cells }

    const parsed = contactImportSchema.safeParse(cells)
    if (!parsed.success) {
      planned.push({
        ...base,
        values: {},
        action: 'error',
        errors: issueMessages(parsed.error, CONTACT_LABELS),
        contactId: null,
        matchedBy: null,
        duplicateOf: null,
      })
      continue
    }

    const values = parsed.data
    const identities = contactIdentityKeys(values, externalSource)
    const strongest = identities[0]
    const earlier = strongest === undefined ? undefined : seen.get(strongest)
    if (earlier !== undefined) {
      planned.push({
        ...base,
        values,
        action: 'skip',
        errors: [`Row ${earlier} in this file already covers this contact.`],
        contactId: null,
        matchedBy: null,
        duplicateOf: earlier,
      })
      continue
    }
    for (const identity of identities) {
      if (!seen.has(identity)) seen.set(identity, row.number)
    }

    const match = matchContact(values, index)
    if (match.error) {
      planned.push({
        ...base,
        values,
        action: 'error',
        errors: [match.error],
        contactId: null,
        matchedBy: null,
        duplicateOf: null,
      })
      continue
    }

    // The has-a-name check constraint only bites on insert; an update that
    // touches a phone number has no business carrying a name.
    if (match.contactId === null && !hasName(values)) {
      planned.push({
        ...base,
        values,
        action: 'error',
        errors: ['A new contact needs a first name, a last name or an organisation.'],
        contactId: null,
        matchedBy: null,
        duplicateOf: null,
      })
      continue
    }

    planned.push({
      ...base,
      values,
      action: match.contactId === null ? 'create' : 'update',
      errors: [],
      contactId: match.contactId,
      matchedBy: match.method,
      duplicateOf: null,
    })
  }

  return { rows: planned, counts: countActions(planned) }
}

export function hasName(values: ContactImportValues): boolean {
  return Boolean(values.first_name || values.last_name || values.organization_name)
}

interface ContactMatch {
  contactId: string | null
  method: ContactMatchMethod | null
  error?: string
}

/**
 * Resolution order is strongest-evidence-first. An `id` was issued by this
 * CRM, an external id was issued by the system the file came from, and an
 * email is a heuristic — households share one.
 *
 * The index is already namespaced to the batch's external source, so no
 * source has to be passed here.
 */
export function matchContact(
  values: ContactImportValues,
  index: ContactMatchIndex,
): ContactMatch {
  const byExternal = values.external_id ? (index.byExternalId.get(values.external_id) ?? null) : null

  if (values.id) {
    if (!index.ids.has(values.id)) {
      return {
        contactId: null,
        method: null,
        error: 'Contact ID does not match any contact here. Clear it to create a new record.',
      }
    }
    // Writing this row would move the external key onto a different contact,
    // and the unique index would reject it as a 500 rather than a message.
    if (byExternal !== null && byExternal !== values.id) {
      return {
        contactId: null,
        method: null,
        error: `External ID "${values.external_id}" already belongs to a different contact.`,
      }
    }
    return { contactId: values.id, method: 'id' }
  }

  if (byExternal !== null) return { contactId: byExternal, method: 'external_id' }

  const email = normalizeEmail(values.email)
  if (email) {
    const byEmail = index.byEmail.get(email) ?? null
    if (byEmail !== null) return { contactId: byEmail, method: 'email' }
  }

  return { contactId: null, method: null }
}

/**
 * Whether this row may stamp its external key onto the contact.
 *
 * A key that already points elsewhere is never moved: a contact keyed to the
 * giving platform must not be re-keyed by a spreadsheet, because the link to
 * the system that issued it cannot be recovered afterwards.
 */
export function canWriteExternalKey(
  contactId: string | null,
  values: ContactImportValues,
  index: ContactMatchIndex,
  externalSource: string,
): boolean {
  if (!values.external_id) return false
  if (contactId === null) return true
  const existing = index.externalKeys.get(contactId)
  return existing === undefined || existing === externalKey(externalSource, values.external_id)
}

/**
 * The normalised forms the database will compute for itself. Kept on the
 * preview so an operator can see the value that matching actually used, and
 * never written — both columns are generated.
 */
export function contactNormalizedPreview(values: ContactImportValues): {
  email_normalized: string | null
  phone_normalized: string | null
} {
  return {
    email_normalized: normalizeEmail(values.email),
    phone_normalized: normalizePhone(values.phone),
  }
}
