import { z } from 'zod'
import type { ContactSource, ContactStatus, LifecycleStage } from '@/types/database'

/**
 * Contact validation.
 *
 * `contactBaseSchema` is deliberately an unrefined `ZodObject` so other
 * callers — CSV import in particular — can `.extend()`, `.pick()` or `.partial()`
 * it. `contactFormSchema` adds the cross-field rule the form needs.
 *
 * Every field coerces the shapes a browser form and a CSV cell actually
 * produce (`''`, `'on'`, `'a, b'`) into the shapes the database wants
 * (`null`, `boolean`, `string[]`), so neither caller has to pre-clean input.
 */

export const LIFECYCLE_STAGES = [
  'prospect',
  'engaged',
  'active',
  'lapsed',
  'archived',
] as const satisfies readonly LifecycleStage[]

export const CONTACT_STATUSES = [
  'active',
  'inactive',
  'archived',
] as const satisfies readonly ContactStatus[]

export const CONTACT_SOURCES = [
  'manual',
  'web_form',
  'event',
  'referral',
  'import',
  'mailchimp',
  'salesforce',
  'giving_platform',
  'other',
] as const satisfies readonly ContactSource[]

/** Guards against a paste of someone's entire tag taxonomy into one contact. */
export const MAX_TAGS = 25

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * A text field a browser leaves as `''` when untouched. Postgres wants NULL —
 * an empty string would defeat `coalesce` defaults and the has-a-name check.
 */
export function optionalText(max: number) {
  return z
    .string()
    .trim()
    .max(max, `Keep this to ${max} characters or fewer`)
    .optional()
    .nullable()
    .transform((value) => (value && value.length > 0 ? value : null))
}

export function requiredText(max: number, message: string) {
  return z
    .string()
    .trim()
    .min(1, message)
    .max(max, `Keep this to ${max} characters or fewer`)
}

export function optionalEmail(max = 254) {
  return optionalText(max).refine(
    (value) => value === null || z.string().email().safeParse(value).success,
    { message: 'Enter a valid email address' },
  )
}

export function optionalUuid(message = 'Choose an option from the list') {
  return optionalText(36).refine((value) => value === null || UUID.test(value), {
    message,
  })
}

/** `<input type="date">` submits `YYYY-MM-DD`; anything else is a tampered form. */
export function optionalDate(message = 'Enter a date as YYYY-MM-DD') {
  return optionalText(10).refine(
    (value) => value === null || (ISO_DATE.test(value) && !Number.isNaN(Date.parse(value))),
    { message },
  )
}

export function requiredDate(message = 'Choose a date') {
  return z
    .string()
    .trim()
    .refine((value) => ISO_DATE.test(value) && !Number.isNaN(Date.parse(value)), { message })
}

/** An unchecked box is absent from the payload entirely; a checked one is `'on'`. */
export function checkboxField() {
  return z
    .union([z.boolean(), z.string()])
    .optional()
    .nullable()
    .transform((value) => value === true || value === 'on' || value === 'true')
}

/**
 * Splits the comma-separated entry the form offers into the `text[]` the
 * column holds, folding duplicates that differ only in case so "Donor" and
 * "donor" do not both end up on the record.
 */
export function parseTagList(value: string | readonly string[] | null | undefined): string[] {
  const entries = typeof value === 'string' ? value.split(',') : (value ?? [])
  const seen = new Set<string>()
  const tags: string[] = []
  for (const entry of entries) {
    const tag = entry.trim().replace(/\s+/g, ' ')
    if (tag === '') continue
    const key = tag.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    tags.push(tag)
    if (tags.length >= MAX_TAGS) break
  }
  return tags
}

const tagListField = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .nullable()
  .transform(parseTagList)

export const contactBaseSchema = z.object({
  first_name: optionalText(80),
  last_name: optionalText(80),
  preferred_name: optionalText(80),
  email: optionalEmail(),
  secondary_email: optionalEmail(),
  phone: optionalText(40),
  mobile_phone: optionalText(40),
  address_line1: optionalText(160),
  address_line2: optionalText(160),
  city: optionalText(80),
  region: optionalText(80),
  postal_code: optionalText(24),
  country: optionalText(56),
  organization_name: optionalText(160),
  job_title: optionalText(120),
  lifecycle_stage: z.enum(LIFECYCLE_STAGES).default('prospect'),
  status: z.enum(CONTACT_STATUSES).default('active'),
  source: z.enum(CONTACT_SOURCES).default('manual'),
  source_detail: optionalText(160),
  owner_id: optionalUuid('Choose a team member from the list'),
  do_not_contact: checkboxField(),
  do_not_email: checkboxField(),
  birthday: optionalDate(),
  tags: tagListField,
  notes: optionalText(4000),
})

/**
 * Mirrors the `contacts_has_a_name` check constraint. Without this the
 * database rejects the insert with a 500 instead of a message next to the
 * field the person needs to fill in.
 */
export function requireContactName(
  value: Pick<ContactNamedFields, 'first_name' | 'last_name' | 'organization_name'>,
  ctx: z.RefinementCtx,
): void {
  if (value.first_name || value.last_name || value.organization_name) return
  ctx.addIssue({
    code: z.ZodIssueCode.custom,
    path: ['first_name'],
    message: 'Enter a first or last name, or an organisation name',
  })
}

interface ContactNamedFields {
  first_name: string | null
  last_name: string | null
  organization_name: string | null
}

export const contactFormSchema = contactBaseSchema.superRefine(requireContactName)

export type ContactFormValues = z.infer<typeof contactFormSchema>
export type ContactFormInput = z.input<typeof contactBaseSchema>

/**
 * The shape every server action in this slice returns. `ok` lets an inline
 * form close itself once the write succeeded; the redirecting forms never
 * need it.
 */
export interface ContactActionState {
  ok?: boolean
  error?: string
  fieldErrors?: Record<string, string>
}

/** First message per field — a control can only show one, and the first is the most specific. */
export function toFieldErrors(error: z.ZodError): Record<string, string> {
  const fieldErrors: Record<string, string> = {}
  for (const issue of error.issues) {
    const key = issue.path.join('.')
    if (key !== '' && !(key in fieldErrors)) fieldErrors[key] = issue.message
  }
  return fieldErrors
}
