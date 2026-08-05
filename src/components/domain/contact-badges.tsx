import { Badge, badgeTone, type BadgeTone } from '@/components/ui/display'
import type {
  ActivityDirection,
  ActivityType,
  ContactSource,
  ContactStatus,
  EngagementStatus,
  FollowUpPriority,
  LifecycleStage,
  MailchimpAction,
} from '@/types/database'

/**
 * The shared vocabulary for contact-shaped enums: one label map per enum, one
 * tone map per enum, and the badges built from them.
 *
 * Kept free of Zod so client components can import the labels without pulling
 * the validation schemas into the browser bundle.
 */

export const LIFECYCLE_STAGE_LABELS: Record<LifecycleStage, string> = {
  prospect: 'Prospect',
  engaged: 'Engaged',
  active: 'Active',
  lapsed: 'Lapsed',
  archived: 'Archived',
}

const LIFECYCLE_STAGE_TONES: Record<LifecycleStage, BadgeTone> = {
  prospect: 'slate',
  engaged: 'sky',
  active: 'emerald',
  lapsed: 'amber',
  archived: 'zinc',
}

export const CONTACT_STATUS_LABELS: Record<ContactStatus, string> = {
  active: 'Active',
  inactive: 'Inactive',
  archived: 'Archived',
}

const CONTACT_STATUS_TONES: Record<ContactStatus, BadgeTone> = {
  active: 'emerald',
  inactive: 'amber',
  archived: 'zinc',
}

export const CONTACT_SOURCE_LABELS: Record<ContactSource, string> = {
  manual: 'Added manually',
  web_form: 'Web form',
  event: 'Event',
  referral: 'Referral',
  import: 'Import',
  mailchimp: 'Mailchimp',
  giving_platform: 'Giving platform',
  other: 'Other',
}

export const ENGAGEMENT_STATUS_LABELS: Record<EngagementStatus, string> = {
  prospect: 'Prospect',
  active: 'Active',
  paused: 'Paused',
  lapsed: 'Lapsed',
  ended: 'Ended',
}

const ENGAGEMENT_STATUS_TONES: Record<EngagementStatus, BadgeTone> = {
  prospect: 'slate',
  active: 'emerald',
  paused: 'amber',
  lapsed: 'rose',
  ended: 'zinc',
}

export const FOLLOW_UP_PRIORITY_LABELS: Record<FollowUpPriority, string> = {
  low: 'Low',
  normal: 'Normal',
  high: 'High',
  urgent: 'Urgent',
}

const FOLLOW_UP_PRIORITY_TONES: Record<FollowUpPriority, BadgeTone> = {
  low: 'slate',
  normal: 'sky',
  high: 'amber',
  urgent: 'red',
}

export const ACTIVITY_TYPE_LABELS: Record<ActivityType, string> = {
  note: 'Note',
  call: 'Call',
  email: 'Email',
  meeting: 'Meeting',
  text_message: 'Text message',
  visit: 'Visit',
  prayer_request: 'Prayer request',
  follow_up_created: 'Follow-up created',
  follow_up_completed: 'Follow-up completed',
  engagement_started: 'Engagement started',
  engagement_changed: 'Engagement changed',
  pipeline_stage_changed: 'Pipeline stage changed',
  pipeline_card_created: 'Added to pipeline',
  pipeline_card_closed: 'Pipeline closed',
  gift_recorded: 'Gift recorded',
  assignment_changed: 'Owner changed',
  lead_submitted: 'Lead submitted',
  lead_converted: 'Lead converted',
  mailchimp_subscribed: 'Subscribed',
  mailchimp_unsubscribed: 'Unsubscribed',
  mailchimp_campaign_sent: 'Campaign sent',
  mailchimp_campaign_opened: 'Campaign opened',
  mailchimp_campaign_clicked: 'Campaign clicked',
  mailchimp_bounced: 'Email bounced',
  import: 'Imported',
  system: 'System',
}

/** The subset a person can log by hand; the rest are written by triggers and sync jobs. */
export const MANUAL_ACTIVITY_TYPES = [
  'note',
  'call',
  'email',
  'meeting',
  'text_message',
  'visit',
  'prayer_request',
] as const satisfies readonly ActivityType[]

/** Declaration order of the label map, which is the order the filter offers. */
export const ACTIVITY_TYPES = Object.keys(ACTIVITY_TYPE_LABELS) as ActivityType[]

/** The rest: written by database triggers, sync jobs and the import pipeline. */
export const AUTOMATIC_ACTIVITY_TYPES = ACTIVITY_TYPES.filter(
  (type) => !(MANUAL_ACTIVITY_TYPES as readonly ActivityType[]).includes(type),
)

/** Narrows a URL parameter to a real activity type, so a hand-edited query cannot reach the database. */
export function parseActivityType(value: string | null | undefined): ActivityType | null {
  return value && value in ACTIVITY_TYPE_LABELS ? (value as ActivityType) : null
}

export const ACTIVITY_DIRECTION_LABELS: Record<ActivityDirection, string> = {
  inbound: 'They contacted us',
  outbound: 'We contacted them',
  internal: 'Internal note',
}

export const MAILCHIMP_ACTION_LABELS: Record<MailchimpAction, string> = {
  sent: 'Sent',
  open: 'Opened',
  click: 'Clicked',
  bounce: 'Bounced',
  unsub: 'Unsubscribed',
  abuse: 'Marked as spam',
}

export function LifecycleStageBadge({ stage }: { stage: LifecycleStage }) {
  return <Badge tone={LIFECYCLE_STAGE_TONES[stage]}>{LIFECYCLE_STAGE_LABELS[stage]}</Badge>
}

export function ContactStatusBadge({ status }: { status: ContactStatus }) {
  return <Badge tone={CONTACT_STATUS_TONES[status]}>{CONTACT_STATUS_LABELS[status]}</Badge>
}

export function EngagementStatusBadge({ status }: { status: EngagementStatus }) {
  return <Badge tone={ENGAGEMENT_STATUS_TONES[status]}>{ENGAGEMENT_STATUS_LABELS[status]}</Badge>
}

export function FollowUpPriorityBadge({ priority }: { priority: FollowUpPriority }) {
  return <Badge tone={FOLLOW_UP_PRIORITY_TONES[priority]}>{FOLLOW_UP_PRIORITY_LABELS[priority]}</Badge>
}

/**
 * Engagement colours are operator-editable strings on `engagement_types`, so
 * they are resolved through `badgeTone`, which falls back to slate rather than
 * emitting a class Tailwind never compiled.
 */
export function EngagementTypeBadge({
  label,
  color,
  status,
}: {
  label: string
  color: string | null
  status?: EngagementStatus
}) {
  return (
    <Badge tone={status === 'ended' ? 'zinc' : badgeTone(color)}>
      {label}
      {status && status !== 'active' ? (
        <span className="font-normal opacity-75">· {ENGAGEMENT_STATUS_LABELS[status]}</span>
      ) : null}
    </Badge>
  )
}
