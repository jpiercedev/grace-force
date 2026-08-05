/**
 * Vocabulary shared by the public intake form and the intake API.
 *
 * This module is bundled into the browser for an unauthenticated visitor, so it
 * deliberately contains no node built-ins, no database imports and nothing that
 * is not already public. The server-side half lives in `./intake`.
 */

export const DEFAULT_FORM_KEY = 'default'

/**
 * The honeypot. Named after a field a form-filling bot expects to be real, and
 * rendered off-screen so no human ever encounters it.
 */
export const HONEYPOT_FIELD = 'website'

/**
 * A form key labels the source of an enquiry, and ends up on the contact as
 * `source_detail`. Constrained to a slug so it stays readable in the queue and
 * cannot be used to smuggle markup into internal screens.
 */
const FORM_KEY_PATTERN = /^[a-z0-9][a-z0-9_-]{0,47}$/

export function isValidFormKey(value: string): boolean {
  return FORM_KEY_PATTERN.test(value)
}

/** Falls back to the default key rather than rejecting: the enquiry matters more than its label. */
export function parseFormKey(value: string | null | undefined): string {
  const normalized = (value ?? '').trim().toLowerCase()
  return isValidFormKey(normalized) ? normalized : DEFAULT_FORM_KEY
}

export const MESSAGE_MAX_LENGTH = 4000

export interface InterestOption {
  /** Must match an `engagement_types.slug`. */
  slug: string
  label: string
}

/**
 * What the public form offers as "what brings you here".
 *
 * The slugs match `engagement_types.slug` because `convert_lead()` looks the
 * interest up by slug and starts that engagement. The labels are the visitor's
 * words rather than the internal ones, and `staff_team` is absent: it is an
 * internal designation, not something anyone asks for from a web form.
 */
export const INTEREST_OPTIONS: readonly InterestOption[] = [
  { slug: 'donor', label: 'Giving and partnership' },
  { slug: 'volunteer', label: 'Volunteering' },
  { slug: 'prayer_partner', label: 'Praying for the ministry' },
  { slug: 'event_attendee', label: 'An upcoming event' },
  { slug: 'partner_church', label: 'Partnering as a church' },
  { slug: 'small_group', label: 'Joining a small group' },
  { slug: 'newsletter', label: 'Email updates' },
]

export function isInterestSlug(value: string): boolean {
  return INTEREST_OPTIONS.some((option) => option.slug === value)
}

export const UTM_KEYS = [
  'utm_source',
  'utm_medium',
  'utm_campaign',
  'utm_term',
  'utm_content',
] as const

export type UtmKey = (typeof UTM_KEYS)[number]

/**
 * What `POST /api/leads` answers with. A honeypot submission gets `ok: true`
 * with no id — indistinguishable, from the caller's side, from a quiet success.
 */
export interface LeadIntakeSuccess {
  ok: true
  id?: string
}

export interface LeadIntakeFailure {
  ok: false
  error: string
  fieldErrors?: Record<string, string>
}

export type LeadIntakeResult = LeadIntakeSuccess | LeadIntakeFailure
