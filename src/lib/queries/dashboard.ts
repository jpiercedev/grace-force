import 'server-only'

import { addDays, startOfDay, startOfMonth, subDays } from 'date-fns'
import { createClient } from '@/lib/supabase/server'
import { segmentWindow } from '@/lib/validation/follow-up'
import { contactDisplayName } from '@/lib/utils'
import type { ActivityType, FollowUpPriority } from '@/types/database'

/**
 * Reads for the dashboard — the first screen a staff member sees each morning.
 *
 * Every query runs through the request-scoped client, so Row Level Security
 * decides what comes back; the filters here are about relevance, not safety.
 * Each helper returns an empty list on a fresh install rather than needing the
 * page to special-case "no data yet".
 */

/** Contacts are named the same way on every panel, so the shape is shared. */
export const CONTACT_REF_FIELDS =
  'id, full_name, preferred_name, first_name, last_name, organization_name, email'

export interface ContactRefRow {
  id: string
  full_name: string | null
  preferred_name: string | null
  first_name: string | null
  last_name: string | null
  organization_name: string | null
  email: string | null
}

export interface ContactRef {
  id: string
  name: string
}

export function toContactRef(row: ContactRefRow | null | undefined): ContactRef | null {
  return row ? { id: row.id, name: contactDisplayName(row) } : null
}

function fail(what: string, error: { message: string }): never {
  throw new Error(`Could not load ${what}: ${error.message}`)
}

export const ATTENTION_LIMIT = 5
export const RECENT_ACTIVITY_LIMIT = 10

// --- Stat tiles -------------------------------------------------------------

export interface DashboardStats {
  openFollowUps: number
  overdueFollowUps: number
  ownedContacts: number
  newLeadsThisWeek: number
  newContactsThisMonth: number
  /** Open opportunities with an expected close date inside the next 30 days. */
  closingSoonOpportunities: number
}

/**
 * Six counts in one round of parallel `head` requests — nothing here reads a
 * row body, so the whole strip costs six index scans.
 */
export async function getDashboardStats(
  userId: string,
  now: Date = new Date(),
): Promise<DashboardStats> {
  const supabase = await createClient()
  const nowIso = now.toISOString()
  // "This week" is the last seven days including today, not the calendar week:
  // on a Monday morning a calendar week would report almost nothing.
  const weekStartIso = subDays(startOfDay(now), 6).toISOString()
  const monthStartIso = startOfMonth(now).toISOString()
  // The same 30-day horizon the "Closing soon" panel queries, so the sentence
  // and the panel never disagree about how many are on the way.
  const closeHorizon = addDays(now, 30).toISOString().slice(0, 10)

  const [open, overdue, owned, newContacts, newLeads, closingSoon] = await Promise.all([
    supabase
      .from('follow_ups')
      .select('id', { count: 'exact', head: true })
      .eq('assigned_to', userId)
      .eq('status', 'open'),
    supabase
      .from('follow_ups')
      .select('id', { count: 'exact', head: true })
      .eq('assigned_to', userId)
      .eq('status', 'open')
      .lt('due_at', nowIso),
    supabase
      .from('contacts')
      .select('id', { count: 'exact', head: true })
      .eq('owner_id', userId)
      .is('deleted_at', null),
    supabase
      .from('contacts')
      .select('id', { count: 'exact', head: true })
      .is('deleted_at', null)
      .gte('created_at', monthStartIso),
    // Spam is filtered out: a bot storm would otherwise read as a good week.
    supabase
      .from('leads')
      .select('id', { count: 'exact', head: true })
      .gte('created_at', weekStartIso)
      .neq('status', 'spam'),
    // The inner contact join keeps soft-deleted people out of the count, the
    // same way the opportunity list itself filters them.
    supabase
      .from('pipeline_cards')
      .select('id, contact:contacts!inner(id)', { count: 'exact', head: true })
      .eq('status', 'open')
      .not('expected_close_on', 'is', null)
      .lte('expected_close_on', closeHorizon)
      .is('contact.deleted_at', null),
  ])

  if (open.error) fail('your follow-up count', open.error)
  if (overdue.error) fail('your overdue count', overdue.error)
  if (owned.error) fail('your contact count', owned.error)
  if (newContacts.error) fail('the new contact count', newContacts.error)
  if (newLeads.error) fail('the new lead count', newLeads.error)
  if (closingSoon.error) fail('the closing-soon count', closingSoon.error)

  return {
    openFollowUps: open.count ?? 0,
    overdueFollowUps: overdue.count ?? 0,
    ownedContacts: owned.count ?? 0,
    newContactsThisMonth: newContacts.count ?? 0,
    newLeadsThisWeek: newLeads.count ?? 0,
    closingSoonOpportunities: closingSoon.count ?? 0,
  }
}

// --- Follow-ups -------------------------------------------------------------

export interface DashboardFollowUp {
  id: string
  title: string
  due_at: string
  priority: FollowUpPriority
  contact: ContactRef | null
}

interface FollowUpRowShape {
  id: string
  title: string
  due_at: string
  priority: FollowUpPriority
  contact: ContactRefRow | null
}

const FOLLOW_UP_SELECT = `id, title, due_at, priority, contact:contacts!inner(${CONTACT_REF_FIELDS})`

/**
 * Follow-ups outlive a contact's soft delete, so the inner join and the
 * `deleted_at` filter keep archived people off the morning list.
 */
async function listFollowUpWindow(
  userId: string,
  window: { dueFrom: string | null; dueBefore: string | null },
  limit: number,
): Promise<DashboardFollowUp[]> {
  const supabase = await createClient()
  let query = supabase
    .from('follow_ups')
    .select(FOLLOW_UP_SELECT)
    .eq('assigned_to', userId)
    .eq('status', 'open')
    .is('contact.deleted_at', null)

  if (window.dueFrom) query = query.gte('due_at', window.dueFrom)
  if (window.dueBefore) query = query.lt('due_at', window.dueBefore)

  const { data, error } = await query
    .order('due_at', { ascending: true })
    .limit(limit)
    .overrideTypes<FollowUpRowShape[], { merge: false }>()

  if (error) fail('your follow-ups', error)

  return (data ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    due_at: row.due_at,
    priority: row.priority,
    contact: toContactRef(row.contact),
  }))
}

/**
 * The windows come from the follow-up queue's own segment definitions, so
 * "overdue" and "this week" mean exactly what they mean on `/follow-ups`.
 */
export async function listMyOverdueFollowUps(
  userId: string,
  limit: number = ATTENTION_LIMIT,
  now: Date = new Date(),
): Promise<DashboardFollowUp[]> {
  return listFollowUpWindow(userId, segmentWindow('overdue', now), limit)
}

export async function listMyUpcomingFollowUps(
  userId: string,
  limit: number = ATTENTION_LIMIT,
  now: Date = new Date(),
): Promise<DashboardFollowUp[]> {
  return listFollowUpWindow(userId, segmentWindow('week', now), limit)
}

// --- Recent activity --------------------------------------------------------

export interface DashboardActivity {
  id: string
  type: ActivityType
  subject: string | null
  body: string | null
  occurred_at: string
  /** A staff member's name, or the machine that wrote the entry. */
  actor: string | null
  contact: ContactRef | null
}

interface ActivityRowShape {
  id: string
  type: ActivityType
  subject: string | null
  body: string | null
  occurred_at: string
  actor_label: string | null
  actor: { id: string; full_name: string | null; email: string } | null
  contact: ContactRefRow | null
}

const ACTIVITY_SELECT = `
  id, type, subject, body, occurred_at, actor_label,
  actor:profiles(id, full_name, email),
  contact:contacts!inner(${CONTACT_REF_FIELDS})
`

/** The whole team's timeline, newest first — what happened while you were away. */
export async function listRecentActivity(
  limit: number = RECENT_ACTIVITY_LIMIT,
): Promise<DashboardActivity[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('activities')
    .select(ACTIVITY_SELECT)
    .is('contact.deleted_at', null)
    .order('occurred_at', { ascending: false })
    // Stable tiebreaker: bulk-imported rows share an instant to the microsecond.
    .order('id', { ascending: true })
    .limit(limit)
    .overrideTypes<ActivityRowShape[], { merge: false }>()

  if (error) fail('recent activity', error)

  return (data ?? []).map((row) => ({
    id: row.id,
    type: row.type,
    subject: row.subject,
    body: row.body,
    occurred_at: row.occurred_at,
    actor: row.actor?.full_name?.trim() || row.actor?.email || row.actor_label?.trim() || null,
    contact: toContactRef(row.contact),
  }))
}
