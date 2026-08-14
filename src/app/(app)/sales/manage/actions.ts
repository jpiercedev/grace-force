'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { canWrite, requireProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import {
  addStageSchema,
  createPipelineSchema,
  fieldErrorsFrom,
  parsePipelineManageIntent,
  parseStageIntent,
  pipelineIdSchema,
  renameStageSchema,
  slugifyName,
  stageIdSchema,
  updatePipelineSchema,
} from '@/lib/validation/pipeline'

/**
 * Pipeline and stage management.
 *
 * The destructive paths lean on the database guards rather than re-checking
 * here: a pipeline or stage that still holds opportunities refuses its own
 * DELETE, and a stage with open opportunities refuses archiving. Those
 * triggers raise check_violation with a human sentence, which these actions
 * pass straight through.
 */

export interface ManageActionState {
  error?: string
  fieldErrors?: Record<string, string>
  notice?: string
}

const NO_PERMISSION = 'You do not have permission to manage pipelines.'

const UNIQUE_VIOLATION = '23505'
/** Our own guard triggers — their messages are written for people. */
const CHECK_VIOLATION = '23514'

function text(formData: FormData, name: string): string {
  const value = formData.get(name)
  return typeof value === 'string' ? value : ''
}

function revalidateManage(): void {
  revalidatePath('/sales', 'layout')
  revalidatePath('/dashboard')
}

/**
 * Slugs identify boards in URLs, so they must be unique. The candidate comes
 * from the name; collisions take a numeric suffix rather than failing.
 */
async function uniqueSlug(
  table: 'pipelines' | 'pipeline_stages',
  candidate: string,
  scope?: { pipeline_id: string },
): Promise<string> {
  const supabase = await createClient()
  const { data, error } =
    table === 'pipelines'
      ? await supabase.from('pipelines').select('slug')
      : await supabase
          .from('pipeline_stages')
          .select('slug')
          .eq('pipeline_id', scope?.pipeline_id ?? '')
  if (error) throw error

  const taken = new Set((data ?? []).map((row) => row.slug))
  if (!taken.has(candidate)) return candidate
  for (let n = 2; ; n += 1) {
    const suffixed = `${candidate}_${n}`
    if (!taken.has(suffixed)) return suffixed
  }
}

export async function createPipeline(
  _prev: ManageActionState,
  formData: FormData,
): Promise<ManageActionState> {
  const profile = await requireProfile()
  if (!canWrite(profile)) return { error: NO_PERMISSION }

  const parsed = createPipelineSchema.safeParse({
    name: text(formData, 'name'),
    description: text(formData, 'description'),
    tracks_value: formData.get('tracks_value'),
  })
  if (!parsed.success) {
    return { error: 'Check the highlighted fields.', fieldErrors: fieldErrorsFrom(parsed.error) }
  }

  const supabase = await createClient()
  const slug = await uniqueSlug('pipelines', slugifyName(parsed.data.name))

  // New pipelines sort after everything that exists.
  const { data: last } = await supabase
    .from('pipelines')
    .select('sort_order')
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle()

  const { error } = await supabase.from('pipelines').insert({
    slug,
    name: parsed.data.name,
    description: parsed.data.description,
    tracks_value: parsed.data.tracks_value === 'on',
    sort_order: (last?.sort_order ?? 100) + 10,
  })

  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      return { error: 'A pipeline with a very similar name already exists.' }
    }
    return { error: 'That pipeline could not be created. Check the details and try again.' }
  }

  revalidateManage()
  redirect(`/sales/manage/${slug}`)
}

/** Rename/describe, archive, restore or delete — dispatched on `intent`. */
export async function updatePipeline(
  _prev: ManageActionState,
  formData: FormData,
): Promise<ManageActionState> {
  const profile = await requireProfile()
  if (!canWrite(profile)) return { error: NO_PERMISSION }

  const intent = parsePipelineManageIntent(text(formData, 'intent'))
  if (!intent) return { error: 'That action is not available.' }

  const supabase = await createClient()

  if (intent === 'update') {
    const parsed = updatePipelineSchema.safeParse({
      id: text(formData, 'id'),
      name: text(formData, 'name'),
      description: text(formData, 'description'),
      tracks_value: formData.get('tracks_value'),
    })
    if (!parsed.success) {
      return { error: 'Check the highlighted fields.', fieldErrors: fieldErrorsFrom(parsed.error) }
    }

    // The slug survives a rename so bookmarks and shared board links keep
    // working; only the display name changes.
    const { data, error } = await supabase
      .from('pipelines')
      .update({
        name: parsed.data.name,
        description: parsed.data.description,
        tracks_value: parsed.data.tracks_value === 'on',
      })
      .eq('id', parsed.data.id)
      .select('id, name')
      .maybeSingle()

    if (error) return { error: 'That change could not be saved.' }
    if (!data) return { error: 'That pipeline could not be found.' }

    revalidateManage()
    return { notice: `Saved “${data.name}”.` }
  }

  const parsed = pipelineIdSchema.safeParse({ id: text(formData, 'id') })
  if (!parsed.success) return { error: 'That pipeline could not be found.' }

  if (intent === 'archive' || intent === 'restore') {
    const active = intent === 'restore'
    const { data, error } = await supabase
      .from('pipelines')
      .update({ is_active: active })
      .eq('id', parsed.data.id)
      .select('id, name')
      .maybeSingle()

    if (error) return { error: 'That change could not be saved.' }
    if (!data) return { error: 'That pipeline could not be found.' }

    revalidateManage()
    return {
      notice: active
        ? `Restored “${data.name}”. Its board is live again.`
        : `Archived “${data.name}”. Its board is read-only until it is restored.`,
    }
  }

  // intent === 'delete' — the trigger refuses if any opportunity exists.
  const { data, error } = await supabase
    .from('pipelines')
    .delete()
    .eq('id', parsed.data.id)
    .select('id')
    .maybeSingle()

  if (error) {
    if (error.code === CHECK_VIOLATION) return { error: error.message }
    return { error: 'That pipeline could not be deleted.' }
  }
  if (!data) return { error: 'That pipeline could not be found.' }

  revalidateManage()
  redirect('/sales/manage')
}

export async function addStage(
  _prev: ManageActionState,
  formData: FormData,
): Promise<ManageActionState> {
  const profile = await requireProfile()
  if (!canWrite(profile)) return { error: NO_PERMISSION }

  const parsed = addStageSchema.safeParse({
    pipeline_id: text(formData, 'pipeline_id'),
    name: text(formData, 'name'),
    outcome: text(formData, 'outcome'),
  })
  if (!parsed.success) {
    return { error: 'Check the highlighted fields.', fieldErrors: fieldErrorsFrom(parsed.error) }
  }

  const supabase = await createClient()
  const slug = await uniqueSlug('pipeline_stages', slugifyName(parsed.data.name), {
    pipeline_id: parsed.data.pipeline_id,
  })

  const { data: last } = await supabase
    .from('pipeline_stages')
    .select('position')
    .eq('pipeline_id', parsed.data.pipeline_id)
    .order('position', { ascending: false })
    .limit(1)
    .maybeSingle()

  const { error } = await supabase.from('pipeline_stages').insert({
    pipeline_id: parsed.data.pipeline_id,
    slug,
    name: parsed.data.name,
    position: (last?.position ?? 0) + 10,
    is_won: parsed.data.outcome === 'won',
    is_lost: parsed.data.outcome === 'lost',
    // New stages stay neutral; terminal stages carry their tone via the badge.
    color: parsed.data.outcome === 'won' ? 'emerald' : parsed.data.outcome === 'lost' ? 'zinc' : 'slate',
  })

  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      return { error: 'A stage with a very similar name already exists on this pipeline.' }
    }
    return { error: 'That stage could not be added.' }
  }

  revalidateManage()
  return { notice: `Added “${parsed.data.name}”.` }
}

/** Rename, reorder, archive, restore or delete one stage — on `intent`. */
export async function updateStage(
  _prev: ManageActionState,
  formData: FormData,
): Promise<ManageActionState> {
  const profile = await requireProfile()
  if (!canWrite(profile)) return { error: NO_PERMISSION }

  const intent = parseStageIntent(text(formData, 'intent'))
  if (!intent) return { error: 'That action is not available.' }

  const supabase = await createClient()

  if (intent === 'rename') {
    const parsed = renameStageSchema.safeParse({
      id: text(formData, 'id'),
      name: text(formData, 'name'),
    })
    if (!parsed.success) {
      return { error: 'Check the highlighted fields.', fieldErrors: fieldErrorsFrom(parsed.error) }
    }

    const { data, error } = await supabase
      .from('pipeline_stages')
      .update({ name: parsed.data.name })
      .eq('id', parsed.data.id)
      .select('id, name')
      .maybeSingle()

    if (error) return { error: 'That change could not be saved.' }
    if (!data) return { error: 'That stage could not be found.' }

    revalidateManage()
    return { notice: `Renamed the stage to “${data.name}”.` }
  }

  const parsed = stageIdSchema.safeParse({ id: text(formData, 'id') })
  if (!parsed.success) return { error: 'That stage could not be found.' }

  if (intent === 'move_up' || intent === 'move_down') {
    return moveStage(parsed.data.id, intent === 'move_up' ? -1 : 1)
  }

  if (intent === 'archive' || intent === 'restore') {
    const { data, error } = await supabase
      .from('pipeline_stages')
      .update({ archived_at: intent === 'archive' ? new Date().toISOString() : null })
      .eq('id', parsed.data.id)
      .select('id, name')
      .maybeSingle()

    if (error) {
      // The guard trigger: a stage with open opportunities cannot be archived.
      if (error.code === CHECK_VIOLATION) return { error: error.message }
      return { error: 'That change could not be saved.' }
    }
    if (!data) return { error: 'That stage could not be found.' }

    revalidateManage()
    return {
      notice:
        intent === 'archive'
          ? `Archived “${data.name}”. Closed opportunities keep their history.`
          : `Restored “${data.name}”.`,
    }
  }

  // intent === 'delete' — the trigger refuses if any opportunity references it.
  const { data, error } = await supabase
    .from('pipeline_stages')
    .delete()
    .eq('id', parsed.data.id)
    .select('id, name')
    .maybeSingle()

  if (error) {
    if (error.code === CHECK_VIOLATION) return { error: error.message }
    return { error: 'That stage could not be deleted.' }
  }
  if (!data) return { error: 'That stage could not be found.' }

  revalidateManage()
  return { notice: `Deleted “${data.name}”.` }
}

/**
 * Swap the stage with its live neighbour, then renumber *every* stage —
 * archived ones included — to a clean 10/20/30 sequence. Renumbering only the
 * live subset would leave an archived stage holding a position that ties with
 * a live one, and a tie makes the board's column order flap between requests.
 */
async function moveStage(id: string, direction: -1 | 1): Promise<ManageActionState> {
  const supabase = await createClient()

  const { data: stage, error: stageError } = await supabase
    .from('pipeline_stages')
    .select('id, pipeline_id')
    .eq('id', id)
    .maybeSingle()

  if (stageError) return { error: 'That change could not be saved.' }
  if (!stage) return { error: 'That stage could not be found.' }

  const { data: siblings, error: siblingsError } = await supabase
    .from('pipeline_stages')
    .select('id, name, position, archived_at')
    .eq('pipeline_id', stage.pipeline_id)
    .order('position', { ascending: true })
    .order('created_at', { ascending: true })

  if (siblingsError || !siblings) return { error: 'That change could not be saved.' }

  const live = siblings.filter((row) => row.archived_at === null)
  const archived = siblings.filter((row) => row.archived_at !== null)

  const index = live.findIndex((row) => row.id === id)
  const targetIndex = index + direction
  if (index === -1) return { error: 'That stage could not be found.' }
  if (targetIndex < 0 || targetIndex >= live.length) {
    return { error: 'That stage is already at the end of the board.' }
  }

  const reordered = [...live]
  const [moved] = reordered.splice(index, 1)
  if (!moved) return { error: 'That change could not be saved.' }
  reordered.splice(targetIndex, 0, moved)

  // One UPDATE per stage; the board is bounded by what a team can hold in
  // flight, so a handful of writes beats an RPC nobody else needs. Archived
  // stages renumber after the live ones, keeping their relative order — a
  // restored stage reappears at the end of the board, deterministically.
  for (const [position, row] of [...reordered, ...archived].entries()) {
    const { error } = await supabase
      .from('pipeline_stages')
      .update({ position: (position + 1) * 10 })
      .eq('id', row.id)
    if (error) return { error: 'That change could not be saved.' }
  }

  revalidateManage()
  return { notice: `Moved “${moved.name}” ${direction === -1 ? 'earlier' : 'later'}.` }
}
