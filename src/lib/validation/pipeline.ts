import { z } from 'zod'
import type { BadgeTone } from '@/components/ui/display'
import { parseCurrencyToCents } from '@/lib/utils'
import type { PipelineCardStatus } from '@/types/database'

/**
 * Pipeline board vocabulary and input validation.
 *
 * Card status and stage are separate concepts: moving a card into a "won"
 * stage does not close it, and closing it does not move it. Keeping them
 * independent means the check constraint on `(status, closed_at)` is the only
 * pairing application code has to honour.
 */

export const CLOSE_OUTCOMES = ['won', 'lost'] as const satisfies readonly PipelineCardStatus[]

export type CloseOutcome = (typeof CLOSE_OUTCOMES)[number]

export const CLOSE_OUTCOME_LABELS: Record<CloseOutcome, string> = {
  won: 'Won',
  lost: 'Lost',
}

export const CARD_STATUS_TONES: Record<PipelineCardStatus, BadgeTone> = {
  open: 'sky',
  won: 'emerald',
  lost: 'zinc',
}

/** Terminal stages get a matching outcome hint on the board. */
export function stageOutcomeLabel(stage: { is_won: boolean; is_lost: boolean }): string | null {
  if (stage.is_won) return 'Won stage'
  if (stage.is_lost) return 'Lost stage'
  return null
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const uuidField = (message: string) => z.string().trim().uuid(message)

const optionalUuid = z
  .string()
  .trim()
  .transform((value) => (value === '' ? null : value))
  .refine((value) => value === null || UUID_PATTERN.test(value), 'That record could not be found')

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Keep this under ${max} characters`)
    .transform((value) => (value === '' ? null : value))

/** Money reaches the database as integer cents; the form takes "1,500" or "$1500.50". */
const optionalCents = z
  .string()
  .trim()
  .transform((value, ctx) => {
    if (value === '') return null
    const cents = parseCurrencyToCents(value)
    if (cents === null || cents < 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter an amount like 1,500' })
      return z.NEVER
    }
    return cents
  })

const optionalDate = z
  .string()
  .trim()
  .transform((value, ctx) => {
    if (value === '') return null
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(new Date(value).getTime())) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter a valid date' })
      return z.NEVER
    }
    return value
  })

export const addPipelineCardSchema = z.object({
  pipeline_id: uuidField('That pipeline could not be found'),
  contact_id: uuidField('Choose a contact to add'),
  title: z
    .string()
    .trim()
    .min(1, 'Give this card a title')
    .max(200, 'Keep the title under 200 characters'),
  details: optionalText(4000),
  value_cents: optionalCents,
  owner_id: optionalUuid,
  expected_close_on: optionalDate,
})

export type AddPipelineCardInput = z.infer<typeof addPipelineCardSchema>

export const moveCardSchema = z.object({
  id: uuidField('That card could not be found'),
  stage_id: uuidField('Choose a stage to move to'),
})

export const closeCardSchema = z.object({
  id: uuidField('That card could not be found'),
  close_reason: optionalText(500),
})

/**
 * Won and lost are separate intents because a submit button carries exactly one
 * name/value pair; a shared `close` intent would need a second control to say
 * which outcome, which is one more thing to keep in sync.
 */
export const PIPELINE_CARD_INTENTS = ['move', 'close_won', 'close_lost'] as const

export type PipelineCardIntent = (typeof PIPELINE_CARD_INTENTS)[number]

export const CLOSE_ACTIONS = [
  { intent: 'close_won', outcome: 'won', label: 'Mark won' },
  { intent: 'close_lost', outcome: 'lost', label: 'Mark lost' },
] as const satisfies readonly { intent: PipelineCardIntent; outcome: CloseOutcome; label: string }[]

export function closeOutcomeFor(intent: PipelineCardIntent): CloseOutcome | null {
  return CLOSE_ACTIONS.find((action) => action.intent === intent)?.outcome ?? null
}

export function parseCardIntent(value: string | undefined | null): PipelineCardIntent | null {
  return PIPELINE_CARD_INTENTS.find((intent) => intent === value) ?? null
}

export function fieldErrorsFrom(error: z.ZodError): Record<string, string> {
  const errors: Record<string, string> = {}
  for (const issue of error.issues) {
    const key = issue.path[0]
    if (typeof key === 'string' && !errors[key]) errors[key] = issue.message
  }
  return errors
}
