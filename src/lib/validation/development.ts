import { z } from 'zod'
import {
  CAPABILITY_CONFIDENCES,
  CAPABILITY_LEVELS,
  CONTACT_METHODS,
  EVENT_ATTENDANCES,
  EVENT_KINDS,
  MEETING_KINDS,
  PROPOSAL_KINDS,
  PROPOSAL_STATUSES,
} from '@/components/domain/development-badges'
import { INTERACTION_KINDS } from '@/lib/interactions'
import { RELATIONSHIP_KINDS } from '@/lib/relationships'
import {
  checkboxField,
  optionalDate,
  optionalText,
  optionalUuid,
  requiredDate,
  requiredText,
} from '@/lib/validation/contact'
import { optionalMoneyCents, uuidField } from '@/lib/validation/form-data'

/**
 * Schemas for the relationship-development forms.
 *
 * Two rules run through all of them:
 *
 * 1. **Ask for as little as the database will accept.** Every schema requires
 *    only the fields without which the row is meaningless, so a record can be
 *    created in seconds and enriched later.
 * 2. **Never let a check constraint become a 500.** Where the schema pairs two
 *    columns (`funded` needs `closed_at`, `filed` needs `filed_at`), the action
 *    reconciles them before the insert, exactly as the engagement form already
 *    does for `ended_on`.
 */

const INTERACTION_VALUES = INTERACTION_KINDS.map((kind) => kind.value) as [string, ...string[]]

// --- Logging an interaction --------------------------------------------------

export const interactionSchema = z.object({
  contact_id: uuidField('Missing contact'),
  kind: z.enum(INTERACTION_VALUES, { required_error: 'Choose what happened' }),
  /** Only asked for email and text; ignored for every other kind. */
  received: checkboxField(),
  note: optionalText(4000),
  outcome: optionalText(200),
  proposal_id: optionalUuid('Choose a proposal from the list'),
  /** Present when the person ticked "set a follow-up". */
  follow_up_on: optionalDate(),
  follow_up_note: optionalText(200),
})

export type InteractionValues = z.infer<typeof interactionSchema>

// --- Related constituents ----------------------------------------------------

export const relationshipSchema = z.object({
  contact_id: uuidField('Missing contact'),
  related_contact_id: uuidField('Choose the person to link'),
  kind: z.enum(RELATIONSHIP_KINDS as [string, ...string[]], {
    required_error: 'Choose how they are related',
  }),
  note: optionalText(200),
})

// --- Interests ---------------------------------------------------------------

export const interestSchema = z.object({
  contact_id: uuidField('Missing contact'),
  interest_area_id: uuidField('Choose an interest'),
  note: optionalText(500),
})

// --- Communication preferences ----------------------------------------------

export const preferencesSchema = z.object({
  contact_id: uuidField('Missing contact'),
  preferred_contact_method: z
    .enum(CONTACT_METHODS as [string, ...string[]])
    .optional()
    .nullable()
    .or(z.literal('').transform(() => null)),
  preferred_phone: optionalText(80),
  preferred_email: optionalText(254),
  best_time_to_contact: optionalText(120),
  contact_preference_notes: optionalText(1000),
  do_not_contact: checkboxField(),
  do_not_call: checkboxField(),
  do_not_email: checkboxField(),
  do_not_text: checkboxField(),
  do_not_mail: checkboxField(),
})

// --- Giving capability -------------------------------------------------------

export const capabilitySchema = z.object({
  contact_id: uuidField('Missing contact'),
  level: z.enum(CAPABILITY_LEVELS as [string, ...string[]], {
    required_error: 'Choose a capability level',
  }),
  range_low_cents: optionalMoneyCents(),
  range_high_cents: optionalMoneyCents(),
  confidence: z
    .enum(CAPABILITY_CONFIDENCES as [string, ...string[]])
    .optional()
    .nullable()
    .or(z.literal('').transform(() => null)),
  source: optionalText(200),
  reviewed_on: optionalDate(),
  notes: optionalText(2000),
})

// --- Proposals ---------------------------------------------------------------

export const proposalSchema = z.object({
  contact_id: uuidField('Missing donor'),
  joint_contact_id: optionalUuid('Choose a person from the list'),
  title: requiredText(160, 'Give this proposal a short name'),
  kind: z.enum(PROPOSAL_KINDS as [string, ...string[]], {
    required_error: 'Choose a proposal type',
  }),
  status: z.enum(PROPOSAL_STATUSES as [string, ...string[]], {
    required_error: 'Choose a stage',
  }),
  purpose: optionalText(200),
  notes: optionalText(4000),
  opened_on: requiredDate('Choose the date this opened'),
  expected_close_on: optionalDate(),
  owner_id: optionalUuid('Choose a team member from the list'),
  charitable_amount_cents: optionalMoneyCents(),
  fair_market_value_cents: optionalMoneyCents(),
  estimated_deduction_cents: optionalMoneyCents(),
  expected_benefit_cents: optionalMoneyCents(),
})

export type ProposalValues = z.infer<typeof proposalSchema>

// --- Events ------------------------------------------------------------------

const TIME = /^\d{2}:\d{2}(:\d{2})?$/

export const eventSchema = z.object({
  name: requiredText(160, 'Give the event a name'),
  kind: z.enum(EVENT_KINDS as [string, ...string[]], { required_error: 'Choose an event type' }),
  event_date: requiredDate('Choose the date'),
  start_time: optionalText(8).refine((value) => value === null || TIME.test(value), {
    message: 'Enter a time like 18:30',
  }),
  location: optionalText(200),
  description: optionalText(2000),
  owner_id: optionalUuid('Choose a team member from the list'),
})

export const attendeeSchema = z.object({
  event_id: uuidField('Missing event'),
  contact_id: uuidField('Choose a person'),
  status: z.enum(EVENT_ATTENDANCES as [string, ...string[]], {
    required_error: 'Choose whether they came',
  }),
  note: optionalText(500),
})

// --- Call reports ------------------------------------------------------------

/**
 * Only the date is required. A report is worth more filed rough than not
 * filed at all, which is also why `status` accepts `draft`.
 */
export const callReportSchema = z.object({
  contact_id: uuidField('Missing donor'),
  joint_contact_id: optionalUuid('Choose a person from the list'),
  proposal_id: optionalUuid('Choose a proposal from the list'),
  met_on: requiredDate('Choose the meeting date'),
  met_at_time: optionalText(8).refine((value) => value === null || TIME.test(value), {
    message: 'Enter a time like 14:00',
  }),
  meeting_kind: z.enum(MEETING_KINDS as [string, ...string[]], {
    required_error: 'Choose the kind of meeting',
  }),
  location: optionalText(200),
  external_attendees: optionalText(500),
  summary: optionalText(8000),
  discussion_points: optionalText(8000),
  interests_expressed: optionalText(4000),
  concerns: optionalText(4000),
  commitments: optionalText(4000),
  next_steps: optionalText(4000),
  follow_up_on: optionalDate(),
})

export type CallReportValues = z.infer<typeof callReportSchema>
