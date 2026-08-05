'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { canWrite, requireProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import {
  addPipelineCardSchema,
  closeCardSchema,
  closeOutcomeFor,
  fieldErrorsFrom,
  moveCardSchema,
  parseCardIntent,
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

/** Revalidates the index and every board beneath it in one call. */
function revalidatePipelines(contactId?: string | null): void {
  revalidatePath('/pipelines', 'layout')
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
    contact_id: text(formData, 'contact_id'),
    title: text(formData, 'title'),
    details: text(formData, 'details'),
    value_cents: text(formData, 'value_cents'),
    owner_id: formData.has('owner_id') ? text(formData, 'owner_id') : profile.id,
    expected_close_on: text(formData, 'expected_close_on'),
  })

  if (!parsed.success) {
    return { error: 'Check the highlighted fields.', fieldErrors: fieldErrorsFrom(parsed.error) }
  }

  const supabase = await createClient()
  const [pipelineResult, stageResult] = await Promise.all([
    supabase
      .from('pipelines')
      .select('id, slug, tracks_value')
      .eq('id', parsed.data.pipeline_id)
      .maybeSingle(),
    supabase
      .from('pipeline_stages')
      .select('id')
      .eq('pipeline_id', parsed.data.pipeline_id)
      .order('position', { ascending: true })
      .limit(1)
      .maybeSingle(),
  ])

  if (pipelineResult.error || !pipelineResult.data) {
    return { error: 'That pipeline could not be found.' }
  }
  if (stageResult.error || !stageResult.data) {
    return { error: 'That pipeline has no stages yet, so cards cannot be added to it.' }
  }

  const { error } = await supabase.from('pipeline_cards').insert({
    pipeline_id: pipelineResult.data.id,
    stage_id: stageResult.data.id,
    contact_id: parsed.data.contact_id,
    title: parsed.data.title,
    details: parsed.data.details,
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
    return applyCardUpdate(
      parsed.data.id,
      { stage_id: parsed.data.stage_id },
      'Card moved.',
      'That stage is not part of this pipeline.',
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
    outcome === 'won' ? 'Card marked won.' : 'Card marked lost.',
  )
}

async function applyCardUpdate(
  id: string,
  patch: Partial<PipelineCardRow>,
  notice: string,
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
    .select('id, contact_id')
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
  return { notice }
}
