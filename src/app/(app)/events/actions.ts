'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { requireAdmin, requireWriteAccess } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import type { ContactActionState } from '@/lib/validation/contact'
import { attendeeSchema, eventSchema } from '@/lib/validation/development'
import { invalid, text, uuidField, writeFailed } from '@/lib/validation/form-data'

/**
 * Events and attendance.
 *
 * The `event_attended` timeline entry is written by a database trigger when a
 * record becomes `attended` — application code must not also insert it, or
 * every attendance double-posts.
 */

function readEventForm(formData: FormData) {
  return eventSchema.safeParse({
    name: text(formData, 'name'),
    kind: text(formData, 'kind'),
    event_date: text(formData, 'event_date'),
    start_time: text(formData, 'start_time'),
    location: text(formData, 'location'),
    description: text(formData, 'description'),
    owner_id: text(formData, 'owner_id'),
  })
}

export async function createEvent(
  _prev: ContactActionState,
  formData: FormData,
): Promise<ContactActionState> {
  const profile = await requireWriteAccess()
  const parsed = readEventForm(formData)
  if (!parsed.success) return invalid(parsed.error)

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('events')
    .insert({
      name: parsed.data.name,
      kind: parsed.data.kind as never,
      event_date: parsed.data.event_date,
      start_time: parsed.data.start_time,
      location: parsed.data.location,
      description: parsed.data.description,
      owner_id: parsed.data.owner_id ?? profile.id,
      created_by: profile.id,
    })
    .select('id')
    .single()

  if (error) return { error: writeFailed(error, 'Could not create that event.') }

  revalidatePath('/events')
  redirect(`/events/${data.id}`)
}

export async function updateEvent(
  _prev: ContactActionState,
  formData: FormData,
): Promise<ContactActionState> {
  await requireWriteAccess()
  const id = text(formData, 'event_id')
  if (!id) return { error: 'Missing event.' }

  const parsed = readEventForm(formData)
  if (!parsed.success) return invalid(parsed.error)

  const supabase = await createClient()
  const { error } = await supabase
    .from('events')
    .update({
      name: parsed.data.name,
      kind: parsed.data.kind as never,
      event_date: parsed.data.event_date,
      start_time: parsed.data.start_time,
      location: parsed.data.location,
      description: parsed.data.description,
      owner_id: parsed.data.owner_id,
    })
    .eq('id', id)

  if (error) return { error: writeFailed(error, 'Could not save that event.') }

  revalidatePath('/events')
  revalidatePath(`/events/${id}`)
  return { ok: true }
}

export async function deleteEvent(
  _prev: ContactActionState,
  formData: FormData,
): Promise<ContactActionState> {
  await requireAdmin()
  const id = text(formData, 'event_id')
  if (!id) return { error: 'Missing event.' }

  const supabase = await createClient()
  const { error } = await supabase.from('events').delete().eq('id', id)
  if (error) return { error: writeFailed(error, 'Could not delete that event.') }

  revalidatePath('/events')
  redirect('/events')
}

// --- Attendance --------------------------------------------------------------

/**
 * Adding someone and recording that they came are the same action, because
 * they are the same moment: staff open this screen after the event, not
 * before. `upsert` means adding a person who is already on the list updates
 * their record instead of failing on the uniqueness index.
 */
export async function saveAttendee(
  _prev: ContactActionState,
  formData: FormData,
): Promise<ContactActionState> {
  const profile = await requireWriteAccess()
  const parsed = attendeeSchema.safeParse({
    event_id: text(formData, 'event_id'),
    contact_id: text(formData, 'contact_id'),
    status: text(formData, 'status'),
    note: text(formData, 'note'),
  })
  if (!parsed.success) return invalid(parsed.error)

  const supabase = await createClient()
  const { error } = await supabase.from('event_attendees').upsert(
    {
      event_id: parsed.data.event_id,
      contact_id: parsed.data.contact_id,
      status: parsed.data.status as never,
      note: parsed.data.note,
      created_by: profile.id,
    },
    { onConflict: 'event_id,contact_id' },
  )

  if (error) return { error: writeFailed(error, 'Could not record that.') }

  revalidatePath(`/events/${parsed.data.event_id}`)
  revalidatePath(`/contacts/${parsed.data.contact_id}`)
  return { ok: true }
}

const removeAttendeeSchema = z.object({
  attendee_id: uuidField('Missing attendee'),
  event_id: uuidField('Missing event'),
})

export async function removeAttendee(
  _prev: ContactActionState,
  formData: FormData,
): Promise<ContactActionState> {
  await requireWriteAccess()
  const parsed = removeAttendeeSchema.safeParse({
    attendee_id: text(formData, 'attendee_id'),
    event_id: text(formData, 'event_id'),
  })
  if (!parsed.success) return invalid(parsed.error)

  const supabase = await createClient()
  const { data: existing } = await supabase
    .from('event_attendees')
    .select('contact_id')
    .eq('id', parsed.data.attendee_id)
    .maybeSingle()

  const { error } = await supabase
    .from('event_attendees')
    .delete()
    .eq('id', parsed.data.attendee_id)
  if (error) return { error: writeFailed(error, 'Could not remove that person.') }

  revalidatePath(`/events/${parsed.data.event_id}`)
  if (existing) revalidatePath(`/contacts/${existing.contact_id}`)
  return { ok: true }
}
