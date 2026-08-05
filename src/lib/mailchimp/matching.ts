import type { MailchimpMember } from '@/lib/mailchimp/types'
import { normalizeEmail } from '@/lib/utils'
import type { Json, MailchimpAction } from '@/types/database'

/**
 * The parts of the Mailchimp sync that have to be provably deterministic:
 * which contact a subscriber resolves to, and what key an event carries.
 *
 * Everything here is pure. Idempotency is the headline requirement of the
 * integration, and a rule that depends on nothing but its arguments is one
 * that can be tested exhaustively rather than hoped about.
 */

/** How a subscriber came to be linked to a contact. Stored on the member row. */
export type MatchMethod = 'email' | 'secondary_email' | 'created' | 'manual'

export const MATCH_METHOD_LABELS: Record<MatchMethod, string> = {
  email: 'Matched on email address',
  secondary_email: 'Matched on secondary email',
  created: 'Contact created from this subscriber',
  manual: 'Linked by hand',
}

export interface ContactCandidate {
  id: string
  email_normalized: string | null
  secondary_email: string | null
  created_at: string
}

export interface ContactDraft {
  first_name: string | null
  last_name: string | null
  email: string
}

export type ContactMatch =
  | { kind: 'matched'; contactId: string; method: 'email' | 'secondary_email' }
  | { kind: 'create'; draft: ContactDraft }
  | { kind: 'unmatched' }

export interface MatchOptions {
  autoCreateContacts: boolean
}

/**
 * Oldest first, then by id.
 *
 * Two contacts can legitimately share an address — a couple with one mailbox,
 * or a duplicate nobody has merged yet. Picking the oldest means the same
 * subscriber resolves to the same person on every run, which is the property
 * that makes a re-sync a no-op rather than a shuffle.
 */
function byOldest(a: ContactCandidate, b: ContactCandidate): number {
  if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/**
 * Resolves one Mailchimp subscriber to a CRM contact.
 *
 * The order is fixed and documented because a surprising link has to be
 * explainable months later:
 *
 *  1. Exact match on `contacts.email_normalized`.
 *  2. Match on `contacts.secondary_email`, compared case-insensitively —
 *     that column has no generated normal form of its own.
 *  3. Create a contact, when the deployment has opted into that.
 *  4. Otherwise leave it unmatched, for the review queue.
 *
 * `candidates` must already exclude soft-deleted contacts: a person removed
 * from the CRM should not silently reappear because they are still on a list.
 */
export function matchContact(
  member: Pick<MailchimpMember, 'email_address' | 'merge_fields'>,
  candidates: readonly ContactCandidate[],
  options: MatchOptions,
): ContactMatch {
  const email = normalizeEmail(member.email_address)
  // A member with no address cannot be resolved and cannot seed a contact.
  if (!email) return { kind: 'unmatched' }

  const ordered = [...candidates].sort(byOldest)

  const primary = ordered.find((candidate) => candidate.email_normalized === email)
  if (primary) return { kind: 'matched', contactId: primary.id, method: 'email' }

  const secondary = ordered.find(
    (candidate) => normalizeEmail(candidate.secondary_email) === email,
  )
  if (secondary) return { kind: 'matched', contactId: secondary.id, method: 'secondary_email' }

  if (!options.autoCreateContacts) return { kind: 'unmatched' }

  return {
    kind: 'create',
    draft: {
      first_name: mergeFieldText(member.merge_fields, 'FNAME'),
      last_name: mergeFieldText(member.merge_fields, 'LNAME'),
      email: member.email_address?.trim() ?? email,
    },
  }
}

/** Merge fields are user-defined, so a value that is not text is not a name. */
export function mergeFieldText(
  mergeFields: Record<string, Json | undefined> | undefined,
  key: string,
): string | null {
  const value = mergeFields?.[key]
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

// --- Deterministic keys -----------------------------------------------------

/**
 * Canonical form for a timestamp inside a key.
 *
 * Mailchimp sends `2026-08-05T12:00:00+00:00`; Postgres hands back
 * `2026-08-05T12:00:00.000Z`. Both have to reduce to the same key or a replay
 * would insert a second copy of an event that already exists.
 */
export function canonicalTimestamp(value: string | null | undefined): string {
  const raw = value?.trim() ?? ''
  if (raw === '') return ''
  const parsed = new Date(raw)
  return Number.isNaN(parsed.getTime()) ? raw : parsed.toISOString()
}

/**
 * Timeline key for a subscribe or unsubscribe.
 *
 * `lastChanged` is part of the key so that someone who leaves a list and
 * rejoins it later gets two entries, while replaying the same page of members
 * gets none.
 */
export function memberStatusDedupeKey(input: {
  status: 'subscribed' | 'unsubscribed'
  listId: string
  memberHash: string
  lastChanged: string | null | undefined
}): string {
  return [
    'mailchimp',
    input.status,
    input.listId,
    input.memberHash,
    canonicalTimestamp(input.lastChanged),
  ].join(':')
}

/**
 * Key for one row of `mailchimp_campaign_activity`.
 *
 * Repeated opens of the same email collapse onto one key and are counted in
 * `event_count`; a click carries its URL, because clicking two links is two
 * distinct facts about what someone was interested in.
 */
export function campaignActivityDedupeKey(input: {
  campaignId: string
  action: MailchimpAction
  email: string
  url?: string | null
}): string {
  const email = normalizeEmail(input.email) ?? ''
  const base = `mc:${input.campaignId}:${input.action}:${email}`
  return input.url ? `${base}:${input.url}` : base
}

/**
 * Key for the contact-timeline entry behind an open or a click.
 *
 * Deliberately carries no timestamp: the timeline records *that* someone
 * engaged with a campaign, once, and the per-URL detail lives in
 * `mailchimp_campaign_activity`. Without this, every re-sync of a campaign
 * whose opens are still trickling in would post the person's timeline again.
 */
export function campaignTimelineDedupeKey(input: {
  campaignId: string
  action: 'open' | 'click'
  email: string
}): string {
  const email = normalizeEmail(input.email) ?? ''
  return `mailchimp:${input.action}:${input.campaignId}:${email}`
}
