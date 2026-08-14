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
  archived: 'slate',
}

export const CARD_STATUS_LABELS: Record<PipelineCardStatus, string> = {
  open: 'Open',
  won: 'Won',
  lost: 'Lost',
  archived: 'Archived',
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
  /** Optional — an omitted stage lands the opportunity in the first one. */
  stage_id: optionalUuid,
  contact_id: uuidField('Choose a contact to add'),
  title: z
    .string()
    .trim()
    .min(1, 'Give this card a title')
    .max(200, 'Keep the title under 200 characters'),
  details: optionalText(4000),
  organization_name: optionalText(200),
  next_step: optionalText(300),
  value_cents: optionalCents,
  owner_id: optionalUuid,
  expected_close_on: optionalDate,
})

export type AddPipelineCardInput = z.infer<typeof addPipelineCardSchema>

export const updateOpportunitySchema = z.object({
  id: uuidField('That opportunity could not be found'),
  title: z
    .string()
    .trim()
    .min(1, 'Give this opportunity a title')
    .max(200, 'Keep the title under 200 characters'),
  details: optionalText(4000),
  organization_name: optionalText(200),
  next_step: optionalText(300),
  value_cents: optionalCents,
  owner_id: optionalUuid,
  expected_close_on: optionalDate,
})

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
 * which outcome, which is one more thing to keep in sync. The same reasoning
 * gives reordering two intents rather than a direction field.
 */
export const PIPELINE_CARD_INTENTS = [
  'move',
  'close_won',
  'close_lost',
  'archive',
  'move_up',
  'move_down',
] as const

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

// --- Pipeline editing --------------------------------------------------------

/** The stage colors the board can actually render (Tailwind literal classes). */
export const STAGE_COLORS = [
  'slate',
  'sky',
  'indigo',
  'violet',
  'amber',
  'emerald',
  'rose',
  'zinc',
] as const satisfies readonly BadgeTone[]

export type StageColor = (typeof STAGE_COLORS)[number]

/** In-flight, or one of the two terminal outcomes. */
export const STAGE_OUTCOMES = ['none', 'won', 'lost'] as const

export type StageOutcome = (typeof STAGE_OUTCOMES)[number]

export const STAGE_OUTCOME_CHOICES: Record<StageOutcome, string> = {
  none: 'In progress',
  won: 'Won — opportunities here count as landed',
  lost: 'Lost — opportunities here count as closed without a deal',
}

/**
 * Slugs route boards (`/pipelines/[slug]`) and key the seeds. Stage slugs must
 * satisfy `^[a-z0-9_]+$` (no hyphens — the tighter of the two DB checks), so
 * both kinds use underscores.
 */
export function pipelineSlug(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60)
    .replace(/_+$/g, '')
  return slug || 'pipeline'
}

const pipelineName = z
  .string()
  .trim()
  .min(1, 'Name this pipeline')
  .max(80, 'Keep the name under 80 characters')

const stageName = z
  .string()
  .trim()
  .min(1, 'Name this stage')
  .max(60, 'Keep the name under 60 characters')

const stageColor = z
  .string()
  .trim()
  .transform((value) => (value === '' ? 'slate' : value))
  .pipe(z.enum(STAGE_COLORS, { message: 'Pick one of the listed colors' }))

const stageOutcome = z
  .string()
  .trim()
  .transform((value) => (value === '' ? 'none' : value))
  .pipe(z.enum(STAGE_OUTCOMES, { message: 'Pick an outcome' }))

export const createPipelineSchema = z.object({
  name: pipelineName,
  description: optionalText(500),
  // A checkbox posts "on" or nothing at all.
  tracks_value: z.string().optional().transform((value) => value === 'on'),
})

export const updatePipelineSchema = z.object({
  id: uuidField('That pipeline could not be found'),
  name: pipelineName,
  description: optionalText(500),
  tracks_value: z.string().optional().transform((value) => value === 'on'),
})

export const createStageSchema = z.object({
  pipeline_id: uuidField('That pipeline could not be found'),
  name: stageName,
  color: stageColor,
  outcome: stageOutcome,
})

export const updateStageSchema = z.object({
  id: uuidField('That stage could not be found'),
  name: stageName,
  color: stageColor,
  outcome: stageOutcome,
})

export const PIPELINE_EDITOR_INTENTS = [
  'rename',
  'archive',
  'restore',
  'delete',
  'add_stage',
  'edit_stage',
  'stage_up',
  'stage_down',
  'archive_stage',
  'restore_stage',
  'delete_stage',
] as const

export type PipelineEditorIntent = (typeof PIPELINE_EDITOR_INTENTS)[number]

export function parseEditorIntent(value: string | undefined | null): PipelineEditorIntent | null {
  return PIPELINE_EDITOR_INTENTS.find((intent) => intent === value) ?? null
}
