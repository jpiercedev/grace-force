'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { requireAdmin, requireWriteAccess } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import type { ContactActionState } from '@/lib/validation/contact'
import { callReportSchema } from '@/lib/validation/development'
import { invalid, text, textList, writeFailed } from '@/lib/validation/form-data'

/**
 * Call reports — the written record of a donor meeting.
 *
 * Filing is what posts the report to the donor's timeline, and the trigger on
 * `call_reports` does that; nothing here writes an activity. Saving a draft
 * writes nothing to the timeline at all, which is the point of a draft.
 *
 * The two form buttons ("Save draft" / "File report") submit to two separate
 * actions rather than one action reading an `intent` field, because a submit
 * button's `name`/`value` does not survive a real-browser server-action POST.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function readForm(formData: FormData) {
  return callReportSchema.safeParse({
    contact_id: text(formData, 'contact_id'),
    proposal_id: text(formData, 'proposal_id'),
    met_on: text(formData, 'met_on'),
    met_at_time: text(formData, 'met_at_time'),
    meeting_kind: text(formData, 'meeting_kind'),
    location: text(formData, 'location'),
    external_attendees: text(formData, 'external_attendees'),
    summary: text(formData, 'summary'),
    discussion_points: text(formData, 'discussion_points'),
    interests_expressed: text(formData, 'interests_expressed'),
    concerns: text(formData, 'concerns'),
    commitments: text(formData, 'commitments'),
    next_steps: text(formData, 'next_steps'),
    follow_up_on: text(formData, 'follow_up_on'),
  })
}

function staffAttendees(formData: FormData): string[] {
  return textList(formData, 'staff_attendee_ids').filter((value) => UUID.test(value))
}

async function save(
  formData: FormData,
  status: 'draft' | 'filed',
): Promise<ContactActionState> {
  const profile = await requireWriteAccess()
  const parsed = readForm(formData)
  if (!parsed.success) return invalid(parsed.error)

  const values = parsed.data

  // A filed report with nothing written in it is not a record of anything.
  if (status === 'filed' && !values.summary && !values.discussion_points) {
    return {
      error: 'Write a summary before filing this report.',
      fieldErrors: { summary: 'Say what happened, even briefly' },
    }
  }

  const id = text(formData, 'report_id')
  const supabase = await createClient()

  // `call_reports_filed_consistency` pairs status with filed_at in both
  // directions; reconciling it here keeps the constraint from surfacing as a
  // 500 on an otherwise valid form.
  const payload = {
    contact_id: values.contact_id,
    proposal_id: values.proposal_id,
    status,
    met_on: values.met_on,
    met_at_time: values.met_at_time,
    meeting_kind: values.meeting_kind as never,
    location: values.location,
    author_id: profile.id,
    staff_attendee_ids: staffAttendees(formData),
    external_attendees: values.external_attendees,
    summary: values.summary,
    discussion_points: values.discussion_points,
    interests_expressed: values.interests_expressed,
    concerns: values.concerns,
    commitments: values.commitments,
    next_steps: values.next_steps,
    follow_up_on: values.follow_up_on,
    filed_at: status === 'filed' ? new Date().toISOString() : null,
  }

  let reportId = id
  if (id) {
    // filed_at is preserved on an already-filed report so re-editing does not
    // rewrite when it was filed.
    const { data: existing } = await supabase
      .from('call_reports')
      .select('filed_at, status')
      .eq('id', id)
      .maybeSingle()
    const { error } = await supabase
      .from('call_reports')
      .update({
        ...payload,
        filed_at:
          status === 'filed' ? (existing?.filed_at ?? payload.filed_at) : null,
      })
      .eq('id', id)
    if (error) return { error: writeFailed(error, 'Could not save that report.') }
  } else {
    const { data, error } = await supabase
      .from('call_reports')
      .insert(payload)
      .select('id')
      .single()
    if (error) return { error: writeFailed(error, 'Could not save that report.') }
    reportId = data.id
  }

  // The follow-up the report asked for. Created once — a report that already
  // produced one keeps it rather than making a second on every save.
  if (values.follow_up_on && reportId) {
    const { data: report } = await supabase
      .from('call_reports')
      .select('follow_up_id')
      .eq('id', reportId)
      .maybeSingle()

    if (!report?.follow_up_id) {
      const { data: followUp } = await supabase
        .from('follow_ups')
        .insert({
          contact_id: values.contact_id,
          title: values.next_steps?.split('\n')[0]?.slice(0, 160) || 'Follow up after our meeting',
          details: values.next_steps,
          due_at: `${values.follow_up_on}T12:00:00Z`,
          status: 'open',
          assigned_to: profile.id,
          created_by: profile.id,
        })
        .select('id')
        .single()

      if (followUp) {
        await supabase
          .from('call_reports')
          .update({ follow_up_id: followUp.id })
          .eq('id', reportId)
        revalidatePath('/follow-ups')
      }
    }
  }

  revalidatePath('/reports')
  revalidatePath(`/contacts/${values.contact_id}`)
  if (reportId) revalidatePath(`/reports/${reportId}`)

  if (!id && reportId) redirect(`/reports/${reportId}`)
  return { ok: true }
}

export async function saveCallReportDraft(
  _prev: ContactActionState,
  formData: FormData,
): Promise<ContactActionState> {
  return save(formData, 'draft')
}

export async function fileCallReport(
  _prev: ContactActionState,
  formData: FormData,
): Promise<ContactActionState> {
  return save(formData, 'filed')
}

export async function deleteCallReport(
  _prev: ContactActionState,
  formData: FormData,
): Promise<ContactActionState> {
  await requireAdmin()
  const id = text(formData, 'report_id')
  if (!id) return { error: 'Missing report.' }

  const supabase = await createClient()
  const { data: existing } = await supabase
    .from('call_reports')
    .select('contact_id')
    .eq('id', id)
    .maybeSingle()

  const { error } = await supabase.from('call_reports').delete().eq('id', id)
  if (error) return { error: writeFailed(error, 'Could not delete that report.') }

  revalidatePath('/reports')
  if (existing) revalidatePath(`/contacts/${existing.contact_id}`)
  redirect('/reports')
}
