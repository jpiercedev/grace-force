import { describe, expect, it } from 'vitest'
import {
  RELATIONSHIP_CHOICES,
  RELATIONSHIP_INVERSE_LABELS,
  RELATIONSHIP_LABELS,
  describeRelationship,
  isSymmetricRelationship,
  parseRelationshipKind,
} from '@/lib/relationships'
import { INTERACTION_KINDS, findInteractionKind } from '@/lib/interactions'
import type { RelationshipKind } from '@/types/database'

/**
 * The two vocabularies the redesign added, both of which are load-bearing:
 *
 * - a related-constituent link is stored once and read from both sides, so the
 *   two label maps have to stay exact inverses of each other;
 * - an interaction is chosen in plain language and stored as a `(type,
 *   direction)` pair, so those pairs have to be right or the timeline lies
 *   about who called whom.
 */

const KINDS = Object.keys(RELATIONSHIP_LABELS) as RelationshipKind[]

describe('related constituent labels', () => {
  it('labels every kind in both directions', () => {
    for (const kind of KINDS) {
      expect(RELATIONSHIP_LABELS[kind]).toBeTruthy()
      expect(RELATIONSHIP_INVERSE_LABELS[kind]).toBeTruthy()
    }
  })

  it('gives symmetric kinds the same word read either way', () => {
    for (const kind of KINDS) {
      if (!isSymmetricRelationship(kind)) continue
      expect(RELATIONSHIP_INVERSE_LABELS[kind]).toBe(RELATIONSHIP_LABELS[kind])
    }
  })

  it('gives asymmetric kinds genuinely different words', () => {
    // The whole point of storing one directed row: parent/child must not both
    // read "Parent", or the record says something false about somebody.
    for (const kind of KINDS) {
      if (isSymmetricRelationship(kind)) continue
      expect(RELATIONSHIP_INVERSE_LABELS[kind]).not.toBe(RELATIONSHIP_LABELS[kind])
    }
  })

  it('reads the brief’s own examples correctly from both sides', () => {
    // "Jonathan is spouse of Ginny" / "Ginny is spouse of Jonathan"
    expect(RELATIONSHIP_LABELS.spouse).toBe('Spouse')
    expect(RELATIONSHIP_INVERSE_LABELS.spouse).toBe('Spouse')

    // "Bill referred Howard" / "Howard was referred by Bill".
    // The row is (from: Bill, to: Howard, kind: referrer), so Howard's page
    // shows Bill as "Referred by" and Bill's page shows Howard as "Referred".
    expect(RELATIONSHIP_LABELS.referrer).toBe('Referred by')
    expect(RELATIONSHIP_INVERSE_LABELS.referrer).toBe('Referred')
  })

  it('inverts parent and child rather than repeating one of them', () => {
    expect(RELATIONSHIP_LABELS.parent).toBe('Parent')
    expect(RELATIONSHIP_INVERSE_LABELS.parent).toBe('Child')
    expect(RELATIONSHIP_LABELS.child).toBe('Child')
    expect(RELATIONSHIP_INVERSE_LABELS.child).toBe('Parent')
  })

  it('offers every kind in the picker, so none is unreachable', () => {
    expect(RELATIONSHIP_CHOICES.map((choice) => choice.value).sort()).toEqual([...KINDS].sort())
  })

  it('refuses a kind that is not in the enum', () => {
    expect(parseRelationshipKind('spouse')).toBe('spouse')
    expect(parseRelationshipKind('landlord')).toBeNull()
    expect(parseRelationshipKind(null)).toBeNull()
    expect(parseRelationshipKind(42)).toBeNull()
  })

  it('describes a link as a sentence someone can check before saving', () => {
    expect(describeRelationship('Ginny Pierce', 'Jonathan Pierce', 'spouse')).toBe(
      'Ginny Pierce is the spouse of Jonathan Pierce.',
    )
    expect(describeRelationship('Bill', 'Howard', 'referrer')).toBe('Bill referred Howard.')
    expect(describeRelationship('Susan Taylor', 'Ada', 'professional_advisor')).toBe(
      'Susan Taylor advises Ada.',
    )
  })
})

describe('interaction kinds', () => {
  it('covers every kind of communication the brief lists', () => {
    const labels = INTERACTION_KINDS.map((kind) => kind.label)
    expect(labels).toEqual(
      expect.arrayContaining([
        'They called us',
        'We called them',
        'Email',
        'Text message',
        'Meeting',
        'In-person conversation',
        'General note',
        'Follow-up attempt',
      ]),
    )
  })

  it('records who called whom without asking anyone to say "direction"', () => {
    expect(findInteractionKind('call_in')).toMatchObject({ type: 'call', direction: 'inbound' })
    expect(findInteractionKind('call_out')).toMatchObject({ type: 'call', direction: 'outbound' })
  })

  it('asks which way round only for the two kinds that genuinely go both ways', () => {
    const asks = INTERACTION_KINDS.filter((kind) => kind.asksDirection).map((kind) => kind.value)
    expect(asks).toEqual(['email', 'text'])
  })

  it('keeps an attempted contact distinct from a completed one', () => {
    // "We tried and did not reach them" must not read as a conversation.
    expect(findInteractionKind('attempt')).toMatchObject({ type: 'outreach_attempt' })
    expect(findInteractionKind('call_out')?.type).not.toBe('outreach_attempt')
  })

  it('has a unique value per kind, since the value is the form field', () => {
    const values = INTERACTION_KINDS.map((kind) => kind.value)
    expect(new Set(values).size).toBe(values.length)
  })

  it('refuses a value that is not one of the offered kinds', () => {
    expect(findInteractionKind('carrier_pigeon')).toBeNull()
    expect(findInteractionKind(undefined)).toBeNull()
  })
})
