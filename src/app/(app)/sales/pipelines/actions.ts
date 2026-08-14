'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { canWrite, requireProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import {
  createPipelineSchema,
  createStageSchema,
  fieldErrorsFrom,
  parseEditorIntent,
  pipelineSlug,
  updatePipelineSchema,
  updateStageSchema,
} from '@/lib/validation/pipeline'

/**
 * Pipeline structure mutations — create, rename, reorder, archive, delete.
 *
 * The database owns the two destructive-safety rules (a pipeline or stage
 * holding opportunities refuses deletion; a stage with open opportunities
 * refuses archiving), so this file only has to translate those refusals into
 * sentences. RLS restricts every write to active staff.
 */

export interface PipelineEditorState {
  error?: string
  fieldErrors?: Record<string, string>
  notice?: string
}

const NO_PERMISSION = 'You do not have permission to manage pipelines.'
const UNIQUE_VIOLATION = '23505'

/** The guard triggers raise with errcode check_violation. */
const GUARD_MESSAGES: [RegExp, string][] = [
  [/still holds opportunities/i, 'This still holds opportunities. Move or archive them first.'],
  [/still has open opportunities/i, 'This stage still has open opportunities. Move them to another stage first.'],
]

function guardMessage(error: { message?: string } | null): string | null {
  const message = error?.message ?? ''
  for (const [pattern, friendly] of GUARD_MESSAGES) {
    if (pattern.test(message)) return friendly
  }
  return null
}

function text(formData: FormData, name: string): string {
  const value = formData.get(name)
  return typeof value === 'string' ? value : ''
}

function revalidateSales(): void {
  revalidatePath('/sales', 'layout')
  revalidatePath('/pipelines', 'layout')
  revalidatePath('/dashboard')
}

/** A slug that collides gets a numeric suffix rather than a refusal. */
async function uniquePipelineSlug(name: string): Promise<string> {
  const supabase = await createClient()
  const base = pipelineSlug(name)
  const { data } = await supabase.from('pipelines').select('slug').like('slug', `${base}%`)
  const taken = new Set((data ?? []).map((row) => row.slug))
  if (!taken.has(base)) return base
  for (let n = 2; ; n += 1) {
    const candidate = `${base}_${n}`
    if (!taken.has(candidate)) return candidate
  }
}

export async function createPipeline(
  _prev: PipelineEditorState,
  formData: FormData,
): Promise<PipelineEditorState> {
  const profile = await requireProfile()
  if (!canWrite(profile)) return { error: NO_PERMISSION }

  const parsed = createPipelineSchema.safeParse({
    name: text(formData, 'name'),
    description: text(formData, 'description'),
    tracks_value: text(formData, 'tracks_value') || undefined,
  })
  if (!parsed.success) {
    return { error: 'Check the highlighted fields.', fieldErrors: fieldErrorsFrom(parsed.error) }
  }

  const supabase = await createClient()
  const { data: last } = await supabase
    .from('pipelines')
    .select('sort_order')
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle()

  const slug = await uniquePipelineSlug(parsed.data.name)
  const { error } = await supabase.from('pipelines').insert({
    slug,
    name: parsed.data.name,
    description: parsed.data.description,
    tracks_value: parsed.data.tracks_value,
    sort_order: (last?.sort_order ?? 0) + 10,
  })

  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      return { error: 'A pipeline with a very similar name already exists.' }
    }
    return { error: 'That pipeline could not be created.' }
  }

  revalidateSales()
  redirect(`/sales/pipelines/${slug}`)
}

/**
 * Everything that happens on a pipeline's edit screen, dispatched on the
 * submitting form's hidden `intent` — the same one-form-per-action mechanics
 * as the board (buttons must not carry name/value; real browsers drop them).
 */
export async function managePipeline(
  _prev: PipelineEditorState,
  formData: FormData,
): Promise<PipelineEditorState> {
  const profile = await requireProfile()
  if (!canWrite(profile)) return { error: NO_PERMISSION }

  const intent = parseEditorIntent(text(formData, 'intent'))
  if (!intent) return { error: 'That action is not available.' }

  const supabase = await createClient()

  switch (intent) {
    case 'rename': {
      const parsed = updatePipelineSchema.safeParse({
        id: text(formData, 'id'),
        name: text(formData, 'name'),
        description: text(formData, 'description'),
        tracks_value: text(formData, 'tracks_value') || undefined,
      })
      if (!parsed.success) {
        return { error: 'Check the highlighted fields.', fieldErrors: fieldErrorsFrom(parsed.error) }
      }
      const { data, error } = await supabase
        .from('pipelines')
        .update({
          name: parsed.data.name,
          description: parsed.data.description,
          tracks_value: parsed.data.tracks_value,
        })
        .eq('id', parsed.data.id)
        .select('id')
        .maybeSingle()
      if (error || !data) return { error: 'That pipeline could not be saved.' }
      revalidateSales()
      return { notice: 'Pipeline saved.' }
    }

    case 'archive':
    case 'restore': {
      const id = text(formData, 'id')
      const { data, error } = await supabase
        .from('pipelines')
        .update({ is_active: intent === 'restore' })
        .eq('id', id)
        .select('id, name')
        .maybeSingle()
      if (error || !data) return { error: 'That pipeline could not be changed.' }
      revalidateSales()
      return {
        notice:
          intent === 'archive'
            ? `Archived “${data.name}”. Its opportunities are kept and its board is read-only.`
            : `Restored “${data.name}”.`,
      }
    }

    case 'delete': {
      const id = text(formData, 'id')
      const { data, error } = await supabase
        .from('pipelines')
        .delete()
        .eq('id', id)
        .select('id')
        .maybeSingle()
      const guarded = guardMessage(error)
      if (guarded) return { error: guarded }
      if (error || !data) return { error: 'That pipeline could not be deleted.' }
      revalidateSales()
      redirect('/sales/pipelines')
      break
    }

    case 'add_stage': {
      const parsed = createStageSchema.safeParse({
        pipeline_id: text(formData, 'pipeline_id'),
        name: text(formData, 'name'),
        color: text(formData, 'color'),
        outcome: text(formData, 'outcome'),
      })
      if (!parsed.success) {
        return { error: 'Check the highlighted fields.', fieldErrors: fieldErrorsFrom(parsed.error) }
      }

      const { data: existing } = await supabase
        .from('pipeline_stages')
        .select('slug, position')
        .eq('pipeline_id', parsed.data.pipeline_id)
      const taken = new Set((existing ?? []).map((stage) => stage.slug))
      const base = pipelineSlug(parsed.data.name)
      let slug = base
      for (let n = 2; taken.has(slug); n += 1) slug = `${base}_${n}`
      const position = Math.max(0, ...(existing ?? []).map((stage) => stage.position)) + 10

      const { error } = await supabase.from('pipeline_stages').insert({
        pipeline_id: parsed.data.pipeline_id,
        slug,
        name: parsed.data.name,
        position,
        color: parsed.data.color,
        is_won: parsed.data.outcome === 'won',
        is_lost: parsed.data.outcome === 'lost',
      })
      if (error) return { error: 'That stage could not be added.' }
      revalidateSales()
      return { notice: `Added the “${parsed.data.name}” stage.` }
    }

    case 'edit_stage': {
      const parsed = updateStageSchema.safeParse({
        id: text(formData, 'id'),
        name: text(formData, 'name'),
        color: text(formData, 'color'),
        outcome: text(formData, 'outcome'),
      })
      if (!parsed.success) {
        return { error: 'Check the highlighted fields.', fieldErrors: fieldErrorsFrom(parsed.error) }
      }
      const { data, error } = await supabase
        .from('pipeline_stages')
        .update({
          name: parsed.data.name,
          color: parsed.data.color,
          is_won: parsed.data.outcome === 'won',
          is_lost: parsed.data.outcome === 'lost',
        })
        .eq('id', parsed.data.id)
        .select('id')
        .maybeSingle()
      if (error || !data) return { error: 'That stage could not be saved.' }
      revalidateSales()
      return { notice: `Saved the “${parsed.data.name}” stage.` }
    }

    case 'stage_up':
    case 'stage_down':
      return reorderStage(text(formData, 'id'), intent === 'stage_up' ? -1 : 1)

    case 'archive_stage':
    case 'restore_stage': {
      const id = text(formData, 'id')
      const { data, error } = await supabase
        .from('pipeline_stages')
        .update({ archived_at: intent === 'archive_stage' ? new Date().toISOString() : null })
        .eq('id', id)
        .select('id, name')
        .maybeSingle()
      const guarded = guardMessage(error)
      if (guarded) return { error: guarded }
      if (error || !data) return { error: 'That stage could not be changed.' }
      revalidateSales()
      return {
        notice:
          intent === 'archive_stage'
            ? `Archived the “${data.name}” stage.`
            : `Restored the “${data.name}” stage.`,
      }
    }

    case 'delete_stage': {
      const id = text(formData, 'id')
      const { data, error } = await supabase
        .from('pipeline_stages')
        .delete()
        .eq('id', id)
        .select('id')
        .maybeSingle()
      const guarded = guardMessage(error)
      if (guarded) return { error: guarded }
      if (error || !data) return { error: 'That stage could not be deleted.' }
      revalidateSales()
      return { notice: 'Stage deleted.' }
    }
  }

  return { error: 'That action is not available.' }
}

/** Same renumber-with-swap approach as card reordering on the board. */
async function reorderStage(id: string, direction: -1 | 1): Promise<PipelineEditorState> {
  if (!id) return { error: 'That stage could not be found.' }
  const supabase = await createClient()

  const { data: stage, error: stageError } = await supabase
    .from('pipeline_stages')
    .select('id, pipeline_id, name')
    .eq('id', id)
    .maybeSingle()
  if (stageError || !stage) return { error: 'That stage could not be found.' }

  const { data: siblings, error: siblingsError } = await supabase
    .from('pipeline_stages')
    .select('id, position')
    .eq('pipeline_id', stage.pipeline_id)
    .is('archived_at', null)
    .order('position', { ascending: true })
  if (siblingsError || !siblings) return { error: 'That change could not be saved.' }

  const index = siblings.findIndex((sibling) => sibling.id === stage.id)
  const target = index + direction
  if (index === -1 || target < 0 || target >= siblings.length) {
    return { notice: `“${stage.name}” is already at the ${direction < 0 ? 'start' : 'end'}.` }
  }

  const ordered = [...siblings]
  ;[ordered[index], ordered[target]] = [ordered[target]!, ordered[index]!]

  for (const [position, sibling] of ordered.entries()) {
    const next = (position + 1) * 10
    if (sibling.position === next) continue
    const { error } = await supabase
      .from('pipeline_stages')
      .update({ position: next })
      .eq('id', sibling.id)
    if (error) return { error: 'That change could not be saved.' }
  }

  revalidateSales()
  return { notice: `Moved the “${stage.name}” stage ${direction < 0 ? 'earlier' : 'later'}.` }
}
