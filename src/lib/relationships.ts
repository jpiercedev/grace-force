import type { RelationshipKind } from '@/types/database'

/**
 * Related constituents, in both directions.
 *
 * The database stores one directed row: "<from> is the <kind> of <to>". That
 * makes exactly one of these two maps correct for any given viewer.
 *
 * - Standing on the **to** side, the other person *is* the kind:
 *   Ginny is the spouse of Jonathan → Jonathan's page shows "Ginny · Spouse".
 * - Standing on the **from** side, the other person is the *inverse*:
 *   Ginny's page shows "Jonathan · Spouse", and for Bill→Howard/referrer,
 *   Bill's page shows "Howard · Referred".
 *
 * Symmetric kinds simply name themselves in both maps, which is why they need
 * no special case anywhere else in the code.
 *
 * Pure data — safe to import from client components.
 */

/** Shown about the person on the `from` side, read from the `to` side. */
export const RELATIONSHIP_LABELS: Record<RelationshipKind, string> = {
  spouse: 'Spouse',
  partner: 'Partner',
  parent: 'Parent',
  child: 'Child',
  sibling: 'Sibling',
  family_member: 'Family member',
  friend: 'Friend',
  colleague: 'Colleague',
  business_associate: 'Business associate',
  professional_advisor: 'Advisor',
  employer: 'Employer',
  referrer: 'Referred by',
  introducer: 'Introduced by',
  other: 'Connected to',
}

/** Shown about the person on the `to` side, read from the `from` side. */
export const RELATIONSHIP_INVERSE_LABELS: Record<RelationshipKind, string> = {
  spouse: 'Spouse',
  partner: 'Partner',
  parent: 'Child',
  child: 'Parent',
  sibling: 'Sibling',
  family_member: 'Family member',
  friend: 'Friend',
  colleague: 'Colleague',
  business_associate: 'Business associate',
  professional_advisor: 'Client',
  employer: 'Employee',
  referrer: 'Referred',
  introducer: 'Introduced',
  other: 'Connected to',
}

/**
 * Kinds that mean the same thing read either way. Used to stop the same pair
 * being recorded twice — "Ginny is spouse of Jonathan" and "Jonathan is spouse
 * of Ginny" are one fact, not two.
 */
const SYMMETRIC: ReadonlySet<RelationshipKind> = new Set<RelationshipKind>([
  'spouse',
  'partner',
  'sibling',
  'family_member',
  'friend',
  'colleague',
  'business_associate',
  'other',
])

export function isSymmetricRelationship(kind: RelationshipKind): boolean {
  return SYMMETRIC.has(kind)
}

/**
 * The picker on a donor record, phrased the way the question is actually
 * asked: "how is this person related to <donor>?". Every option therefore
 * writes a row with the donor on the `to` side.
 */
export const RELATIONSHIP_CHOICES: ReadonlyArray<{
  value: RelationshipKind
  label: string
  group: string
}> = [
  { value: 'spouse', label: 'Spouse', group: 'Family' },
  { value: 'partner', label: 'Partner', group: 'Family' },
  { value: 'parent', label: 'Parent', group: 'Family' },
  { value: 'child', label: 'Child', group: 'Family' },
  { value: 'sibling', label: 'Sibling', group: 'Family' },
  { value: 'family_member', label: 'Other family member', group: 'Family' },
  { value: 'friend', label: 'Friend', group: 'Personal' },
  { value: 'referrer', label: 'Referred this person to us', group: 'Personal' },
  { value: 'introducer', label: 'Introduced us', group: 'Personal' },
  { value: 'professional_advisor', label: 'Professional advisor', group: 'Professional' },
  { value: 'employer', label: 'Employer', group: 'Professional' },
  { value: 'colleague', label: 'Colleague', group: 'Professional' },
  { value: 'business_associate', label: 'Business associate', group: 'Professional' },
  { value: 'other', label: 'Other connection', group: 'Professional' },
]

export const RELATIONSHIP_KINDS = RELATIONSHIP_CHOICES.map((choice) => choice.value)

export function parseRelationshipKind(value: unknown): RelationshipKind | null {
  return typeof value === 'string' && (RELATIONSHIP_KINDS as string[]).includes(value)
    ? (value as RelationshipKind)
    : null
}

/**
 * A sentence a person can read back to check the link is right, shown under
 * the picker before saving. "Ginny Pierce is the spouse of Jonathan Pierce."
 */
export function describeRelationship(
  otherName: string,
  contactName: string,
  kind: RelationshipKind,
): string {
  switch (kind) {
    case 'referrer':
      return `${otherName} referred ${contactName}.`
    case 'introducer':
      return `${otherName} introduced ${contactName}.`
    case 'employer':
      return `${otherName} employs ${contactName}.`
    case 'professional_advisor':
      return `${otherName} advises ${contactName}.`
    default:
      return `${otherName} is the ${RELATIONSHIP_LABELS[kind].toLowerCase()} of ${contactName}.`
  }
}
