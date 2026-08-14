'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { canWrite, requireProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { truncate } from '@/lib/utils'
import {
  addPipelineCardSchema,
  closeCardSchema,
  closeOutcomeFor,
  fieldErrorsFrom,
  moveCardSchema,
  parseCardIntent,
  updateOpportunitySchema,
} from '@/lib/validation/pipeline'
import type { PipelineCardRow } from '@/types/database'

/**
 * Pipeline card mutations.
 *
 * Card creation, stage moves and closures are all written to the timeline by
 * database triggers, so nothing here inserts an activity row.
 */

export interface PipelineActionState {
  error?: string
  fieldErrors?: Record<string, string>
  notice?: string
}

const NO_PERMISSION = 'You do not have permission to change pipeline cards.'

/** Postgres unique-violation; here it means the one-open-card-per-contact index. */
const UNIQUE_VIOLATION = '23505'
/** Foreign-key violation; here it means the stage belongs to another pipeline. */
const FOREIGN_KEY_VIOLATION = '23503'

function text(formData: FormData, name: string): string {
  const value = formData.get(name)
  return typeof value === 'string' ? value : ''
}

/** Revalidates the boards, the Sales section and the dashboard in one call. */
function revalidatePipelines(contactId?: string | null): void {
  revalidatePath('/pipelines', 'layout')
  revalidatePath('/sales', 'layout')
  revalidatePath('/dashboard')
  if (contactId) revalidatePath(`/contacts/${contactId}`)
}

export async function addContactToPipeline(
  _prev: PipelineActionState,
  formData: FormData,
): Promise<PipelineActionState> {
  const profile = await requireProfile()
  if (!canWrite(profile)) return { error: NO_PERMISSION }

  const parsed = addPipelineCardSchema.safeParse({
    pipeline_id: text(formData, 'pipeline_id'),
    stage_id: text(formData, 'stage_id'),
    contact_id: text(formData, 'contact_id'),
    title: text(formData, 'title'),
    details: text(formData, 'details'),
    organization_name: text(formData, 'organization_name'),
    next_step: text(formData, 'next_step'),
    value_cents: text(formData, 'value_cents'),
    owner_id: formData.has('owner_id') ? text(formData, 'owner_id') : profile.id,
    expected_close_on: text(formData, 'expected_close_on'),
  })

  if (!parsed.success) {
    return { error: 'Check the highlighted fields.', fieldErrors: fieldErrorsFrom(parsed.error) }
  }

  const supabase = await createClient()
  const [pipelineResult, stagesResult] = await Promise.all([
    supabase
      .from('pipelines')
      .select('id, slug, tracks_value')
      .eq('id', parsed.data.pipeline_id)
      .maybeSingle(),
    supabase
      .from('pipeline_stages')
      .select('id')
      .eq('pipeline_id', parsed.data.pipeline_id)
      .is('archived_at', null)
      .order('position', { ascending: true }),
  ])

  if (pipelineResult.error || !pipelineResult.data) {
    return { error: 'That pipeline could not be found.' }
  }
  const stages = stagesResult.data ?? []
  if (stagesResult.error || stages.length === 0) {
    return { error: 'That pipeline has no stages yet, so cards cannot be added to it.' }
  }
  // A stage passed explicitly must be one of this pipeline's live stages; an
  // omitted one lands the opportunity at the start.
  const stageId = parsed.data.stage_id
    ? stages.find((stage) => stage.id === parsed.data.stage_id)?.id
    : stages[0]?.id
  if (!stageId) {
    return { error: 'That stage is not part of this pipeline.' }
  }

  const { error } = await supabase.from('pipeline_cards').insert({
    pipeline_id: pipelineResult.data.id,
    stage_id: stageId,
    contact_id: parsed.data.contact_id,
    title: parsed.data.title,
    details: parsed.data.details,
    organization_name: parsed.data.organization_name,
    next_step: parsed.data.next_step,
    // A pipeline that does not track value has nowhere sensible to show one.
    value_cents: pipelineResult.data.tracks_value ? parsed.data.value_cents : null,
    owner_id: parsed.data.owner_id,
    expected_close_on: parsed.data.expected_close_on,
    created_by: profile.id,
  })

  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      return {
        error:
          'That contact already has an open card in this pipeline. Close the existing card before starting another.',
      }
    }
    return { error: 'That card could not be created. Check the details and try again.' }
  }

  revalidatePipelines(parsed.data.contact_id)
  redirect(`/pipelines/${pipelineResult.data.slug}`)
}

/**
 * Move a card to another stage, or close it as won or lost — dispatched on the
 * submit button's `intent` so a card needs only one form.
 */
export async function updatePipelineCard(
  _prev: PipelineActionState,
  formData: FormData,
): Promise<PipelineActionState> {
  const profile = await requireProfile()
  if (!canWrite(profile)) return { error: NO_PERMISSION }

  const intent = parseCardIntent(text(formData, 'intent'))
  if (!intent) return { error: 'That action is not available.' }

  if (intent === 'move') {
    const parsed = moveCardSchema.safeParse({
      id: text(formData, 'id'),
      stage_id: text(formData, 'stage_id'),
    })
    if (!parsed.success) {
      return { error: 'Check the highlighted fields.', fieldErrors: fieldErrorsFrom(parsed.error) }
    }

    // The board announces the move to anyone who cannot see the card change
    // column, so the message names where it landed. The archived check covers
    // a stale board: a colleague may have archived the stage since it loaded
    // (the pipeline_cards_prevent_archived_stage trigger backstops the race).
    const supabase = await createClient()
    const { data: stage } = await supabase
      .from('pipeline_stages')
      .select('name, archived_at')
      .eq('id', parsed.data.stage_id)
      .maybeSingle()

    if (!stage || stage.archived_at !== null) {
      return { error: 'That stage has been archived. Refresh the board and choose a live stage.' }
    }

    return applyCardUpdate(
      parsed.data.id,
      { stage_id: parsed.data.stage_id },
      (title) => `Moved ${title} to ${stage.name}.`,
      'That stage is not part of this pipeline.',
    )
  }

  if (intent === 'move_up' || intent === 'move_down') {
    const id = text(formData, 'id')
    if (!id) return { error: 'That card could not be found.' }
    return reorderCard(id, intent === 'move_up' ? -1 : 1)
  }

  if (intent === 'archive') {
    const parsed = closeCardSchema.safeParse({
      id: text(formData, 'id'),
      close_reason: text(formData, 'close_reason'),
    })
    if (!parsed.success) {
      return { error: 'Check the highlighted fields.', fieldErrors: fieldErrorsFrom(parsed.error) }
    }
    return applyCardUpdate(
      parsed.data.id,
      {
        status: 'archived',
        closed_at: new Date().toISOString(),
        close_reason: parsed.data.close_reason,
      },
      (title) => `Archived ${title}.`,
    )
  }

  const outcome = closeOutcomeFor(intent)
  if (!outcome) return { error: 'That action is not available.' }

  const parsed = closeCardSchema.safeParse({
    id: text(formData, 'id'),
    close_reason: text(formData, 'close_reason'),
  })
  if (!parsed.success) {
    return { error: 'Check the highlighted fields.', fieldErrors: fieldErrorsFrom(parsed.error) }
  }

  // status and closed_at are paired by a check constraint; setting one without
  // the other is a 500 rather than a message.
  return applyCardUpdate(
    parsed.data.id,
    {
      status: outcome,
      closed_at: new Date().toISOString(),
      close_reason: parsed.data.close_reason,
    },
    (title) => `Marked ${title} ${outcome}.`,
  )
}

/**
 * Swap a card with its neighbour inside its stage. Positions may still be the
 * default 0 from before ordering existed, so the whole stage is renumbered
 * with the swap applied and only the rows that changed are written.
 */
async function reorderCard(id: string, direction: -1 | 1): Promise<PipelineActionState> {
  const supabase = await createClient()
  const { data: card, error: cardError } = await supabase
    .from('pipeline_cards')
    .select('id, stage_id, contact_id, title')
    .eq('id', id)
    .eq('status', 'open')
    .maybeSingle()

  if (cardError) return { error: 'That change could not be saved.' }
  if (!card) return { error: 'That card is no longer open, so it could not be changed.' }

  const { data: siblings, error: siblingsError } = await supabase
    .from('pipeline_cards')
    .select('id, position')
    .eq('stage_id', card.stage_id)
    .eq('status', 'open')
    .order('position', { ascending: true })
    .order('created_at', { ascending: true })

  if (siblingsError || !siblings) return { error: 'That change could not be saved.' }

  const index = siblings.findIndex((sibling) => sibling.id === card.id)
  const target = index + direction
  if (index === -1 || target < 0 || target >= siblings.length) {
    return { notice: `“${truncate(card.title, 60)}” is already at the ${direction < 0 ? 'top' : 'bottom'}.` }
  }

  const ordered = [...siblings]
  ;[ordered[index], ordered[target]] = [ordered[target]!, ordered[index]!]

  for (const [position, sibling] of ordered.entries()) {
    const next = (position + 1) * 10
    if (sibling.position === next) continue
    const { error } = await supabase
      .from('pipeline_cards')
      .update({ position: next })
      .eq('id', sibling.id)
      .eq('status', 'open')
    if (error) return { error: 'That change could not be saved.' }
  }

  revalidatePipelines(card.contact_id)
  return { notice: `Moved “${truncate(card.title, 60)}” ${direction < 0 ? 'up' : 'down'}.` }
}

/** Edit an opportunity's own fields — stage and status stay with the board. */
export async function updateOpportunity(
  _prev: PipelineActionState,
  formData: FormData,
): Promise<PipelineActionState> {
  const profile = await requireProfile()
  if (!canWrite(profile)) return { error: NO_PERMISSION }

  const parsed = updateOpportunitySchema.safeParse({
    id: text(formData, 'id'),
    title: text(formData, 'title'),
    details: text(formData, 'details'),
    organization_name: text(formData, 'organization_name'),
    next_step: text(formData, 'next_step'),
    value_cents: text(formData, 'value_cents'),
    owner_id: text(formData, 'owner_id'),
    expected_close_on: text(formData, 'expected_close_on'),
  })
  if (!parsed.success) {
    return { error: 'Check the highlighted fields.', fieldErrors: fieldErrorsFrom(parsed.error) }
  }

  const { id, ...fields } = parsed.data
  return applyCardUpdate(id, fields, (title) => `Saved ${title}.`)
}

async function applyCardUpdate(
  id: string,
  patch: Partial<PipelineCardRow>,
  /** Built from the stored title so the confirmation names the card. */
  notice: (title: string) => string,
  foreignKeyMessage = 'That change could not be saved.',
): Promise<PipelineActionState> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('pipeline_cards')
    .update(patch)
    .eq('id', id)
    // Guards against two people acting on the same card: a closed card stops
    // matching, so the second update reports rather than silently re-closing.
    .eq('status', 'open')
    .select('id, contact_id, title')
    .maybeSingle()

  if (error) {
    if (error.code === FOREIGN_KEY_VIOLATION) return { error: foreignKeyMessage }
    if (error.code === UNIQUE_VIOLATION) {
      return { error: 'That contact already has another open card in this pipeline.' }
    }
    return { error: 'That change could not be saved.' }
  }
  if (!data) {
    return { error: 'That card is no longer open, so it could not be changed.' }
  }

  revalidatePipelines(data.contact_id)
  return { notice: notice(`“${truncate(data.title, 60)}”`) }
}
