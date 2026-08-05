import 'server-only'

import type { TeamProfile } from '@/lib/queries/follow-ups'
import {
  ASSIGNEE_ANYONE,
  ASSIGNEE_UNASSIGNED,
  LEAD_STATUSES,
  STATUS_ANY,
  type LeadStatusFilter,
} from '@/lib/leads/triage'
import { createClient } from '@/lib/supabase/server'
import type { Json, LeadStatus } from '@/types/database'

/**
 * Reads for the triage queue.
 *
 * Everything goes through the request-scoped client, so Row Level Security
 * decides visibility — `leads_select` requires `can_write()`, which is why a
 * viewer never sees this screen's data even if they reach the URL.
 */

export interface LeadContactSummary {
  id: string
  full_name: string | null
  preferred_name: string | null
  first_name: string | null
  last_name: string | null
  organization_name: string | null
  email: string | null
}

export interface LeadQueueItem {
  id: string
  first_name: string | null
  last_name: string | null
  email: string | null
  phone: string | null
  organization_name: string | null
  message: string | null
  interest: string | null
  form_key: string
  page_url: string | null
  utm: Json
  status: LeadStatus
  assigned_to: string | null
  contact_id: string | null
  converted_at: string | null
  created_at: string
  assignee: TeamProfile | null
  contact: LeadContactSummary | null
}

export interface LeadQueueFilters {
  status: LeadStatusFilter
  /** A profile id, or the `anyone` / `unassigned` sentinels. `me` is resolved by the caller. */
  assignee: string
}

// `profiles` is referenced twice from leads (assigned_to, converted_by), so the
// embed has to name the constraint it means.
const QUEUE_SELECT = `
  id, first_name, last_name, email, phone, organization_name, message, interest,
  form_key, page_url, utm, status, assigned_to, contact_id, converted_at, created_at,
  assignee:profiles!leads_assigned_to_fkey(id, full_name, email),
  contact:contacts(id, full_name, preferred_name, first_name, last_name, organization_name, email)
`

/** Caps a queue that has been left to pile up; triage happens at the top. */
const QUEUE_LIMIT = 200

export async function listLeads(filters: LeadQueueFilters): Promise<LeadQueueItem[]> {
  const supabase = await createClient()

  let query = supabase.from('leads').select(QUEUE_SELECT)

  if (filters.status !== STATUS_ANY) query = query.eq('status', filters.status)

  if (filters.assignee === ASSIGNEE_UNASSIGNED) query = query.is('assigned_to', null)
  else if (filters.assignee !== ASSIGNEE_ANYONE) query = query.eq('assigned_to', filters.assignee)

  const { data, error } = await query
    .order('created_at', { ascending: false })
    .limit(QUEUE_LIMIT)
    .overrideTypes<LeadQueueItem[], { merge: false }>()

  if (error) throw error
  return data ?? []
}

/**
 * Counts for the status tabs. Deliberately unfiltered by assignee: the tabs
 * report what the team has waiting, and a count that moved when you changed the
 * assignee filter would answer a question nobody asked.
 */
export async function leadStatusCounts(): Promise<Record<LeadStatus, number>> {
  const supabase = await createClient()

  const results = await Promise.all(
    LEAD_STATUSES.map(async (status) => {
      const { count, error } = await supabase
        .from('leads')
        .select('id', { count: 'exact', head: true })
        .eq('status', status)
      if (error) throw error
      return [status, count ?? 0] as const
    }),
  )

  return Object.fromEntries(results) as Record<LeadStatus, number>
}
