import type { ActivityDirection, ActivityType } from '@/types/database'

/**
 * The nine things a staff member can log, phrased the way they would say them.
 *
 * The database stores a `(type, direction)` pair; nobody outside this file has
 * to know that. "They called us" is one choice, not a type dropdown plus a
 * direction dropdown — asking someone to classify the *direction* of a phone
 * call before they can write down what was said is exactly the CRM tax the
 * redesign removes.
 *
 * `asksDirection` marks the two kinds that genuinely go both ways often enough
 * to be worth one extra question: email and text get a Sent / Received pair,
 * and nothing else does.
 */
export interface InteractionKind {
  /** Stable form value. */
  value: string
  label: string
  /** Sentence fragment used as the timeline headline when none is written. */
  headline: string
  type: ActivityType
  direction: ActivityDirection
  asksDirection?: boolean
  /** lucide-react icon name, resolved by the dialog. */
  icon: string
}

export const INTERACTION_KINDS: readonly InteractionKind[] = [
  {
    value: 'call_in',
    label: 'They called us',
    headline: 'Inbound call',
    type: 'call',
    direction: 'inbound',
    icon: 'PhoneIncoming',
  },
  {
    value: 'call_out',
    label: 'We called them',
    headline: 'Called',
    type: 'call',
    direction: 'outbound',
    icon: 'PhoneOutgoing',
  },
  {
    value: 'email',
    label: 'Email',
    headline: 'Email',
    type: 'email',
    direction: 'outbound',
    asksDirection: true,
    icon: 'Mail',
  },
  {
    value: 'text',
    label: 'Text message',
    headline: 'Text message',
    type: 'text_message',
    direction: 'outbound',
    asksDirection: true,
    icon: 'MessageSquare',
  },
  {
    value: 'meeting',
    label: 'Meeting',
    headline: 'Meeting',
    type: 'meeting',
    direction: 'internal',
    icon: 'Users',
  },
  {
    value: 'visit',
    label: 'In-person conversation',
    headline: 'In-person conversation',
    type: 'visit',
    direction: 'internal',
    icon: 'Coffee',
  },
  {
    value: 'attempt',
    label: 'Follow-up attempt',
    headline: 'Tried to reach them',
    type: 'outreach_attempt',
    direction: 'outbound',
    icon: 'PhoneMissed',
  },
  {
    value: 'note',
    label: 'General note',
    headline: 'Note',
    type: 'note',
    direction: 'internal',
    icon: 'StickyNote',
  },
  {
    value: 'other',
    label: 'Something else',
    headline: 'Contact',
    type: 'note',
    direction: 'internal',
    icon: 'Circle',
  },
]

const BY_VALUE = new Map(INTERACTION_KINDS.map((kind) => [kind.value, kind]))

export function findInteractionKind(value: unknown): InteractionKind | null {
  return (typeof value === 'string' ? BY_VALUE.get(value) : undefined) ?? null
}

/**
 * Outcome suggestions offered as a datalist. Suggestions, not an enum: the
 * useful answers are sentences, and a closed list would push staff into
 * picking the nearest wrong one.
 */
export const OUTCOME_SUGGESTIONS = [
  'Spoke with them',
  'Left a voicemail',
  'No answer',
  'Wants more information',
  'Asked us to follow up later',
  'Not interested right now',
] as const
