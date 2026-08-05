import 'server-only'

import { createClient } from '@/lib/supabase/server'
import {
  ASSIGNEE_ALL,
  ASSIGNEE_UNASSIGNED,
  segmentWindow,
  type FollowUpSegment,
} from '@/lib/validation/follow-up'
import type { FollowUpPriority, FollowUpStatus } from '@/types/database'

/**
 * Reads for the follow-up queue.
 *
 * Every query runs through the request-scoped client, so Row Level Security
 * decides visibility; the filters below are about relevance, not safety.
 */

export interface ContactSummary {
  id: string
  full_name: string | null
  preferred_name: string | null
  first_name: string | null
  last_name: string | null
  organization_name: string | null
  email: string | null
}

export interface TeamProfile {
  id: string
  full_name: string | null
  email: string
}

export interface FollowUpQueueItem {
  id: string
  contact_id: string
  title: string
  details: string | null
  due_at: string
  remind_at: string | null
  priority: FollowUpPriority
  status: FollowUpStatus
  assigned_to: string | null
  completed_at: string | null
  outcome_note: string | null
  contact: ContactSummary | null
  assignee: TeamProfile | null
}

export interface FollowUpQueueFilters {
  segment: FollowUpSegment
  /** A profile id, or the `all` / `unassigned` sentinels. `me` is resolved by the caller. */
  assignee: string
  priority: FollowUpPriority | 'all'
}

const CONTACT_FIELDS = 'id, full_name, preferred_name, first_name, last_name, organization_name, email'

// `profiles` is referenced three times from follow_ups (assigned_to, created_by,
// completed_by), so the embed has to name the constraint it means.
const QUEUE_SELECT = `
  id, contact_id, title, details, due_at, remind_at, priority, status,
  assigned_to, completed_at, outcome_note,
  contact:contacts!inner(${CONTACT_FIELDS}),
  assignee:profiles!follow_ups_assigned_to_fkey(id, full_name, email)
`

/** Caps a runaway queue; 200 rows is far more than anyone works through. */
const QUEUE_LIMIT = 200

export async function listFollowUps(
  filters: FollowUpQueueFilters,
  now: Date = new Date(),
): Promise<FollowUpQueueItem[]> {
  const supabase = await createClient()
  const window = segmentWindow(filters.segment, now)

  let query = supabase
    .from('follow_ups')
    .select(QUEUE_SELECT)
    // Follow-ups outlive a contact's soft delete; the queue should not.
    .is('contact.deleted_at', null)
    .eq('status', window.status)

  if (window.dueFrom) query = query.gte('due_at', window.dueFrom)
  if (window.dueBefore) query = query.lt('due_at', window.dueBefore)

  if (filters.assignee === ASSIGNEE_UNASSIGNED) query = query.is('assigned_to', null)
  else if (filters.assignee !== ASSIGNEE_ALL) query = query.eq('assigned_to', filters.assignee)

  if (filters.priority !== 'all') query = query.eq('priority', filters.priority)

  query =
    filters.segment === 'completed'
      ? query.order('completed_at', { ascending: false })
      : query.order('due_at', { ascending: true })

  const { data, error } = await query
    .limit(QUEUE_LIMIT)
    .overrideTypes<FollowUpQueueItem[], { merge: false }>()

  if (error) throw error
  return data ?? []
}

/** Staff and admins — the people a follow-up can meaningfully be assigned to. */
export async function listAssignableProfiles(): Promise<TeamProfile[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, email')
    .eq('is_active', true)
    .in('role', ['admin', 'staff'])
    .order('full_name', { ascending: true })

  if (error) throw error
  return data ?? []
}

export async function getContactForFollowUp(contactId: string): Promise<ContactSummary | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('contacts')
    .select(CONTACT_FIELDS)
    .eq('id', contactId)
    .is('deleted_at', null)
    .maybeSingle()

  if (error) throw error
  return data
}

/**
 * PostgREST's `or` filter is comma- and paren-delimited, so those characters
 * are stripped rather than escaped — a name search never needs them.
 */
export function sanitizeSearchTerm(term: string): string {
  return term.replace(/[,()*%\\"']/g, ' ').replace(/\s+/g, ' ').trim()
}

export async function searchContactsForFollowUp(term: string, limit = 10): Promise<ContactSummary[]> {
  const cleaned = sanitizeSearchTerm(term)
  if (cleaned.length < 2) return []

  const supabase = await createClient()
  const { data, error } = await supabase
    .from('contacts')
    .select(CONTACT_FIELDS)
    .is('deleted_at', null)
    .or(`full_name.ilike.%${cleaned}%,email.ilike.%${cleaned}%,organization_name.ilike.%${cleaned}%`)
    .order('full_name', { ascending: true })
    .limit(limit)

  if (error) throw error
  return data ?? []
}
