'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { canWrite, requireProfile } from '@/lib/auth'
import {
  INTENT_STATUS,
  assignLeadSchema,
  leadDisplayName,
  leadIdSchema,
  parseLeadIntent,
  type LeadActionState,
} from '@/lib/leads/triage'
import { createClient } from '@/lib/supabase/server'
import { toFieldErrors } from '@/lib/validation/contact'
import type { LeadRow, LeadStatus } from '@/types/database'

/**
 * Triage mutations.
 *
 * Conversion is a single `convert_lead()` call rather than a sequence of writes
 * from here: the contact, the engagement, the timeline entries and the lead
 * update have to happen together or not at all, and that function is where the
 * transaction lives. It also writes its own activity rows, so nothing here
 * touches `activities`.
 */

const NO_PERMISSION = 'You do not have permission to triage leads.'

/** Reads as the end of a sentence: "Jane Doe moved to spam." */
const STATUS_NOTICES: Record<LeadStatus, string> = {
  new: 'the new queue',
  in_review: 'in review',
  converted: 'converted',
  spam: 'spam',
  archived: 'the archive',
}

function text(formData: FormData, name: string): string {
  const value = formData.get(name)
  return typeof value === 'string' ? value : ''
}

function revalidateLeads(contactId?: string | null): void {
  revalidatePath('/leads')
  revalidatePath('/dashboard')
  if (contactId) {
    revalidatePath('/contacts')
    revalidatePath(`/contacts/${contactId}`)
  }
}

export async function updateLead(
  _prev: LeadActionState,
  formData: FormData,
): Promise<LeadActionState> {
  const profile = await requireProfile()
  if (!canWrite(profile)) return { error: NO_PERMISSION }

  const intent = parseLeadIntent(text(formData, 'intent'))
  if (!intent) return { error: 'That action is not available.' }

  const identified = leadIdSchema.safeParse({ id: text(formData, 'id') })
  if (!identified.success) return { error: 'That lead could not be found.' }

  const supabase = await createClient()
  const { data: lead, error: lookupError } = await supabase
    .from('leads')
    .select('id, status, first_name, last_name, organization_name, email, phone, assigned_to')
    .eq('id', identified.data.id)
    .maybeSingle()

  if (lookupError) return { error: 'That lead could not be loaded.' }
  if (!lead) return { error: 'That lead could not be found.' }

  // The queue re-renders without the row that was acted on, so notices name the
  // lead rather than saying "done".
  const subject = leadDisplayName(lead)

  if (lead.status === 'converted') {
    return { error: `${subject} has already been converted to a contact.` }
  }

  if (intent === 'convert') {
    // `convert_lead` is SECURITY DEFINER and re-checks `can_write()` itself, so
    // it runs on the user's own client rather than the service role.
    const { data: contactId, error } = await supabase.rpc('convert_lead', {
      p_lead_id: lead.id,
      // The person already carrying the lead keeps it; otherwise whoever
      // converted it picks it up.
      p_owner_id: lead.assigned_to ?? profile.id,
    })

    if (error || !contactId) {
      return { error: `${subject} could not be converted. Try again, or check the details.` }
    }

    revalidateLeads(contactId)
    redirect(`/contacts/${contactId}`)
  }

  if (intent === 'assign' || intent === 'assign_to_me') {
    const parsed = assignLeadSchema.safeParse({
      id: lead.id,
      assigned_to: intent === 'assign_to_me' ? profile.id : text(formData, 'assigned_to'),
    })
    if (!parsed.success) {
      return { error: 'Check the highlighted fields.', fieldErrors: toFieldErrors(parsed.error) }
    }

    return applyUpdate(
      lead.id,
      { assigned_to: parsed.data.assigned_to },
      parsed.data.assigned_to ? `${subject} assigned.` : `${subject} is now unassigned.`,
    )
  }

  const status = INTENT_STATUS[intent]
  if (!status) return { error: 'That action is not available.' }

  return applyUpdate(lead.id, { status }, `${subject} moved to ${STATUS_NOTICES[status]}.`)
}

async function applyUpdate(
  id: string,
  patch: Partial<LeadRow>,
  notice: string,
): Promise<LeadActionState> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('leads')
    .update(patch)
    .eq('id', id)
    .select('id')
    .maybeSingle()

  if (error) return { error: 'That change could not be saved.' }
  // Row Level Security can legitimately match nothing, which PostgREST reports
  // as a successful no-op; surface it as the refusal it is.
  if (!data) return { error: 'That lead could not be updated.' }

  revalidateLeads()
  return { notice }
}
