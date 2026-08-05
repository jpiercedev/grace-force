import { describe, expect, it } from 'vitest'
import {
  addPipelineCardSchema,
  closeCardSchema,
  closeOutcomeFor,
  fieldErrorsFrom,
  moveCardSchema,
  parseCardIntent,
  stageOutcomeLabel,
} from '@/lib/validation/pipeline'

/**
 * Board input handling. The money path matters most: a card's value reaches
 * Postgres as integer cents, and anything that cannot be read as an amount has
 * to come back as a validation message rather than a rounded guess.
 */

const UUID = '11111111-1111-4111-8111-111111111111'
const OTHER_UUID = '22222222-2222-4222-8222-222222222222'

describe('parseCardIntent', () => {
  it('recognises the three things a card can be asked to do', () => {
    expect(parseCardIntent('move')).toBe('move')
    expect(parseCardIntent('close_won')).toBe('close_won')
    expect(parseCardIntent('close_lost')).toBe('close_lost')
  })

  it('refuses anything else rather than falling through to a default', () => {
    expect(parseCardIntent('delete')).toBeNull()
    expect(parseCardIntent(undefined)).toBeNull()
  })
})

describe('closeOutcomeFor', () => {
  it('maps each closing intent to the status it writes', () => {
    expect(closeOutcomeFor('close_won')).toBe('won')
    expect(closeOutcomeFor('close_lost')).toBe('lost')
  })

  it('does not treat a move as a closure', () => {
    expect(closeOutcomeFor('move')).toBeNull()
  })
})

describe('stageOutcomeLabel', () => {
  it('names a terminal stage in words, not only by colour', () => {
    expect(stageOutcomeLabel({ is_won: true, is_lost: false })).toBe('Won stage')
    expect(stageOutcomeLabel({ is_won: false, is_lost: true })).toBe('Lost stage')
  })

  it('says nothing about a stage still in flight', () => {
    expect(stageOutcomeLabel({ is_won: false, is_lost: false })).toBeNull()
  })
})

describe('addPipelineCardSchema', () => {
  const valid = {
    pipeline_id: UUID,
    contact_id: OTHER_UUID,
    title: 'Ruth Alvarez',
    details: '',
    value_cents: '',
    owner_id: '',
    expected_close_on: '',
  }

  it('accepts the minimum and nulls the blanks', () => {
    const parsed = addPipelineCardSchema.parse(valid)
    expect(parsed.details).toBeNull()
    expect(parsed.value_cents).toBeNull()
    expect(parsed.owner_id).toBeNull()
    expect(parsed.expected_close_on).toBeNull()
  })

  it('reads money as integer cents, however it was typed', () => {
    expect(addPipelineCardSchema.parse({ ...valid, value_cents: '5,000' }).value_cents).toBe(500_000)
    expect(addPipelineCardSchema.parse({ ...valid, value_cents: '$1,500.50' }).value_cents).toBe(150_050)
    expect(addPipelineCardSchema.parse({ ...valid, value_cents: '0' }).value_cents).toBe(0)
  })

  it('rejects an amount it cannot read instead of storing a guess', () => {
    const result = addPipelineCardSchema.safeParse({ ...valid, value_cents: 'about five grand' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(fieldErrorsFrom(result.error).value_cents).toBe('Enter an amount like 1,500')
    }
  })

  it('rejects a negative amount, which the database would refuse anyway', () => {
    expect(addPipelineCardSchema.safeParse({ ...valid, value_cents: '-100' }).success).toBe(false)
  })

  it('insists on a contact and a title', () => {
    const result = addPipelineCardSchema.safeParse({ ...valid, contact_id: '', title: ' ' })
    expect(result.success).toBe(false)
    if (result.success) return
    const errors = fieldErrorsFrom(result.error)
    expect(errors.contact_id).toBe('Choose a contact to add')
    expect(errors.title).toBe('Give this card a title')
  })

  it('takes a close date only in the form Postgres stores it', () => {
    expect(
      addPipelineCardSchema.parse({ ...valid, expected_close_on: '2026-09-30' }).expected_close_on,
    ).toBe('2026-09-30')

    const result = addPipelineCardSchema.safeParse({ ...valid, expected_close_on: '30/09/2026' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(fieldErrorsFrom(result.error).expected_close_on).toBe('Enter a valid date')
    }
  })

  it('rejects a calendar date that does not exist', () => {
    expect(addPipelineCardSchema.safeParse({ ...valid, expected_close_on: '2026-02-31' }).success).toBe(
      false,
    )
  })
})

describe('moveCardSchema', () => {
  it('needs both the card and the stage it is going to', () => {
    expect(moveCardSchema.parse({ id: UUID, stage_id: OTHER_UUID })).toEqual({
      id: UUID,
      stage_id: OTHER_UUID,
    })

    const result = moveCardSchema.safeParse({ id: UUID, stage_id: '' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(fieldErrorsFrom(result.error).stage_id).toBe('Choose a stage to move to')
    }
  })
})

describe('closeCardSchema', () => {
  it('makes the reason optional', () => {
    expect(closeCardSchema.parse({ id: UUID, close_reason: '' }).close_reason).toBeNull()
    expect(closeCardSchema.parse({ id: UUID, close_reason: 'Gift received' }).close_reason).toBe(
      'Gift received',
    )
  })

  it('caps the reason rather than letting the write fail', () => {
    expect(closeCardSchema.safeParse({ id: UUID, close_reason: 'x'.repeat(501) }).success).toBe(false)
  })
})
