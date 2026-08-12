import { Badge, badgeTone, type BadgeTone } from '@/components/ui/display'
import type {
  CapabilityConfidence,
  CapabilityLevel,
  ContactMethod,
  EventAttendance,
  EventKind,
  MeetingKind,
  ProposalKind,
  ProposalStatus,
} from '@/types/database'

/**
 * Vocabulary for the development domain — proposals, events, capability,
 * meetings, contact preferences.
 *
 * The rule the labels follow: say what a development officer would say out
 * loud. "Charitable Gift Annuity", not `charitable_gift_annuity`; "Agreed",
 * not `committed`; "Text", not `text_message`. Nothing here exposes the
 * underlying enum spelling to a reader.
 */

// --- Proposals ---------------------------------------------------------------

export const PROPOSAL_KIND_LABELS: Record<ProposalKind, string> = {
  trust: 'Trust',
  charitable_gift_annuity: 'Charitable Gift Annuity',
  outright_gift: 'Outright Gift',
  estate_gift: 'Estate Gift',
  other_planned_gift: 'Other Planned Gift',
}

/**
 * Which financial fields a type actually uses. A gift annuity has an
 * illustration; an outright gift does not — so the form and the detail page
 * ask only for what applies rather than showing five empty money boxes.
 */
export const PROPOSAL_FINANCIAL_FIELDS: Record<
  ProposalKind,
  ReadonlyArray<'fair_market_value' | 'estimated_deduction' | 'expected_benefit'>
> = {
  trust: ['fair_market_value', 'estimated_deduction', 'expected_benefit'],
  charitable_gift_annuity: ['fair_market_value', 'estimated_deduction', 'expected_benefit'],
  estate_gift: ['fair_market_value', 'expected_benefit'],
  other_planned_gift: ['fair_market_value', 'estimated_deduction', 'expected_benefit'],
  outright_gift: [],
}

export const PROPOSAL_STATUS_LABELS: Record<ProposalStatus, string> = {
  exploring: 'Exploring',
  drafted: 'Drafted',
  presented: 'Presented',
  committed: 'Agreed',
  funded: 'Completed',
  declined: 'Declined',
}

/** One line of plain guidance under the stage picker, so nobody has to guess. */
export const PROPOSAL_STATUS_HINTS: Record<ProposalStatus, string> = {
  exploring: 'Talking it through. Nothing written yet.',
  drafted: 'A proposal has been prepared.',
  presented: 'Shared with the donor; waiting to hear back.',
  committed: 'They have said yes. Paperwork in progress.',
  funded: 'Done — the gift is in place.',
  declined: 'They decided not to proceed.',
}

const PROPOSAL_STATUS_TONES: Record<ProposalStatus, BadgeTone> = {
  exploring: 'zinc',
  drafted: 'slate',
  presented: 'amber',
  committed: 'brand',
  funded: 'emerald',
  declined: 'zinc',
}

export const PROPOSAL_STATUSES = Object.keys(PROPOSAL_STATUS_LABELS) as ProposalStatus[]
export const PROPOSAL_KINDS = Object.keys(PROPOSAL_KIND_LABELS) as ProposalKind[]

/** `funded` and `declined` are the terminal states the check constraint pairs with `closed_at`. */
export const CLOSED_PROPOSAL_STATUSES = ['funded', 'declined'] as const satisfies readonly ProposalStatus[]

export function isClosedProposalStatus(status: ProposalStatus): boolean {
  return (CLOSED_PROPOSAL_STATUSES as readonly ProposalStatus[]).includes(status)
}

export function ProposalStatusBadge({ status }: { status: ProposalStatus }) {
  return <Badge tone={PROPOSAL_STATUS_TONES[status]}>{PROPOSAL_STATUS_LABELS[status]}</Badge>
}

// --- Events ------------------------------------------------------------------

export const EVENT_KIND_LABELS: Record<EventKind, string> = {
  gathering: 'Gathering',
  service: 'Service',
  banquet: 'Banquet',
  tour: 'Tour',
  meeting: 'Meeting',
  conference: 'Conference',
  volunteer: 'Volunteer day',
  other: 'Other',
}

export const EVENT_KINDS = Object.keys(EVENT_KIND_LABELS) as EventKind[]

export const EVENT_ATTENDANCE_LABELS: Record<EventAttendance, string> = {
  invited: 'Invited',
  attended: 'Came',
  declined: 'Could not come',
  no_show: 'Did not come',
}

const EVENT_ATTENDANCE_TONES: Record<EventAttendance, BadgeTone> = {
  invited: 'slate',
  attended: 'emerald',
  declined: 'zinc',
  no_show: 'amber',
}

export const EVENT_ATTENDANCES = Object.keys(EVENT_ATTENDANCE_LABELS) as EventAttendance[]

export function AttendanceBadge({ status }: { status: EventAttendance }) {
  return <Badge tone={EVENT_ATTENDANCE_TONES[status]}>{EVENT_ATTENDANCE_LABELS[status]}</Badge>
}

// --- Meetings ----------------------------------------------------------------

export const MEETING_KIND_LABELS: Record<MeetingKind, string> = {
  in_person: 'In person',
  video: 'Video call',
  phone: 'Phone call',
  event: 'At an event',
  other: 'Other',
}

export const MEETING_KINDS = Object.keys(MEETING_KIND_LABELS) as MeetingKind[]

// --- Giving capability -------------------------------------------------------

/**
 * Deliberately plain words. "Major" is a real term of art in development, but
 * the scale beneath it is described in terms of the relationship rather than
 * the money — this is a strategy note, not an underwriting decision.
 */
export const CAPABILITY_LEVEL_LABELS: Record<CapabilityLevel, string> = {
  unrated: 'Not yet assessed',
  modest: 'Modest',
  moderate: 'Moderate',
  significant: 'Significant',
  major: 'Major',
}

export const CAPABILITY_LEVELS = Object.keys(CAPABILITY_LEVEL_LABELS) as CapabilityLevel[]

export const CAPABILITY_CONFIDENCE_LABELS: Record<CapabilityConfidence, string> = {
  low: 'Low — a guess',
  medium: 'Medium — some basis',
  high: 'High — well supported',
}

export const CAPABILITY_CONFIDENCES = Object.keys(
  CAPABILITY_CONFIDENCE_LABELS,
) as CapabilityConfidence[]

// --- Communication preferences -----------------------------------------------

export const CONTACT_METHOD_LABELS: Record<ContactMethod, string> = {
  email: 'Email',
  phone: 'Phone',
  text: 'Text',
  mail: 'Post',
}

export const CONTACT_METHODS = Object.keys(CONTACT_METHOD_LABELS) as ContactMethod[]

/**
 * Interest chips take their tone from the catalogue's own colour when one is
 * set, which keeps a future operator-editable palette working without a code
 * change — the same treatment engagement types already get.
 */
export function InterestBadge({ label, color }: { label: string; color?: string | null }) {
  return <Badge tone={color ? badgeTone(color) : 'brand'}>{label}</Badge>
}
