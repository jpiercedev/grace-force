'use server'

import { revalidatePath } from 'next/cache'
import { requireWriteAccess } from '@/lib/auth'
import { findInteractionKind } from '@/lib/interactions'
import { getRelatedPeople, relationshipExists } from '@/lib/queries/relationships'
import { parseRelationshipKind } from '@/lib/relationships'
import { createClient } from '@/lib/supabase/server'
import { ATTACHMENTS_BUCKET } from '@/lib/queries/attachments'
import { rejectionReason, storagePathFor } from '@/lib/attachments'
import { pluralize } from '@/lib/utils'
import type { ContactActionState } from '@/lib/validation/contact'
import {
  capabilitySchema,
  interactionSchema,
  interestSchema,
  preferencesSchema,
  relationshipSchema,
} from '@/lib/validation/development'
import {
  invalid,
  localDateTimeToIso,
  text,
  timezoneOffset,
  today,
  uuidField,
  writeFailed,
} from '@/lib/validation/form-data'
import { canViewGiving } from '@/lib/permissions'
import type { ContactMethod } from '@/types/database'
import { z } from 'zod'

/**
 * Everything a person does *on* a donor record: log what happened, link a
 * relative, record an interest, set preferences, note capability, attach a
 * file.
 *
 * These are separate from `contacts/actions.ts` (which owns the contact row
 * itself) because they are the workflow surface — the actions a development
 * officer performs many times a day, as opposed to editing the record.
 */

function contactPath(contactId: string): string {
  return `/contacts/${contactId}`
}

// --- Logging an interaction --------------------------------------------------

/**
 * The five-control workflow from the brief: open donor → say what happened →
 * write a note → optionally set a follow-up → save.
 *
 * The `(type, direction)` pair the timeline stores is derived from the plain
 * language choice, so nobody has to classify a phone call before writing down
 * what was said. The follow-up, when asked for, is a second insert — the
 * `follow_up_created` timeline entry comes from the database trigger, not
 * from here, or every follow-up would post twice.
 */
export async function logInteraction(
  _prev: ContactActionState,
  formData: FormData,
): Promise<ContactActionState> {
  const profile = await requireWriteAccess()
  const parsed = interactionSchema.safeParse({
    contact_id: text(formData, 'contact_id'),
    kind: text(formData, 'kind'),
    received: formData.get('received'),
    note: text(formData, 'note'),
    outcome: text(formData, 'outcome'),
    proposal_id: text(formData, 'proposal_id'),
    follow_up_on: text(formData, 'follow_up_on'),
    follow_up_note: text(formData, 'follow_up_note'),
  })
  if (!parsed.success) return invalid(parsed.error)

  const values = parsed.data
  const kind = findInteractionKind(values.kind)
  if (!kind) return { error: 'Choose what happened.', fieldErrors: { kind: 'Choose one' } }

  if (!values.note && !values.outcome) {
    return {
      error: 'Add a note so there is something to read later.',
      fieldErrors: { note: 'Write what happened, even if it is one line' },
    }
  }

  const occurredAtRaw = text(formData, 'occurred_at')
  const occurredAt = occurredAtRaw
    ? localDateTimeToIso(occurredAtRaw, timezoneOffset(formData))
    : new Date().toISOString()
  if (!occurredAt) {
    return {
      error: 'Check the date and time.',
      fieldErrors: { occurred_at: 'Enter a valid date and time' },
    }
  }

  // Direction is only asked for the two kinds that genuinely go both ways.
  const direction = kind.asksDirection && values.received ? 'inbound' : kind.direction

  const supabase = await createClient()
  const { error } = await supabase.from('activities').insert({
    contact_id: values.contact_id,
    proposal_id: values.proposal_id,
    type: kind.type,
    direction,
    // Hand-logged entries carry no dedupe_key: two calls on the same day are
    // two events, and a key would make the second silently fail.
    source: 'manual',
    subject: kind.headline,
    body: values.note,
    outcome: values.outcome,
    occurred_at: occurredAt,
    actor_id: profile.id,
  })
  if (error) return { error: writeFailed(error, 'Could not save that.') }

  if (values.follow_up_on) {
    const { error: followUpError } = await supabase.from('follow_ups').insert({
      contact_id: values.contact_id,
      title: values.follow_up_note ?? `Follow up on ${kind.label.toLowerCase()}`,
      // Midday local-ish: a follow-up due "on Tuesday" should not fire at
      // midnight UTC and read as Monday to half the team.
      due_at: `${values.follow_up_on}T12:00:00Z`,
      status: 'open',
      assigned_to: profile.id,
      created_by: profile.id,
    })
    if (followUpError) {
      // The interaction is already saved; say so rather than implying it was
      // all lost, so nobody types the note a second time.
      return {
        error: 'The note was saved, but the follow-up could not be created. Add it from Follow-ups.',
      }
    }
    revalidatePath('/follow-ups')
  }

  revalidatePath(contactPath(values.contact_id))
  return { ok: true }
}

// --- Related constituents ----------------------------------------------------

/**
 * The picker asks "how is this person related to <donor>?", so the answer
 * always describes the *other* person and the row is written with the donor on
 * the `to` side. See `@/lib/relationships` for the direction contract.
 */
export async function addRelationship(
  _prev: ContactActionState,
  formData: FormData,
): Promise<ContactActionState> {
  const profile = await requireWriteAccess()
  const parsed = relationshipSchema.safeParse({
    contact_id: text(formData, 'contact_id'),
    related_contact_id: text(formData, 'related_contact_id'),
    kind: text(formData, 'kind'),
    note: text(formData, 'note'),
  })
  if (!parsed.success) return invalid(parsed.error)

  const kind = parseRelationshipKind(parsed.data.kind)
  if (!kind) {
    return { error: 'Choose how they are related.', fieldErrors: { kind: 'Choose one' } }
  }
  if (parsed.data.related_contact_id === parsed.data.contact_id) {
    return {
      error: 'A person cannot be related to themselves.',
      fieldErrors: { related_contact_id: 'Choose someone else' },
    }
  }

  if (await relationshipExists(parsed.data.related_contact_id, parsed.data.contact_id, kind)) {
    return {
      error: 'These two are already linked that way.',
      fieldErrors: { related_contact_id: 'This link already exists' },
    }
  }

  const supabase = await createClient()
  const { error } = await supabase.from('contact_relationships').insert({
    from_contact_id: parsed.data.related_contact_id,
    to_contact_id: parsed.data.contact_id,
    kind,
    note: parsed.data.note,
    created_by: profile.id,
  })
  if (error) return { error: writeFailed(error, 'Could not link those two.') }

  revalidatePath(contactPath(parsed.data.contact_id))
  revalidatePath(contactPath(parsed.data.related_contact_id))
  return { ok: true }
}

const removeRelationshipSchema = z.object({
  contact_id: uuidField('Missing contact'),
  relationship_id: uuidField('Missing link'),
})

export async function removeRelationship(
  _prev: ContactActionState,
  formData: FormData,
): Promise<ContactActionState> {
  await requireWriteAccess()
  const parsed = removeRelationshipSchema.safeParse({
    contact_id: text(formData, 'contact_id'),
    relationship_id: text(formData, 'relationship_id'),
  })
  if (!parsed.success) return invalid(parsed.error)

  // Read the pair first so the *other* person's page is revalidated too — the
  // link disappears from both sides, so both caches are stale.
  const related = await getRelatedPeople(parsed.data.contact_id)
  const link = related.find((entry) => entry.id === parsed.data.relationship_id)

  const supabase = await createClient()
  const { error } = await supabase
    .from('contact_relationships')
    .delete()
    .eq('id', parsed.data.relationship_id)
  if (error) return { error: writeFailed(error, 'Could not remove that link.') }

  revalidatePath(contactPath(parsed.data.contact_id))
  if (link) revalidatePath(contactPath(link.contact.id))
  return { ok: true }
}

// --- Interests ---------------------------------------------------------------

export async function addInterest(
  _prev: ContactActionState,
  formData: FormData,
): Promise<ContactActionState> {
  const profile = await requireWriteAccess()
  const parsed = interestSchema.safeParse({
    contact_id: text(formData, 'contact_id'),
    interest_area_id: text(formData, 'interest_area_id'),
    note: text(formData, 'note'),
  })
  if (!parsed.success) return invalid(parsed.error)

  const supabase = await createClient()
  // Upsert rather than insert: adding an interest that is already recorded
  // should update the note, not fail on the uniqueness index.
  const { error } = await supabase
    .from('contact_interests')
    .upsert(
      {
        contact_id: parsed.data.contact_id,
        interest_area_id: parsed.data.interest_area_id,
        note: parsed.data.note,
        created_by: profile.id,
      },
      { onConflict: 'contact_id,interest_area_id' },
    )
  if (error) return { error: writeFailed(error, 'Could not save that interest.') }

  revalidatePath(contactPath(parsed.data.contact_id))
  return { ok: true }
}

const removeInterestSchema = z.object({
  contact_id: uuidField('Missing contact'),
  interest_id: uuidField('Missing interest'),
})

export async function removeInterest(
  _prev: ContactActionState,
  formData: FormData,
): Promise<ContactActionState> {
  await requireWriteAccess()
  const parsed = removeInterestSchema.safeParse({
    contact_id: text(formData, 'contact_id'),
    interest_id: text(formData, 'interest_id'),
  })
  if (!parsed.success) return invalid(parsed.error)

  const supabase = await createClient()
  const { error } = await supabase
    .from('contact_interests')
    .delete()
    .eq('id', parsed.data.interest_id)
  if (error) return { error: writeFailed(error, 'Could not remove that interest.') }

  revalidatePath(contactPath(parsed.data.contact_id))
  return { ok: true }
}

// --- Communication preferences ----------------------------------------------

export async function saveContactPreferences(
  _prev: ContactActionState,
  formData: FormData,
): Promise<ContactActionState> {
  const profile = await requireWriteAccess()
  const parsed = preferencesSchema.safeParse({
    contact_id: text(formData, 'contact_id'),
    preferred_contact_method: text(formData, 'preferred_contact_method'),
    preferred_phone: text(formData, 'preferred_phone'),
    preferred_email: text(formData, 'preferred_email'),
    best_time_to_contact: text(formData, 'best_time_to_contact'),
    contact_preference_notes: text(formData, 'contact_preference_notes'),
    do_not_contact: formData.get('do_not_contact'),
    do_not_call: formData.get('do_not_call'),
    do_not_email: formData.get('do_not_email'),
    do_not_text: formData.get('do_not_text'),
    do_not_mail: formData.get('do_not_mail'),
  })
  if (!parsed.success) return invalid(parsed.error)

  const { contact_id: contactId, ...values } = parsed.data

  const supabase = await createClient()
  const { error } = await supabase
    .from('contacts')
    .update({
      ...values,
      // Zod narrows the enum but the empty-string branch widens it back to
      // `string`; the schema is what guarantees the value is a ContactMethod.
      preferred_contact_method: (values.preferred_contact_method ?? null) as ContactMethod | null,
      updated_by: profile.id,
    })
    .eq('id', contactId)
  if (error) return { error: writeFailed(error, 'Could not save those preferences.') }

  revalidatePath(contactPath(contactId))
  return { ok: true }
}

// --- Giving capability -------------------------------------------------------

export async function saveCapability(
  _prev: ContactActionState,
  formData: FormData,
): Promise<ContactActionState> {
  const profile = await requireWriteAccess()
  // RLS would refuse this anyway; checking here turns a driver error into a
  // sentence.
  if (!canViewGiving(profile)) {
    return { error: 'Your account cannot record giving capability.' }
  }

  const parsed = capabilitySchema.safeParse({
    contact_id: text(formData, 'contact_id'),
    level: text(formData, 'level'),
    range_low_cents: text(formData, 'range_low_cents'),
    range_high_cents: text(formData, 'range_high_cents'),
    confidence: text(formData, 'confidence'),
    source: text(formData, 'source'),
    reviewed_on: text(formData, 'reviewed_on'),
    notes: text(formData, 'notes'),
  })
  if (!parsed.success) return invalid(parsed.error)

  const values = parsed.data
  if (
    values.range_low_cents !== null &&
    values.range_high_cents !== null &&
    values.range_low_cents > values.range_high_cents
  ) {
    return {
      error: 'The range runs backwards.',
      fieldErrors: { range_high_cents: 'The top of the range must be at least the bottom' },
    }
  }

  const supabase = await createClient()
  const { error } = await supabase.from('contact_capability').upsert(
    {
      contact_id: values.contact_id,
      level: values.level as never,
      range_low_cents: values.range_low_cents,
      range_high_cents: values.range_high_cents,
      confidence: (values.confidence ?? null) as never,
      source: values.source,
      // Recording an assessment without saying when is how a stale estimate
      // becomes indistinguishable from a fresh one.
      reviewed_on: values.reviewed_on ?? today(),
      notes: values.notes,
      updated_by: profile.id,
    },
    { onConflict: 'contact_id' },
  )
  if (error) return { error: writeFailed(error, 'Could not save that assessment.') }

  revalidatePath(contactPath(values.contact_id))
  return { ok: true }
}

// --- Attachments -------------------------------------------------------------

const attachmentSchema = z.object({
  contact_id: uuidField('Missing contact'),
  call_report_id: z.string().trim().uuid().optional().nullable().or(z.literal('').transform(() => null)),
  proposal_id: z.string().trim().uuid().optional().nullable().or(z.literal('').transform(() => null)),
})

/**
 * Uploads through the server action rather than a signed browser upload.
 *
 * The trade-off is deliberate. A signed-URL flow needs a browser Supabase
 * client, a ticket endpoint and a third round-trip to register the row, and
 * its failure mode is an orphaned object in the bucket that no row points at.
 * Routing the bytes through the action keeps it to one request whose failure
 * mode is "nothing happened" — and the one case where bytes *can* outlive a
 * failure (the metadata insert failing after the object landed) is cleaned up
 * explicitly below.
 *
 * The limits live in `@/lib/attachments` so the browser refuses a file before
 * spending a minute uploading it and the server refuses the same file for the
 * same reason. The total cap is what keeps an accepted batch inside
 * `serverActions.bodySizeLimit`; without it a set of individually-legal files
 * would fail at the framework layer with no usable message.
 */
export async function uploadAttachment(
  _prev: ContactActionState,
  formData: FormData,
): Promise<ContactActionState> {
  const profile = await requireWriteAccess()
  const parsed = attachmentSchema.safeParse({
    contact_id: text(formData, 'contact_id'),
    call_report_id: text(formData, 'call_report_id'),
    proposal_id: text(formData, 'proposal_id'),
  })
  if (!parsed.success) return invalid(parsed.error)

  const files = formData.getAll('files').filter((entry): entry is File => entry instanceof File)
  const present = files.filter((file) => file.size > 0)

  // Authoritative: the browser runs the same check first, but a form can be
  // posted without it.
  const rejection = rejectionReason(present)
  if (rejection) {
    return { error: rejection, fieldErrors: { files: 'Check the files you chose' } }
  }

  const supabase = await createClient()
  const attached: string[] = []

  for (const file of present) {
    const path = storagePathFor(parsed.data.contact_id, file.name, crypto.randomUUID())

    const { error: uploadError } = await supabase.storage
      .from(ATTACHMENTS_BUCKET)
      .upload(path, file, { contentType: file.type || 'application/octet-stream', upsert: false })
    if (uploadError) {
      return { error: partialFailure(attached, file.name, uploadError.message) }
    }

    const { error: rowError } = await supabase.from('attachments').insert({
      contact_id: parsed.data.contact_id,
      call_report_id: parsed.data.call_report_id ?? null,
      proposal_id: parsed.data.proposal_id ?? null,
      storage_path: path,
      file_name: file.name.slice(0, 200),
      mime_type: file.type || null,
      size_bytes: file.size,
      uploaded_by: profile.id,
    })
    if (rowError) {
      // Remove the bytes we just wrote, so storage never accumulates objects
      // no row points at. Best effort: if this also fails there is nothing
      // further to try from here, and the row — the thing the interface reads
      // — is correctly absent either way.
      await supabase.storage.from(ATTACHMENTS_BUCKET).remove([path])
      return {
        error: partialFailure(attached, file.name, writeFailed(rowError, 'the record could not be saved')),
      }
    }

    attached.push(file.name)
  }

  revalidatePath(contactPath(parsed.data.contact_id))
  if (parsed.data.call_report_id) revalidatePath(`/reports/${parsed.data.call_report_id}`)
  if (parsed.data.proposal_id) revalidatePath(`/proposals/${parsed.data.proposal_id}`)
  return { ok: true }
}

/**
 * Files are uploaded one at a time, so a failure halfway through a batch
 * leaves the earlier ones genuinely attached. Saying so is the difference
 * between someone re-attaching four files they already have and someone
 * re-attaching the one that failed.
 */
function partialFailure(attached: string[], failedName: string, reason: string): string {
  const head = `Could not attach “${failedName}”: ${reason}`
  if (attached.length === 0) return head
  return `${head} ${pluralize(attached.length, 'earlier file was', 'earlier files were')} attached and ${attached.length === 1 ? 'is' : 'are'} safe.`
}

const removeAttachmentSchema = z.object({
  contact_id: uuidField('Missing contact'),
  attachment_id: uuidField('Missing file'),
})

export async function removeAttachment(
  _prev: ContactActionState,
  formData: FormData,
): Promise<ContactActionState> {
  await requireWriteAccess()
  const parsed = removeAttachmentSchema.safeParse({
    contact_id: text(formData, 'contact_id'),
    attachment_id: text(formData, 'attachment_id'),
  })
  if (!parsed.success) return invalid(parsed.error)

  const supabase = await createClient()
  const { data: row } = await supabase
    .from('attachments')
    .select('storage_path, call_report_id, proposal_id')
    .eq('id', parsed.data.attachment_id)
    .maybeSingle()

  const { error } = await supabase
    .from('attachments')
    .delete()
    .eq('id', parsed.data.attachment_id)
  if (error) return { error: writeFailed(error, 'Could not remove that file.') }

  // Row first, bytes second: if the object removal fails the record is already
  // gone, which is the safe direction — an unreferenced object is tidy-up, a
  // row pointing at deleted bytes is a broken download.
  if (row?.storage_path) {
    await supabase.storage.from(ATTACHMENTS_BUCKET).remove([row.storage_path])
  }

  revalidatePath(contactPath(parsed.data.contact_id))
  if (row?.call_report_id) revalidatePath(`/reports/${row.call_report_id}`)
  if (row?.proposal_id) revalidatePath(`/proposals/${row.proposal_id}`)
  return { ok: true }
}
