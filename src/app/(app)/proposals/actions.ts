'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { z } from 'zod'
import { isClosedProposalStatus } from '@/components/domain/development-badges'
import { requireAdmin, requireWriteAccess } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import type { ContactActionState } from '@/lib/validation/contact'
import { proposalSchema } from '@/lib/validation/development'
import { invalid, text, uuidField, writeFailed } from '@/lib/validation/form-data'
import type { ProposalStatus } from '@/types/database'

/**
 * Proposals and planned gifts.
 *
 * `proposals_closed_consistency` pairs `status` with `closed_at` in both
 * directions, so every write reconciles the two here rather than letting the
 * check constraint surface as a 500.
 */

function readForm(formData: FormData) {
  return proposalSchema.safeParse({
    contact_id: text(formData, 'contact_id'),
    joint_contact_id: text(formData, 'joint_contact_id'),
    title: text(formData, 'title'),
    kind: text(formData, 'kind'),
    status: text(formData, 'status'),
    purpose: text(formData, 'purpose'),
    notes: text(formData, 'notes'),
    opened_on: text(formData, 'opened_on'),
    expected_close_on: text(formData, 'expected_close_on'),
    owner_id: text(formData, 'owner_id'),
    charitable_amount_cents: text(formData, 'charitable_amount_cents'),
    fair_market_value_cents: text(formData, 'fair_market_value_cents'),
    estimated_deduction_cents: text(formData, 'estimated_deduction_cents'),
    expected_benefit_cents: text(formData, 'expected_benefit_cents'),
  })
}

/** Settled means a settlement time; open means none. Never both, never neither. */
function closedAtFor(status: ProposalStatus, existing: string | null): string | null {
  if (!isClosedProposalStatus(status)) return null
  return existing ?? new Date().toISOString()
}

export async function createProposal(
  _prev: ContactActionState,
  formData: FormData,
): Promise<ContactActionState> {
  const profile = await requireWriteAccess()

  const parsed = readForm(formData)
  if (!parsed.success) return invalid(parsed.error)

  const values = parsed.data
  if (values.joint_contact_id && values.joint_contact_id === values.contact_id) {
    return {
      error: 'The second donor must be someone else.',
      fieldErrors: { joint_contact_id: 'Choose a different person' },
    }
  }

  const status = values.status as ProposalStatus
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('proposals')
    .insert({
      contact_id: values.contact_id,
      joint_contact_id: values.joint_contact_id,
      title: values.title,
      kind: values.kind as never,
      status: status as never,
      purpose: values.purpose,
      notes: values.notes,
      opened_on: values.opened_on,
      expected_close_on: values.expected_close_on,
      closed_at: closedAtFor(status, null),
      owner_id: values.owner_id ?? profile.id,
      charitable_amount_cents: values.charitable_amount_cents,
      fair_market_value_cents: values.fair_market_value_cents,
      estimated_deduction_cents: values.estimated_deduction_cents,
      expected_benefit_cents: values.expected_benefit_cents,
      created_by: profile.id,
    })
    .select('id')
    .single()

  if (error) return { error: writeFailed(error, 'Could not create that proposal.') }

  revalidatePath('/proposals')
  revalidatePath(`/contacts/${values.contact_id}`)
  redirect(`/proposals/${data.id}`)
}

export async function updateProposal(
  _prev: ContactActionState,
  formData: FormData,
): Promise<ContactActionState> {
  await requireWriteAccess()

  const id = text(formData, 'proposal_id')
  if (!id) return { error: 'Missing proposal.' }

  const parsed = readForm(formData)
  if (!parsed.success) return invalid(parsed.error)

  const values = parsed.data
  if (values.joint_contact_id && values.joint_contact_id === values.contact_id) {
    return {
      error: 'The second donor must be someone else.',
      fieldErrors: { joint_contact_id: 'Choose a different person' },
    }
  }

  const supabase = await createClient()
  const { data: existing } = await supabase
    .from('proposals')
    .select('closed_at')
    .eq('id', id)
    .maybeSingle()

  const status = values.status as ProposalStatus
  const { error } = await supabase
    .from('proposals')
    .update({
      joint_contact_id: values.joint_contact_id,
      title: values.title,
      kind: values.kind as never,
      status: status as never,
      purpose: values.purpose,
      notes: values.notes,
      opened_on: values.opened_on,
      expected_close_on: values.expected_close_on,
      closed_at: closedAtFor(status, existing?.closed_at ?? null),
      owner_id: values.owner_id,
      charitable_amount_cents: values.charitable_amount_cents,
      fair_market_value_cents: values.fair_market_value_cents,
      estimated_deduction_cents: values.estimated_deduction_cents,
      expected_benefit_cents: values.expected_benefit_cents,
    })
    .eq('id', id)

  if (error) return { error: writeFailed(error, 'Could not save that proposal.') }

  revalidatePath('/proposals')
  revalidatePath(`/proposals/${id}`)
  revalidatePath(`/contacts/${values.contact_id}`)
  return { ok: true }
}

/**
 * The one-click stage move from the proposal header, so advancing a proposal
 * does not mean opening the whole edit form.
 */
const stageSchema = z.object({
  proposal_id: uuidField('Missing proposal'),
  status: z.string().trim().min(1, 'Choose a stage'),
})

export async function moveProposalStage(
  _prev: ContactActionState,
  formData: FormData,
): Promise<ContactActionState> {
  await requireWriteAccess()

  const parsed = stageSchema.safeParse({
    proposal_id: text(formData, 'proposal_id'),
    status: text(formData, 'status'),
  })
  if (!parsed.success) return invalid(parsed.error)

  const supabase = await createClient()
  const { data: existing } = await supabase
    .from('proposals')
    .select('contact_id, closed_at')
    .eq('id', parsed.data.proposal_id)
    .maybeSingle()
  if (!existing) return { error: 'That proposal no longer exists.' }

  const status = parsed.data.status as ProposalStatus
  const { error } = await supabase
    .from('proposals')
    .update({ status: status as never, closed_at: closedAtFor(status, existing.closed_at) })
    .eq('id', parsed.data.proposal_id)

  if (error) return { error: writeFailed(error, 'Could not move that proposal.') }

  revalidatePath('/proposals')
  revalidatePath(`/proposals/${parsed.data.proposal_id}`)
  revalidatePath(`/contacts/${existing.contact_id}`)
  return { ok: true }
}

export async function deleteProposal(
  _prev: ContactActionState,
  formData: FormData,
): Promise<ContactActionState> {
  await requireAdmin()
  const id = text(formData, 'proposal_id')
  if (!id) return { error: 'Missing proposal.' }

  const supabase = await createClient()
  const { data: existing } = await supabase
    .from('proposals')
    .select('contact_id')
    .eq('id', id)
    .maybeSingle()

  const { error } = await supabase.from('proposals').delete().eq('id', id)
  if (error) return { error: writeFailed(error, 'Could not delete that proposal.') }

  revalidatePath('/proposals')
  if (existing) revalidatePath(`/contacts/${existing.contact_id}`)
  redirect('/proposals')
}
