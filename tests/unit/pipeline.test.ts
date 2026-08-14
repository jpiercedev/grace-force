import { describe, expect, it } from 'vitest'
import {
  PIPELINE_CARD_INTENTS,
  PIPELINE_EDITOR_INTENTS,
  addPipelineCardSchema,
  closeCardSchema,
  closeOutcomeFor,
  createPipelineSchema,
  createStageSchema,
  fieldErrorsFrom,
  moveCardSchema,
  parseCardIntent,
  parseEditorIntent,
  pipelineSlug,
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
  it('recognises each of the six things a card can be asked to do', () => {
    for (const intent of PIPELINE_CARD_INTENTS) {
      expect(parseCardIntent(intent)).toBe(intent)
    }
    expect(PIPELINE_CARD_INTENTS).toHaveLength(6)
  })

  it('refuses anything else rather than falling through to a default', () => {
    expect(parseCardIntent('delete')).toBeNull()
    expect(parseCardIntent('rename')).toBeNull()
    expect(parseCardIntent('')).toBeNull()
    expect(parseCardIntent(undefined)).toBeNull()
  })
})

describe('parseEditorIntent', () => {
  it('accepts exactly the editor vocabulary', () => {
    for (const intent of PIPELINE_EDITOR_INTENTS) {
      expect(parseEditorIntent(intent)).toBe(intent)
    }
  })

  it('refuses card intents and anything unknown', () => {
    expect(parseEditorIntent('move')).toBeNull()
    expect(parseEditorIntent('close_won')).toBeNull()
    expect(parseEditorIntent('drop_table')).toBeNull()
    expect(parseEditorIntent('')).toBeNull()
    expect(parseEditorIntent(undefined)).toBeNull()
    expect(parseEditorIntent(null)).toBeNull()
  })
})

describe('pipelineSlug', () => {
  it('lowercases and joins with underscores, the tighter of the two DB checks', () => {
    expect(pipelineSlug('Grant  Applications!')).toBe('grant_applications')
  })

  it('falls back to a usable slug rather than an empty string', () => {
    expect(pipelineSlug('')).toBe('pipeline')
    expect(pipelineSlug('!!!')).toBe('pipeline')
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
    stage_id: '',
    contact_id: OTHER_UUID,
    title: 'Ruth Alvarez',
    details: '',
    organization_name: '',
    next_step: '',
    value_cents: '',
    owner_id: '',
    expected_close_on: '',
  }

  it('accepts the minimum and nulls the blanks', () => {
    const parsed = addPipelineCardSchema.parse(valid)
    expect(parsed.stage_id).toBeNull()
    expect(parsed.details).toBeNull()
    expect(parsed.organization_name).toBeNull()
    expect(parsed.next_step).toBeNull()
    expect(parsed.value_cents).toBeNull()
    expect(parsed.owner_id).toBeNull()
    expect(parsed.expected_close_on).toBeNull()
  })

  it('takes an explicit stage, but only one that reads as an id', () => {
    expect(addPipelineCardSchema.parse({ ...valid, stage_id: OTHER_UUID }).stage_id).toBe(OTHER_UUID)
    expect(addPipelineCardSchema.safeParse({ ...valid, stage_id: 'first' }).success).toBe(false)
  })

  it('carries the organization and the next step, trimmed', () => {
    const parsed = addPipelineCardSchema.parse({
      ...valid,
      organization_name: '  Alvarez Trust  ',
      next_step: ' Book the site visit ',
    })
    expect(parsed.organization_name).toBe('Alvarez Trust')
    expect(parsed.next_step).toBe('Book the site visit')
  })

  it('caps the next step rather than letting the write fail', () => {
    expect(
      addPipelineCardSchema.safeParse({ ...valid, next_step: 'x'.repeat(301) }).success,
    ).toBe(false)
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

describe('createPipelineSchema', () => {
  it('reads the checkbox the way browsers post it: "on" or nothing at all', () => {
    expect(
      createPipelineSchema.parse({ name: 'Grants', description: '', tracks_value: 'on' })
        .tracks_value,
    ).toBe(true)
    expect(
      createPipelineSchema.parse({ name: 'Grants', description: '' }).tracks_value,
    ).toBe(false)
  })

  it('insists on a name and nulls a blank description', () => {
    const parsed = createPipelineSchema.parse({ name: '  Grants  ', description: '' })
    expect(parsed.name).toBe('Grants')
    expect(parsed.description).toBeNull()

    const result = createPipelineSchema.safeParse({ name: '  ', description: '' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(fieldErrorsFrom(result.error).name).toBe('Name this pipeline')
    }
  })
})

describe('createStageSchema', () => {
  const valid = { pipeline_id: UUID, name: 'Proposal sent', color: '', outcome: '' }

  it('defaults a blank color and outcome rather than refusing them', () => {
    const parsed = createStageSchema.parse(valid)
    expect(parsed.color).toBe('slate')
    expect(parsed.outcome).toBe('none')
  })

  it('accepts only the colors the board can actually render', () => {
    expect(createStageSchema.parse({ ...valid, color: 'amber' }).color).toBe('amber')
    expect(createStageSchema.safeParse({ ...valid, color: 'magenta' }).success).toBe(false)
  })

  it('accepts only the three outcomes', () => {
    expect(createStageSchema.parse({ ...valid, outcome: 'won' }).outcome).toBe('won')
    expect(createStageSchema.parse({ ...valid, outcome: 'lost' }).outcome).toBe('lost')
    expect(createStageSchema.safeParse({ ...valid, outcome: 'maybe' }).success).toBe(false)
  })

  it('needs its pipeline and a name', () => {
    expect(createStageSchema.safeParse({ ...valid, pipeline_id: 'nope' }).success).toBe(false)
    const result = createStageSchema.safeParse({ ...valid, name: ' ' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(fieldErrorsFrom(result.error).name).toBe('Name this stage')
    }
  })
})
