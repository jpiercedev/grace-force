'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { canWrite, requireProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { formatDateTime, truncate } from '@/lib/utils'
import {
  completeFollowUpSchema,
  createFollowUpSchema,
  fieldErrorsFrom,
  followUpIdSchema,
  parseIntent,
  reassignFollowUpSchema,
  snoozeIntervalFor,
  snoozeTimestamps,
} from '@/lib/validation/follow-up'
import type { FollowUpRow } from '@/types/database'

/**
 * Follow-up mutations.
 *
 * `follow_up_created` and `follow_up_completed` timeline entries are written by
 * database triggers, so nothing here touches `activities` — doing so would
 * post every event twice.
 */

export interface FollowUpActionState {
  error?: string
  fieldErrors?: Record<string, string>
  notice?: string
}

const NO_PERMISSION = 'You do not have permission to change follow-ups.'

/**
 * Row Level Security lets staff update only follow-ups that are theirs, so an
 * update can legitimately match zero rows. That reads as success to PostgREST;
 * we surface it as the refusal it is.
 */
const NOT_YOURS =
  'That follow-up could not be updated — it may belong to another team member.'

function text(formData: FormData, name: string): string {
  const value = formData.get(name)
  return typeof value === 'string' ? value : ''
}

/** Only relative in-app paths, so a form field cannot become an open redirect. */
function safeRedirect(value: string): string | null {
  return value.startsWith('/') && !value.startsWith('//') ? value : null
}

function revalidateFollowUp(contactId: string | null): void {
  revalidatePath('/follow-ups')
  revalidatePath('/dashboard')
  if (contactId) revalidatePath(`/contacts/${contactId}`)
}

/**
 * Creates a follow-up. Exported for reuse from a contact page: pass the
 * contact as a hidden `contact_id` field and, optionally, `redirect_to` to
 * send the user somewhere specific afterwards.
 */
export async function createFollowUp(
  _prev: FollowUpActionState,
  formData: FormData,
): Promise<FollowUpActionState> {
  const profile = await requireProfile()
  if (!canWrite(profile)) return { error: NO_PERMISSION }

  const parsed = createFollowUpSchema.safeParse({
    contact_id: text(formData, 'contact_id'),
    title: text(formData, 'title'),
    details: text(formData, 'details'),
    due_at: text(formData, 'due_at'),
    remind_at: text(formData, 'remind_at'),
    priority: text(formData, 'priority'),
    // An absent field means "no opinion", so it falls to the current user; an
    // empty one is a deliberate "leave it unassigned".
    assigned_to: formData.has('assigned_to') ? text(formData, 'assigned_to') : profile.id,
    engagement_id: text(formData, 'engagement_id'),
    pipeline_card_id: text(formData, 'pipeline_card_id'),
  })

  if (!parsed.success) {
    return { error: 'Check the highlighted fields.', fieldErrors: fieldErrorsFrom(parsed.error) }
  }

  const supabase = await createClient()
  const { error } = await supabase.from('follow_ups').insert({
    contact_id: parsed.data.contact_id,
    title: parsed.data.title,
    details: parsed.data.details,
    due_at: parsed.data.due_at,
    // Left null so the database trigger mirrors it from due_at.
    remind_at: parsed.data.remind_at,
    priority: parsed.data.priority,
    assigned_to: parsed.data.assigned_to,
    engagement_id: parsed.data.engagement_id,
    pipeline_card_id: parsed.data.pipeline_card_id,
    created_by: profile.id,
  })

  if (error) {
    return { error: 'That follow-up could not be saved. Check the details and try again.' }
  }

  revalidateFollowUp(parsed.data.contact_id)

  const destination = safeRedirect(text(formData, 'redirect_to'))
  if (destination) redirect(destination)

  return { notice: 'Follow-up scheduled.' }
}

/**
 * Complete, snooze, reassign or cancel — dispatched on the submit button's
 * `intent` so a queue row needs only one form.
 *
 * The notices name the follow-up because the queue reads them out: by the time
 * one is shown, the row it refers to has usually left the segment on screen.
 */
export async function updateFollowUp(
  _prev: FollowUpActionState,
  formData: FormData,
): Promise<FollowUpActionState> {
  const profile = await requireProfile()
  if (!canWrite(profile)) return { error: NO_PERMISSION }

  const intent = parseIntent(text(formData, 'intent'))
  if (!intent) return { error: 'That action is not available.' }

  const identified = followUpIdSchema.safeParse({ id: text(formData, 'id') })
  if (!identified.success) return { error: 'That follow-up could not be found.' }

  const supabase = await createClient()
  const { data: existing, error: lookupError } = await supabase
    .from('follow_ups')
    .select('id, contact_id, title, due_at, remind_at, status')
    .eq('id', identified.data.id)
    .maybeSingle()

  if (lookupError) return { error: 'That follow-up could not be loaded.' }
  if (!existing) return { error: 'That follow-up could not be found.' }
  if (existing.status !== 'open') {
    return { error: 'That follow-up is already closed.' }
  }

  // The queue announces this to anyone who cannot see the row change, so it
  // names the follow-up rather than saying "done".
  const subject = `“${truncate(existing.title, 60)}”`
  const snoozeInterval = snoozeIntervalFor(intent)

  if (snoozeInterval) {
    const next = snoozeTimestamps(existing, snoozeInterval)
    return applyUpdate(
      existing.id,
      existing.contact_id,
      next,
      `Snoozed ${subject} to ${formatDateTime(next.due_at)}.`,
    )
  }

  if (intent === 'complete') {
    const parsed = completeFollowUpSchema.safeParse({
      id: identified.data.id,
      outcome_note: text(formData, 'outcome_note'),
    })
    if (!parsed.success) {
      return { error: 'Check the highlighted fields.', fieldErrors: fieldErrorsFrom(parsed.error) }
    }
    // status / completed_at / completed_by move together — a check constraint
    // rejects the row otherwise, and it would be a 500 rather than a message.
    return applyUpdate(
      existing.id,
      existing.contact_id,
      {
        status: 'completed' as const,
        completed_at: new Date().toISOString(),
        completed_by: profile.id,
        outcome_note: parsed.data.outcome_note,
      },
      `Completed ${subject}.`,
    )
  }

  if (intent === 'reassign') {
    const parsed = reassignFollowUpSchema.safeParse({
      id: identified.data.id,
      assigned_to: text(formData, 'assigned_to'),
    })
    if (!parsed.success) {
      return { error: 'Check the highlighted fields.', fieldErrors: fieldErrorsFrom(parsed.error) }
    }
    return applyUpdate(
      existing.id,
      existing.contact_id,
      { assigned_to: parsed.data.assigned_to },
      parsed.data.assigned_to ? `Reassigned ${subject}.` : `${subject} is now unassigned.`,
    )
  }

  return applyUpdate(
    existing.id,
    existing.contact_id,
    { status: 'cancelled' as const },
    `Cancelled ${subject}.`,
  )
}

async function applyUpdate(
  id: string,
  contactId: string,
  patch: Partial<FollowUpRow>,
  notice: string,
): Promise<FollowUpActionState> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('follow_ups')
    .update(patch)
    .eq('id', id)
    .select('id')
    .maybeSingle()

  if (error) return { error: 'That change could not be saved.' }
  if (!data) return { error: NOT_YOURS }

  revalidateFollowUp(contactId)
  return { notice }
}
