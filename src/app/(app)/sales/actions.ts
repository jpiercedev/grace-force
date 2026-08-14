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
 * Opportunity mutations.
 *
 * Creation, stage moves and closures are all written to the timeline by
 * database triggers, so nothing here inserts an activity row. The archived
 * status rides the same trigger as won/lost — it is a closure with a
 * different label.
 */

export interface PipelineActionState {
  error?: string
  fieldErrors?: Record<string, string>
  notice?: string
}

const NO_PERMISSION = 'You do not have permission to change opportunities.'

/** Postgres unique-violation; here it means the one-open-card-per-contact index. */
const UNIQUE_VIOLATION = '23505'
/** Foreign-key violation; here it means the stage belongs to another pipeline. */
const FOREIGN_KEY_VIOLATION = '23503'
/** Raised by our own guard triggers, whose messages are written for people. */
const CHECK_VIOLATION = '23514'

function text(formData: FormData, name: string): string {
  const value = formData.get(name)
  return typeof value === 'string' ? value : ''
}

/** Revalidates the Sales area and every surface an opportunity shows on. */
function revalidateSales(contactId?: string | null): void {
  revalidatePath('/sales', 'layout')
  revalidatePath('/dashboard')
  if (contactId) revalidatePath(`/contacts/${contactId}`)
}

export async function createOpportunity(
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
    organization_name: text(formData, 'organization_name'),
    next_step: text(formData, 'next_step'),
  })

  if (!parsed.success) {
    return { error: 'Check the highlighted fields.', fieldErrors: fieldErrorsFrom(parsed.error) }
  }

  // Where to land afterwards: the board (default) or back on the person.
  // A fixed vocabulary, not a URL from the form — forms must not steer
  // redirects to arbitrary destinations.
  const returnTo = text(formData, 'return_to') === 'contact' ? 'contact' : 'board'

  const supabase = await createClient()
  const [pipelineResult, stageResult] = await Promise.all([
    supabase
      .from('pipelines')
      .select('id, slug, tracks_value, is_active')
      .eq('id', parsed.data.pipeline_id)
      .maybeSingle(),
    supabase
      .from('pipeline_stages')
      .select('id')
      .eq('pipeline_id', parsed.data.pipeline_id)
      .is('archived_at', null)
      .order('position', { ascending: true })
      .limit(1)
      .maybeSingle(),
  ])

  if (pipelineResult.error || !pipelineResult.data) {
    return { error: 'That pipeline could not be found.' }
  }
  if (!pipelineResult.data.is_active) {
    return { error: 'That pipeline has been archived. Choose an active pipeline.' }
  }
  if (stageResult.error || !stageResult.data) {
    return { error: 'That pipeline has no stages yet, so opportunities cannot be added to it.' }
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
    organization_name: parsed.data.organization_name,
    next_step: parsed.data.next_step,
    created_by: profile.id,
  })

  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      return {
        error:
          'That person already has an open opportunity in this pipeline. Close the existing one before starting another.',
      }
    }
    if (error.code === CHECK_VIOLATION) return { error: error.message }
    return { error: 'That opportunity could not be created. Check the details and try again.' }
  }

  revalidateSales(parsed.data.contact_id)
  redirect(
    returnTo === 'contact'
      ? `/contacts/${parsed.data.contact_id}`
      : `/sales/pipelines/${pipelineResult.data.slug}`,
  )
}

/**
 * Move an opportunity to another stage, or settle it as won, lost or
 * archived — dispatched on a hidden `intent` field so each action submits a
 * dedicated form.
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
    // column, so the message names where it landed.
    const supabase = await createClient()
    const { data: stage } = await supabase
      .from('pipeline_stages')
      .select('name')
      .eq('id', parsed.data.stage_id)
      .maybeSingle()

    return applyCardUpdate(
      parsed.data.id,
      { stage_id: parsed.data.stage_id },
      (title) => (stage ? `Moved ${title} to ${stage.name}.` : `Moved ${title}.`),
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
    (title) => (outcome === 'archived' ? `Archived ${title}.` : `Marked ${title} ${outcome}.`),
  )
}

/** The edit page: facts about the opportunity, never its status or stage. */
export async function updateOpportunityDetails(
  _prev: PipelineActionState,
  formData: FormData,
): Promise<PipelineActionState> {
  const profile = await requireProfile()
  if (!canWrite(profile)) return { error: NO_PERMISSION }

  const parsed = updateOpportunitySchema.safeParse({
    id: text(formData, 'id'),
    title: text(formData, 'title'),
    details: text(formData, 'details'),
    value_cents: text(formData, 'value_cents'),
    owner_id: text(formData, 'owner_id'),
    expected_close_on: text(formData, 'expected_close_on'),
    organization_name: text(formData, 'organization_name'),
    next_step: text(formData, 'next_step'),
  })

  if (!parsed.success) {
    return { error: 'Check the highlighted fields.', fieldErrors: fieldErrorsFrom(parsed.error) }
  }

  const { id, value_cents, ...patch } = parsed.data

  // The value field only renders on value-tracking pipelines, so a form
  // without it must not null a stored value — and a crafted POST must not
  // plant one on a pipeline that does not track value. Same rule as create.
  if (formData.has('value_cents')) {
    const supabase = await createClient()
    const { data: card } = await supabase
      .from('pipeline_cards')
      .select('pipeline:pipelines!inner(tracks_value)')
      .eq('id', id)
      .maybeSingle()
      .overrideTypes<{ pipeline: { tracks_value: boolean } | null }, { merge: false }>()

    if (card?.pipeline?.tracks_value) {
      return applyCardUpdate(id, { ...patch, value_cents }, (title) => `Saved ${title}.`)
    }
  }

  return applyCardUpdate(id, patch, (title) => `Saved ${title}.`)
}

async function applyCardUpdate(
  id: string,
  patch: Partial<PipelineCardRow>,
  /** Built from the stored title so the confirmation names the opportunity. */
  notice: (title: string) => string,
  foreignKeyMessage = 'That change could not be saved.',
): Promise<PipelineActionState> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('pipeline_cards')
    .update(patch)
    .eq('id', id)
    // Guards against two people acting on the same opportunity: a settled one
    // stops matching, so the second update reports rather than silently
    // re-closing.
    .eq('status', 'open')
    .select('id, contact_id, title')
    .maybeSingle()

  if (error) {
    if (error.code === FOREIGN_KEY_VIOLATION) return { error: foreignKeyMessage }
    if (error.code === UNIQUE_VIOLATION) {
      return { error: 'That person already has another open opportunity in this pipeline.' }
    }
    if (error.code === CHECK_VIOLATION) return { error: error.message }
    return { error: 'That change could not be saved.' }
  }
  if (!data) {
    return { error: 'That opportunity is no longer open, so it could not be changed.' }
  }

  revalidateSales(data.contact_id)
  return { notice: notice(`“${truncate(data.title, 60)}”`) }
}
