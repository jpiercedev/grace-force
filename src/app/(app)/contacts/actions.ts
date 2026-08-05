'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { MANUAL_ACTIVITY_TYPES } from '@/components/domain/contact-badges'
import { requireAdmin, requireWriteAccess } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import {
  contactFormSchema,
  optionalDate,
  optionalText,
  optionalUuid,
  requiredDate,
  requiredText,
  toFieldErrors,
  type ContactActionState,
} from '@/lib/validation/contact'

const CONTACT_FORM_FIELDS = [
  'first_name',
  'last_name',
  'preferred_name',
  'email',
  'secondary_email',
  'phone',
  'mobile_phone',
  'address_line1',
  'address_line2',
  'city',
  'region',
  'postal_code',
  'country',
  'organization_name',
  'job_title',
  'lifecycle_stage',
  'status',
  'source',
  'source_detail',
  'owner_id',
  'do_not_contact',
  'do_not_email',
  'birthday',
  'tags',
  'notes',
] as const

const DATETIME_LOCAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/

function text(formData: FormData, key: string): string | null {
  const value = formData.get(key)
  return typeof value === 'string' ? value : null
}

function uuidField(message: string) {
  return z
    .string({ required_error: message, invalid_type_error: message })
    .trim()
    .uuid(message)
}

function invalid(error: z.ZodError): ContactActionState {
  return { error: 'Check the highlighted fields and try again.', fieldErrors: toFieldErrors(error) }
}

/**
 * Turns a driver error into something a person can act on. The codes matter:
 * 23505 is the one-live-engagement-per-type index, and 42501 is Row Level
 * Security refusing the write — both are expected outcomes, not crashes.
 */
function writeFailed(error: { code?: string; message: string }, fallback: string): string {
  if (error.code === '42501') return 'You do not have permission to make that change.'
  if (error.code === '23514') return 'That combination of values is not allowed.'
  return fallback
}

function isUniqueViolation(error: { code?: string }): boolean {
  return error.code === '23505'
}

/**
 * `datetime-local` submits wall-clock time with no zone. Reading it as UTC and
 * re-adding the browser's own offset recovers the instant the person meant,
 * instead of silently reinterpreting it in whatever zone the server runs in.
 */
function localDateTimeToIso(value: string, offsetMinutes: number): string | null {
  if (!DATETIME_LOCAL.test(value)) return null
  const withSeconds = value.length === 16 ? `${value}:00` : value
  const asUtc = Date.parse(`${withSeconds}Z`)
  if (Number.isNaN(asUtc)) return null
  return new Date(asUtc + offsetMinutes * 60_000).toISOString()
}

function timezoneOffset(formData: FormData): number {
  const parsed = Number.parseInt(text(formData, 'tz_offset') ?? '', 10)
  return Number.isFinite(parsed) && Math.abs(parsed) <= 900 ? parsed : 0
}

function today(): string {
  return new Date().toISOString().slice(0, 10)
}

// --- Contacts ---------------------------------------------------------------

function readContactForm(formData: FormData): Record<string, string | null> {
  const values: Record<string, string | null> = {}
  for (const field of CONTACT_FORM_FIELDS) values[field] = text(formData, field)
  return values
}

export async function createContact(
  _prev: ContactActionState,
  formData: FormData,
): Promise<ContactActionState> {
  const profile = await requireWriteAccess()
  const parsed = contactFormSchema.safeParse(readContactForm(formData))
  if (!parsed.success) return invalid(parsed.error)

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('contacts')
    .insert({ ...parsed.data, created_by: profile.id, updated_by: profile.id })
    .select('id')
    .single()

  if (error || !data) {
    return { error: writeFailed(error ?? { message: '' }, 'Could not save that contact.') }
  }

  revalidatePath('/contacts')
  redirect(`/contacts/${data.id}`)
}

export async function updateContact(
  _prev: ContactActionState,
  formData: FormData,
): Promise<ContactActionState> {
  const profile = await requireWriteAccess()
  const id = uuidField('Missing contact').safeParse(text(formData, 'id'))
  if (!id.success) return { error: 'That contact could not be found.' }

  const parsed = contactFormSchema.safeParse(readContactForm(formData))
  if (!parsed.success) return invalid(parsed.error)

  const supabase = await createClient()
  const { error } = await supabase
    .from('contacts')
    .update({ ...parsed.data, updated_by: profile.id })
    .eq('id', id.data)
    .is('deleted_at', null)

  if (error) return { error: writeFailed(error, 'Could not save those changes.') }

  revalidatePath('/contacts')
  revalidatePath(`/contacts/${id.data}`)
  redirect(`/contacts/${id.data}`)
}

const reassignSchema = z.object({
  contact_id: uuidField('Missing contact'),
  owner_id: optionalUuid('Choose a team member from the list'),
})

export async function reassignContactOwner(
  _prev: ContactActionState,
  formData: FormData,
): Promise<ContactActionState> {
  const profile = await requireWriteAccess()
  const parsed = reassignSchema.safeParse({
    contact_id: text(formData, 'contact_id'),
    owner_id: text(formData, 'owner_id'),
  })
  if (!parsed.success) return invalid(parsed.error)

  const supabase = await createClient()
  // The `assignment_changed` timeline entry is written by a database trigger;
  // writing one here as well would post the change twice.
  const { error } = await supabase
    .from('contacts')
    .update({ owner_id: parsed.data.owner_id, updated_by: profile.id })
    .eq('id', parsed.data.contact_id)
    .is('deleted_at', null)

  if (error) return { error: writeFailed(error, 'Could not reassign this contact.') }

  revalidatePath('/contacts')
  revalidatePath(`/contacts/${parsed.data.contact_id}`)
  return { ok: true }
}

export async function archiveContact(
  _prev: ContactActionState,
  formData: FormData,
): Promise<ContactActionState> {
  const profile = await requireAdmin()
  const id = uuidField('Missing contact').safeParse(text(formData, 'contact_id'))
  if (!id.success) return { error: 'That contact could not be found.' }

  const supabase = await createClient()
  // Soft delete: history, gifts and timeline stay intact and the record can be
  // restored, which a hard delete would make impossible.
  const { error } = await supabase
    .from('contacts')
    .update({ deleted_at: new Date().toISOString(), updated_by: profile.id })
    .eq('id', id.data)
    .is('deleted_at', null)

  if (error) return { error: writeFailed(error, 'Could not archive this contact.') }

  revalidatePath('/contacts')
  revalidatePath(`/contacts/${id.data}`)
  redirect('/contacts?archived=1')
}

// --- Timeline ---------------------------------------------------------------

const activitySchema = z.object({
  contact_id: uuidField('Missing contact'),
  type: z.enum(MANUAL_ACTIVITY_TYPES, { required_error: 'Choose an activity type' }),
  direction: z.enum(['inbound', 'outbound', 'internal'] as const),
  subject: optionalText(200),
  body: optionalText(4000),
})

export async function logActivity(
  _prev: ContactActionState,
  formData: FormData,
): Promise<ContactActionState> {
  const profile = await requireWriteAccess()
  const parsed = activitySchema.safeParse({
    contact_id: text(formData, 'contact_id'),
    type: text(formData, 'type'),
    direction: text(formData, 'direction'),
    subject: text(formData, 'subject'),
    body: text(formData, 'body'),
  })
  if (!parsed.success) return invalid(parsed.error)

  if (!parsed.data.subject && !parsed.data.body) {
    return {
      error: 'Add a summary or some detail.',
      fieldErrors: { subject: 'Give this entry a summary, or write something in the detail box' },
    }
  }

  const occurredAtRaw = text(formData, 'occurred_at')
  const occurredAt = occurredAtRaw
    ? localDateTimeToIso(occurredAtRaw, timezoneOffset(formData))
    : new Date().toISOString()
  if (!occurredAt) {
    return { error: 'Check the date and time.', fieldErrors: { occurred_at: 'Enter a valid date and time' } }
  }

  const supabase = await createClient()
  const { error } = await supabase.from('activities').insert({
    contact_id: parsed.data.contact_id,
    type: parsed.data.type,
    direction: parsed.data.direction,
    // Hand-logged entries carry no dedupe_key: they are allowed to repeat,
    // and a key would make a second identical note silently fail.
    source: 'manual',
    subject: parsed.data.subject,
    body: parsed.data.body,
    occurred_at: occurredAt,
    actor_id: profile.id,
  })

  if (error) return { error: writeFailed(error, 'Could not save that entry.') }

  revalidatePath(`/contacts/${parsed.data.contact_id}`)
  return { ok: true }
}

// --- Engagements ------------------------------------------------------------

const ENGAGEMENT_STATUSES = ['prospect', 'active', 'paused', 'lapsed', 'ended'] as const

const engagementSchema = z.object({
  contact_id: uuidField('Missing contact'),
  engagement_type_id: uuidField('Choose an engagement type'),
  status: z.enum(ENGAGEMENT_STATUSES, { required_error: 'Choose a status' }),
  role_detail: optionalText(120),
  owner_id: optionalUuid('Choose a team member from the list'),
  started_on: requiredDate('Choose a start date'),
  ended_on: optionalDate(),
  notes: optionalText(2000),
})

type EngagementValues = z.infer<typeof engagementSchema>

function readEngagementForm(formData: FormData) {
  return engagementSchema.safeParse({
    contact_id: text(formData, 'contact_id'),
    engagement_type_id: text(formData, 'engagement_type_id'),
    status: text(formData, 'status'),
    role_detail: text(formData, 'role_detail'),
    owner_id: text(formData, 'owner_id'),
    started_on: text(formData, 'started_on'),
    ended_on: text(formData, 'ended_on'),
    notes: text(formData, 'notes'),
  })
}

/**
 * `engagements_ended_consistency` pairs the two fields: ended means a date is
 * present, anything else means it is absent. Reconciling them here keeps a
 * mismatched form from arriving at the database as a 500.
 */
function reconcileEndDate(values: EngagementValues): { ended_on: string | null; error?: string } {
  if (values.status !== 'ended') return { ended_on: null }
  const endedOn = values.ended_on ?? today()
  if (endedOn < values.started_on) {
    return { ended_on: endedOn, error: 'The end date cannot be before the start date' }
  }
  return { ended_on: endedOn }
}

const DUPLICATE_ENGAGEMENT =
  'This contact already has a live engagement of that type. End the existing one first.'

export async function addEngagement(
  _prev: ContactActionState,
  formData: FormData,
): Promise<ContactActionState> {
  const profile = await requireWriteAccess()
  const parsed = readEngagementForm(formData)
  if (!parsed.success) return invalid(parsed.error)

  const ended = reconcileEndDate(parsed.data)
  if (ended.error) return { error: ended.error, fieldErrors: { ended_on: ended.error } }

  const supabase = await createClient()
  // No activity row here: `engagements_log_activity` already writes
  // `engagement_started` on insert.
  const { error } = await supabase.from('engagements').insert({
    contact_id: parsed.data.contact_id,
    engagement_type_id: parsed.data.engagement_type_id,
    status: parsed.data.status,
    role_detail: parsed.data.role_detail,
    owner_id: parsed.data.owner_id,
    started_on: parsed.data.started_on,
    ended_on: ended.ended_on,
    notes: parsed.data.notes,
    created_by: profile.id,
  })

  if (error) {
    if (isUniqueViolation(error)) {
      return {
        error: DUPLICATE_ENGAGEMENT,
        fieldErrors: { engagement_type_id: DUPLICATE_ENGAGEMENT },
      }
    }
    return { error: writeFailed(error, 'Could not add that engagement.') }
  }

  revalidatePath('/contacts')
  revalidatePath(`/contacts/${parsed.data.contact_id}`)
  return { ok: true }
}

export async function updateEngagement(
  _prev: ContactActionState,
  formData: FormData,
): Promise<ContactActionState> {
  await requireWriteAccess()
  const engagementId = uuidField('Missing engagement').safeParse(text(formData, 'engagement_id'))
  if (!engagementId.success) return { error: 'That engagement could not be found.' }

  const parsed = readEngagementForm(formData)
  if (!parsed.success) return invalid(parsed.error)

  const ended = reconcileEndDate(parsed.data)
  if (ended.error) return { error: ended.error, fieldErrors: { ended_on: ended.error } }

  const supabase = await createClient()
  const { error } = await supabase
    .from('engagements')
    .update({
      engagement_type_id: parsed.data.engagement_type_id,
      status: parsed.data.status,
      role_detail: parsed.data.role_detail,
      owner_id: parsed.data.owner_id,
      started_on: parsed.data.started_on,
      ended_on: ended.ended_on,
      notes: parsed.data.notes,
    })
    .eq('id', engagementId.data)

  if (error) {
    if (isUniqueViolation(error)) {
      return {
        error: DUPLICATE_ENGAGEMENT,
        fieldErrors: { engagement_type_id: DUPLICATE_ENGAGEMENT },
      }
    }
    return { error: writeFailed(error, 'Could not save those changes.') }
  }

  revalidatePath('/contacts')
  revalidatePath(`/contacts/${parsed.data.contact_id}`)
  return { ok: true }
}

const endEngagementSchema = z.object({
  contact_id: uuidField('Missing contact'),
  engagement_id: uuidField('Missing engagement'),
  ended_on: requiredDate('Choose an end date'),
})

export async function endEngagement(
  _prev: ContactActionState,
  formData: FormData,
): Promise<ContactActionState> {
  await requireWriteAccess()
  const parsed = endEngagementSchema.safeParse({
    contact_id: text(formData, 'contact_id'),
    engagement_id: text(formData, 'engagement_id'),
    ended_on: text(formData, 'ended_on'),
  })
  if (!parsed.success) return invalid(parsed.error)

  const supabase = await createClient()
  // Status and end date must move together or the check constraint rejects it.
  const { error } = await supabase
    .from('engagements')
    .update({ status: 'ended', ended_on: parsed.data.ended_on })
    .eq('id', parsed.data.engagement_id)

  if (error) {
    if (error.code === '23514') {
      return {
        error: 'The end date cannot be before the start date.',
        fieldErrors: { ended_on: 'The end date cannot be before the start date' },
      }
    }
    return { error: writeFailed(error, 'Could not end that engagement.') }
  }

  revalidatePath('/contacts')
  revalidatePath(`/contacts/${parsed.data.contact_id}`)
  return { ok: true }
}

// --- Follow-ups -------------------------------------------------------------

const followUpSchema = z.object({
  contact_id: uuidField('Missing contact'),
  title: requiredText(160, 'Say what needs doing'),
  details: optionalText(2000),
  priority: z.enum(['low', 'normal', 'high', 'urgent'] as const),
  assigned_to: optionalUuid('Choose a team member from the list'),
})

export async function createFollowUp(
  _prev: ContactActionState,
  formData: FormData,
): Promise<ContactActionState> {
  const profile = await requireWriteAccess()
  const parsed = followUpSchema.safeParse({
    contact_id: text(formData, 'contact_id'),
    title: text(formData, 'title'),
    details: text(formData, 'details'),
    priority: text(formData, 'priority'),
    assigned_to: text(formData, 'assigned_to'),
  })
  if (!parsed.success) return invalid(parsed.error)

  const dueAt = localDateTimeToIso(text(formData, 'due_at') ?? '', timezoneOffset(formData))
  if (!dueAt) {
    return { error: 'Check the due date.', fieldErrors: { due_at: 'Choose when this is due' } }
  }

  const supabase = await createClient()
  // `follow_ups_completion_consistency` requires completed_at to stay null
  // while the status is open, so neither field is set here.
  const { error } = await supabase.from('follow_ups').insert({
    contact_id: parsed.data.contact_id,
    title: parsed.data.title,
    details: parsed.data.details,
    due_at: dueAt,
    priority: parsed.data.priority,
    status: 'open',
    assigned_to: parsed.data.assigned_to ?? profile.id,
    created_by: profile.id,
  })

  if (error) return { error: writeFailed(error, 'Could not add that follow-up.') }

  revalidatePath('/follow-ups')
  revalidatePath(`/contacts/${parsed.data.contact_id}`)
  return { ok: true }
}
