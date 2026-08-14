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

export const CLOSE_OUTCOMES = [
  'won',
  'lost',
  'archived',
] as const satisfies readonly PipelineCardStatus[]

export type CloseOutcome = (typeof CLOSE_OUTCOMES)[number]

export const CLOSE_OUTCOME_LABELS: Record<CloseOutcome, string> = {
  won: 'Won',
  lost: 'Lost',
  archived: 'Archived',
}

export const CARD_STATUS_LABELS: Record<PipelineCardStatus, string> = {
  open: 'Open',
  won: 'Won',
  lost: 'Lost',
  archived: 'Archived',
}

export const CARD_STATUS_TONES: Record<PipelineCardStatus, BadgeTone> = {
  open: 'sky',
  won: 'emerald',
  lost: 'zinc',
  archived: 'slate',
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
    // Date's parser is lenient — it rolls 2026-02-31 forward into March rather
    // than refusing it — so the result is compared back against the input. A
    // date Postgres would reject has to surface as a message, not a 500.
    const parsed = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00Z`) : null
    if (!parsed || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
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
    .min(1, 'Give this opportunity a title')
    .max(200, 'Keep the title under 200 characters'),
  details: optionalText(4000),
  value_cents: optionalCents,
  owner_id: optionalUuid,
  expected_close_on: optionalDate,
  organization_name: optionalText(200),
  next_step: optionalText(300),
})

export type AddPipelineCardInput = z.infer<typeof addPipelineCardSchema>

/**
 * The opportunity edit page — everything but pipeline, person and status.
 * Derived from the create schema so the two forms cannot drift apart.
 */
export const updateOpportunitySchema = addPipelineCardSchema
  .omit({ pipeline_id: true, contact_id: true })
  .extend({ id: uuidField('That opportunity could not be found') })

export const moveCardSchema = z.object({
  id: uuidField('That card could not be found'),
  stage_id: uuidField('Choose a stage to move to'),
})

export const closeCardSchema = z.object({
  id: uuidField('That card could not be found'),
  close_reason: optionalText(500),
})

/**
 * Won, lost and archive are separate intents because a submit button carries
 * exactly one name/value pair; a shared `close` intent would need a second
 * control to say which outcome, which is one more thing to keep in sync.
 */
export const PIPELINE_CARD_INTENTS = ['move', 'close_won', 'close_lost', 'archive'] as const

export type PipelineCardIntent = (typeof PIPELINE_CARD_INTENTS)[number]

export const CLOSE_ACTIONS = [
  { intent: 'close_won', outcome: 'won', label: 'Mark won' },
  { intent: 'close_lost', outcome: 'lost', label: 'Mark lost' },
  { intent: 'archive', outcome: 'archived', label: 'Archive' },
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

/* ------------------------------------------------------------------------- */
/* Pipeline and stage management                                             */
/* ------------------------------------------------------------------------- */

/**
 * Slugs come from names: lowercase, runs of anything non-alphanumeric become
 * one underscore. The database constrains slugs to ^[a-z0-9_-]+$, so the form
 * must never be able to produce one the insert would reject.
 */
export function slugifyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
}

const pipelineName = z
  .string()
  .trim()
  .min(1, 'Give the pipeline a name')
  .max(80, 'Keep the name under 80 characters')
  .refine((value) => slugifyName(value).length > 0, 'The name needs at least one letter or number')

export const createPipelineSchema = z.object({
  name: pipelineName,
  description: optionalText(300),
  tracks_value: z.literal('on').nullish(),
})

export const updatePipelineSchema = z.object({
  id: uuidField('That pipeline could not be found'),
  name: pipelineName,
  description: optionalText(300),
  tracks_value: z.literal('on').nullish(),
})

export const pipelineIdSchema = z.object({
  id: uuidField('That pipeline could not be found'),
})

const stageName = z
  .string()
  .trim()
  .min(1, 'Give the stage a name')
  .max(60, 'Keep the name under 60 characters')
  .refine((value) => slugifyName(value).length > 0, 'The name needs at least one letter or number')

export const addStageSchema = z.object({
  pipeline_id: uuidField('That pipeline could not be found'),
  name: stageName,
  outcome: z.enum(['none', 'won', 'lost']).catch('none'),
})

export const renameStageSchema = z.object({
  id: uuidField('That stage could not be found'),
  name: stageName,
})

export const stageIdSchema = z.object({
  id: uuidField('That stage could not be found'),
})

/** One dispatch per management surface, mirroring the card-intent pattern. */
export const PIPELINE_MANAGE_INTENTS = ['update', 'archive', 'restore', 'delete'] as const
export type PipelineManageIntent = (typeof PIPELINE_MANAGE_INTENTS)[number]

export function parsePipelineManageIntent(
  value: string | undefined | null,
): PipelineManageIntent | null {
  return PIPELINE_MANAGE_INTENTS.find((intent) => intent === value) ?? null
}

export const STAGE_INTENTS = [
  'rename',
  'move_up',
  'move_down',
  'archive',
  'restore',
  'delete',
] as const
export type StageIntent = (typeof STAGE_INTENTS)[number]

export function parseStageIntent(value: string | undefined | null): StageIntent | null {
  return STAGE_INTENTS.find((intent) => intent === value) ?? null
}
