import { z } from 'zod'
import type { BadgeTone } from '@/components/ui/display'
import { INTEREST_OPTIONS } from '@/lib/leads/form'
import { optionalUuid } from '@/lib/validation/contact'
import type { LeadStatus } from '@/types/database'

/**
 * Vocabulary and input validation for the internal triage queue.
 *
 * Pure and free of database imports so the filter bar and the row actions can
 * share it across the server/client boundary.
 */

export const LEAD_STATUSES = [
  'new',
  'in_review',
  'converted',
  'spam',
  'archived',
] as const satisfies readonly LeadStatus[]

export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  new: 'New',
  in_review: 'In review',
  converted: 'Converted',
  spam: 'Spam',
  archived: 'Archived',
}

export const LEAD_STATUS_TONES: Record<LeadStatus, BadgeTone> = {
  new: 'sky',
  in_review: 'amber',
  converted: 'emerald',
  spam: 'rose',
  archived: 'slate',
}

export const LEAD_STATUS_EMPTY_MESSAGES: Record<LeadStatus, string> = {
  new: 'Nothing new is waiting. Every enquiry has been picked up.',
  in_review: 'Nothing is currently being looked at.',
  converted: 'No lead has been turned into a contact yet.',
  spam: 'Nothing has been marked as spam.',
  archived: 'Nothing has been archived.',
}

export const STATUS_ANY = 'any'

export type LeadStatusFilter = LeadStatus | typeof STATUS_ANY

/** Defaults to `new`, because triaging what just arrived is what the queue is for. */
export function parseLeadStatusFilter(value: string | undefined | null): LeadStatusFilter {
  if (value === STATUS_ANY) return STATUS_ANY
  return LEAD_STATUSES.find((status) => status === value) ?? 'new'
}

export const ASSIGNEE_ANYONE = 'anyone'
export const ASSIGNEE_ME = 'me'
export const ASSIGNEE_UNASSIGNED = 'unassigned'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Defaults to everyone: an unclaimed lead is the team's problem, not one
 * person's, so the queue opens on the whole board rather than on "mine".
 */
export function parseLeadAssigneeFilter(value: string | undefined | null): string {
  if (value === ASSIGNEE_ME || value === ASSIGNEE_UNASSIGNED) return value
  if (value && UUID_PATTERN.test(value)) return value
  return ASSIGNEE_ANYONE
}

/** Best name available for an enquiry, which may carry nothing but a phone number. */
export function leadDisplayName(lead: {
  first_name?: string | null
  last_name?: string | null
  organization_name?: string | null
  email?: string | null
  phone?: string | null
}): string {
  const composed = [lead.first_name, lead.last_name].filter(Boolean).join(' ').trim()
  return (
    composed ||
    lead.organization_name?.trim() ||
    lead.email?.trim() ||
    lead.phone?.trim() ||
    'Anonymous enquiry'
  )
}

/**
 * The stored slug is whatever the form offered at the time, so an option that
 * has since been retired still shows something rather than nothing.
 */
export function interestLabel(slug: string | null): string | null {
  if (!slug) return null
  return INTEREST_OPTIONS.find((option) => option.slug === slug)?.label ?? slug
}

// --- Actions ----------------------------------------------------------------

/**
 * Each button on a row carries one intent. `assign_to_me` is separate from
 * `assign` because a submit button contributes a single name/value pair, and
 * the one-click version must not depend on the select next to it.
 */
export const LEAD_INTENTS = [
  'assign',
  'assign_to_me',
  'mark_in_review',
  'mark_spam',
  'archive',
  'reopen',
  'convert',
] as const

export type LeadIntent = (typeof LEAD_INTENTS)[number]

export function parseLeadIntent(value: string | undefined | null): LeadIntent | null {
  return LEAD_INTENTS.find((intent) => intent === value) ?? null
}

/**
 * Status moves available from a button. `converted` is absent deliberately: it
 * is only ever set by `convert_lead()`, which writes the contact in the same
 * transaction — a lead marked converted without one would violate
 * `leads_conversion_consistency`.
 */
export const INTENT_STATUS: Partial<Record<LeadIntent, LeadStatus>> = {
  mark_in_review: 'in_review',
  mark_spam: 'spam',
  archive: 'archived',
  reopen: 'new',
}

export const leadIdSchema = z.object({
  id: z.string().trim().uuid('That lead could not be found'),
})

export const assignLeadSchema = z.object({
  id: z.string().trim().uuid('That lead could not be found'),
  assigned_to: optionalUuid('Choose a team member from the list'),
})

export interface LeadActionState {
  error?: string
  fieldErrors?: Record<string, string>
  notice?: string
}
