import 'server-only'

import { CONTACT_REF_FIELDS, toContactRef, type ContactRef } from '@/lib/queries/dashboard'
import { createClient } from '@/lib/supabase/server'
import type { ProposalRow, ProposalStatus } from '@/types/database'

/**
 * Reads for proposals and planned gifts.
 *
 * `proposals` is readable by every active team member and writable by staff
 * (20260814000400). Row Level Security decides what comes back — these reads
 * never filter for safety, only relevance.
 */

function fail(what: string, error: { message: string }): never {
  throw new Error(`Could not load ${what}: ${error.message}`)
}

const OPEN_STATUSES: ProposalStatus[] = ['exploring', 'drafted', 'presented', 'committed']

export interface ProposalSummary {
  id: string
  title: string
  kind: ProposalRow['kind']
  status: ProposalStatus
  amountCents: number | null
  currency: string
  expectedCloseOn: string | null
  openedOn: string
  purpose: string | null
  contact: ContactRef | null
  jointContact: ContactRef | null
  ownerId: string | null
}

const SUMMARY_SELECT = `
  id, title, kind, status, charitable_amount_cents, currency, expected_close_on,
  opened_on, purpose, owner_id,
  contact:contacts!proposals_contact_id_fkey(${CONTACT_REF_FIELDS}),
  joint_contact:contacts!proposals_joint_contact_id_fkey(${CONTACT_REF_FIELDS})
`

interface SummaryRow {
  id: string
  title: string
  kind: ProposalRow['kind']
  status: ProposalStatus
  charitable_amount_cents: number | null
  currency: string
  expected_close_on: string | null
  opened_on: string
  purpose: string | null
  owner_id: string | null
  contact: never
  joint_contact: never
}

function toSummary(row: SummaryRow): ProposalSummary {
  return {
    id: row.id,
    title: row.title,
    kind: row.kind,
    status: row.status,
    amountCents: row.charitable_amount_cents,
    currency: row.currency,
    expectedCloseOn: row.expected_close_on,
    openedOn: row.opened_on,
    purpose: row.purpose,
    contact: toContactRef(row.contact),
    jointContact: toContactRef(row.joint_contact),
    ownerId: row.owner_id,
  }
}

export const PROPOSAL_PAGE_SIZE = 50

export interface ProposalListFilters {
  /** `open` is the default view: settled proposals are history, not work. */
  segment: 'open' | 'all' | ProposalStatus
  ownerId: string | null
}

export function parseProposalFilters(
  params: Record<string, string | string[] | undefined>,
): ProposalListFilters {
  const raw = Array.isArray(params.status) ? params.status[0] : params.status
  const owner = Array.isArray(params.owner) ? params.owner[0] : params.owner
  const known = ['open', 'all', ...OPEN_STATUSES, 'funded', 'declined']
  return {
    segment: (raw && known.includes(raw) ? raw : 'open') as ProposalListFilters['segment'],
    ownerId: owner?.trim() || null,
  }
}

export async function listProposals(filters: ProposalListFilters): Promise<ProposalSummary[]> {
  const supabase = await createClient()
  let query = supabase
    .from('proposals')
    .select(SUMMARY_SELECT)
    .limit(PROPOSAL_PAGE_SIZE)

  if (filters.segment === 'open') query = query.in('status', OPEN_STATUSES)
  else if (filters.segment !== 'all') query = query.eq('status', filters.segment)

  if (filters.ownerId) query = query.eq('owner_id', filters.ownerId)

  // Open work sorts by when it is expected to land, with undated last; the
  // full list is chronological by when it was opened.
  const { data, error } =
    filters.segment === 'funded' || filters.segment === 'declined' || filters.segment === 'all'
      ? await query.order('opened_on', { ascending: false })
      : await query.order('expected_close_on', { ascending: true, nullsFirst: false })

  if (error) fail('proposals', error)
  return ((data ?? []) as unknown as SummaryRow[]).map(toSummary)
}

/** Proposals attached to one donor — as the primary donor or the joint one. */
export async function getContactProposals(contactId: string): Promise<ProposalSummary[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('proposals')
    .select(SUMMARY_SELECT)
    .or(`contact_id.eq.${contactId},joint_contact_id.eq.${contactId}`)
    .order('opened_on', { ascending: false })

  if (error) fail('proposals for this person', error)
  return ((data ?? []) as unknown as SummaryRow[]).map(toSummary)
}

/**
 * The one open proposal worth showing in the donor header. Furthest along
 * wins, because that is the one a conversation is most likely to be about.
 */
export function primaryProposal(proposals: ProposalSummary[]): ProposalSummary | null {
  const order: ProposalStatus[] = ['committed', 'presented', 'drafted', 'exploring']
  for (const status of order) {
    const match = proposals.find((proposal) => proposal.status === status)
    if (match) return match
  }
  return null
}

export interface ProposalDetail {
  proposal: ProposalRow
  contact: ContactRef | null
  jointContact: ContactRef | null
}

export async function getProposal(id: string): Promise<ProposalDetail | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('proposals')
    .select(
      `*,
       contact:contacts!proposals_contact_id_fkey(${CONTACT_REF_FIELDS}),
       joint_contact:contacts!proposals_joint_contact_id_fkey(${CONTACT_REF_FIELDS})`,
    )
    .eq('id', id)
    .maybeSingle()

  if (error) fail('the proposal', error)
  if (!data) return null

  const row = data as unknown as ProposalRow & { contact: never; joint_contact: never }
  return {
    proposal: row,
    contact: toContactRef(row.contact),
    jointContact: toContactRef(row.joint_contact),
  }
}

/** Titles for the "related proposal" picker on an interaction or call report. */
export async function listProposalOptions(
  contactId: string,
): Promise<Array<{ id: string; title: string; status: ProposalStatus }>> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('proposals')
    .select('id, title, status')
    .or(`contact_id.eq.${contactId},joint_contact_id.eq.${contactId}`)
    .order('opened_on', { ascending: false })

  if (error) fail('proposals for this person', error)
  return data ?? []
}

/**
 * Open proposals a person is leading, soonest first.
 *
 * Feeds the dashboard, where the question is "what is waiting on me?" — so
 * undated proposals sort last rather than first: a proposal with no expected
 * date is not urgent, it is unplanned, and it should not push a real deadline
 * down the page.
 */
export async function listMyOpenProposals(
  ownerId: string,
  limit = 5,
): Promise<ProposalSummary[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('proposals')
    .select(SUMMARY_SELECT)
    .eq('owner_id', ownerId)
    .in('status', OPEN_STATUSES)
    .order('expected_close_on', { ascending: true, nullsFirst: false })
    .limit(limit)

  if (error) fail('your proposals', error)
  return ((data ?? []) as unknown as SummaryRow[]).map(toSummary)
}
