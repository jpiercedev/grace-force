import 'server-only'

import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
import { CONTACT_STATUSES, LIFECYCLE_STAGES } from '@/lib/validation/contact'
import type {
  ActivityDirection,
  ActivitySource,
  ActivityType,
  ContactEmailEngagementRow,
  ContactGivingSummaryRow,
  ContactRow,
  ContactStatus,
  EngagementStatus,
  EngagementTypeRow,
  FollowUpPriority,
  GiftRow,
  LifecycleStage,
  MailchimpAction,
  UserRole,
} from '@/types/database'

/**
 * Read helpers for the contact record and its timeline.
 *
 * Every query runs through the request-scoped client, so Row Level Security
 * decides what comes back; the filters here are about relevance only.
 *
 * Related rows are fetched separately and joined in TypeScript rather than
 * with PostgREST embeds. Two reasons: `contacts` has three foreign keys to
 * `profiles`, so an embed needs a hint to be unambiguous, and the badge and
 * actor lookups reuse one small roster query instead of repeating the join
 * per row.
 */

export const CONTACT_PAGE_SIZE = 25
export const TIMELINE_PAGE_SIZE = 25

/**
 * Ceiling on a "load more" timeline. Past this the page is unusable anyway, and
 * an unbounded `show=` in the URL is a cheap way to make the server do work.
 */
export const TIMELINE_MAX_LOADED = 500

export const CONTACT_SORTS = ['recent', 'name', 'created'] as const
export type ContactSort = (typeof CONTACT_SORTS)[number]

export interface ContactListFilters {
  q: string | null
  ownerId: string | null
  lifecycleStage: LifecycleStage | null
  status: ContactStatus | null
  engagementTypeId: string | null
  tag: string | null
  sort: ContactSort
  page: number
}

export interface TeamMember {
  id: string
  name: string
  email: string
  role: UserRole
  is_active: boolean
}

export interface EngagementBadge {
  id: string
  status: EngagementStatus
  typeId: string
  label: string
  color: string
}

export interface ContactListItem {
  id: string
  name: string
  email: string | null
  phone: string | null
  mobile_phone: string | null
  organization_name: string | null
  job_title: string | null
  lifecycle_stage: LifecycleStage
  status: ContactStatus
  tags: string[]
  last_activity_at: string | null
  created_at: string
  owner: TeamMember | null
  engagements: EngagementBadge[]
}

export interface ContactListResult {
  contacts: ContactListItem[]
  total: number
  page: number
  pageCount: number
  pageSize: number
}

export interface TimelineActivity {
  id: string
  type: ActivityType
  direction: ActivityDirection
  source: ActivitySource
  subject: string | null
  body: string | null
  /** How the interaction went. Null for machine-written entries. */
  outcome: string | null
  occurred_at: string
  is_pinned: boolean
  actor: TeamMember | null
  actor_label: string | null
}

export interface TimelineDay {
  key: string
  date: string
  activities: TimelineActivity[]
}

export interface ContactTimeline {
  activities: TimelineActivity[]
  total: number
  hasMore: boolean
}

export interface ContactEngagement {
  id: string
  status: EngagementStatus
  role_detail: string | null
  started_on: string
  ended_on: string | null
  last_touch_at: string | null
  notes: string | null
  type: EngagementTypeRow | null
  owner: TeamMember | null
}

export interface ContactFollowUp {
  id: string
  title: string
  details: string | null
  due_at: string
  priority: FollowUpPriority
  assignee: TeamMember | null
}

export interface ContactGiving {
  summary: ContactGivingSummaryRow | null
  recent: GiftRow[]
}

export interface EmailActivityItem {
  id: string
  action: MailchimpAction
  action_at: string | null
  url: string | null
  campaign: string | null
}

export interface ContactEmailEngagement {
  summary: ContactEmailEngagementRow | null
  recent: EmailActivityItem[]
}

const CONTACT_LIST_COLUMNS = `
  id, first_name, last_name, preferred_name, full_name, email, phone, mobile_phone,
  organization_name, job_title, lifecycle_stage, status, tags, owner_id,
  last_activity_at, created_at
`

const ACTIVITY_COLUMNS = `
  id, type, direction, source, subject, body, outcome, occurred_at, is_pinned, actor_id, actor_label
`

function fail(what: string, error: { message: string }): never {
  throw new Error(`Could not load ${what}: ${error.message}`)
}

/** Best display name for a row that may be a person, an organisation, or barely filled in. */
function displayName(contact: {
  preferred_name: string | null
  first_name: string | null
  last_name: string | null
  full_name: string | null
  organization_name: string | null
  email: string | null
}): string {
  const composed = [contact.preferred_name ?? contact.first_name, contact.last_name]
    .filter(Boolean)
    .join(' ')
    .trim()
  return (
    composed ||
    contact.full_name?.trim() ||
    contact.organization_name?.trim() ||
    contact.email?.trim() ||
    'Unnamed contact'
  )
}

function toTeamMember(row: {
  id: string
  full_name: string | null
  email: string
  role: UserRole
  is_active: boolean
}): TeamMember {
  return {
    id: row.id,
    name: row.full_name?.trim() || row.email,
    email: row.email,
    role: row.role,
    is_active: row.is_active,
  }
}

/**
 * The staff roster, used for owner pickers, the owner column and timeline
 * actors. Cached per request so a page that needs all three pays once.
 */
export const listTeamMembers = cache(async (): Promise<TeamMember[]> => {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, email, role, is_active')
    .order('full_name', { ascending: true, nullsFirst: false })
    .order('email', { ascending: true })

  if (error) fail('the team roster', error)
  return (data ?? []).map(toTeamMember)
})

export const teamMemberMap = cache(async (): Promise<Map<string, TeamMember>> => {
  const members = await listTeamMembers()
  return new Map(members.map((member) => [member.id, member]))
})

/** Every type, including deactivated ones — a contact may still hold an engagement of one. */
export const listEngagementTypes = cache(async (): Promise<EngagementTypeRow[]> => {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('engagement_types')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('label', { ascending: true })

  if (error) fail('engagement types', error)
  return data ?? []
})

function first(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value
  const trimmed = raw?.trim() ?? ''
  return trimmed === '' ? null : trimmed
}

function oneOf<T extends string>(value: string | null, allowed: readonly T[]): T | null {
  return value !== null && (allowed as readonly string[]).includes(value) ? (value as T) : null
}

export function parseContactListFilters(
  params: Record<string, string | string[] | undefined>,
): ContactListFilters {
  const page = Number.parseInt(first(params.page) ?? '1', 10)
  return {
    q: first(params.q),
    ownerId: first(params.owner),
    lifecycleStage: oneOf(first(params.stage), LIFECYCLE_STAGES),
    status: oneOf(first(params.status), CONTACT_STATUSES),
    engagementTypeId: first(params.type),
    tag: first(params.tag),
    sort: oneOf(first(params.sort), CONTACT_SORTS) ?? 'recent',
    page: Number.isFinite(page) && page > 0 ? page : 1,
  }
}

export function hasActiveFilters(filters: ContactListFilters): boolean {
  return Boolean(
    filters.q ||
      filters.ownerId ||
      filters.lifecycleStage ||
      filters.status ||
      filters.engagementTypeId ||
      filters.tag,
  )
}

/** Round-trips the filters back into a query string, so links keep the view. */
export function contactListSearchParams(filters: ContactListFilters): URLSearchParams {
  const params = new URLSearchParams()
  if (filters.q) params.set('q', filters.q)
  if (filters.ownerId) params.set('owner', filters.ownerId)
  if (filters.lifecycleStage) params.set('stage', filters.lifecycleStage)
  if (filters.status) params.set('status', filters.status)
  if (filters.engagementTypeId) params.set('type', filters.engagementTypeId)
  if (filters.tag) params.set('tag', filters.tag)
  if (filters.sort !== 'recent') params.set('sort', filters.sort)
  return params
}

/**
 * PostgREST's `or=` filter is a comma- and parenthesis-delimited string, so
 * those characters in user input would rewrite the query. Wildcards are
 * stripped too, so typing `%` searches for text rather than matching everything.
 */
function sanitizeLikeTerm(value: string): string {
  return value.replace(/[,()%_*\\"]/g, ' ').replace(/\s+/g, ' ').trim()
}

export async function listContacts(filters: ContactListFilters): Promise<ContactListResult> {
  const supabase = await createClient()
  const page = Math.max(1, filters.page)
  const from = (page - 1) * CONTACT_PAGE_SIZE
  const table = supabase.from('contacts')

  // Filtering by engagement type needs an inner join. The joined rows are not
  // read back: the badge column below loads every live engagement separately,
  // so filtering by "Donor" still shows a contact's volunteer badge too.
  let query = filters.engagementTypeId
    ? table
        .select(`${CONTACT_LIST_COLUMNS}, engagements!inner(engagement_type_id, status)`, {
          count: 'exact',
        })
        .eq('engagements.engagement_type_id', filters.engagementTypeId)
        .neq('engagements.status', 'ended')
    : table.select(CONTACT_LIST_COLUMNS, { count: 'exact' })

  query = query.is('deleted_at', null)

  if (filters.ownerId) query = query.eq('owner_id', filters.ownerId)
  if (filters.lifecycleStage) query = query.eq('lifecycle_stage', filters.lifecycleStage)
  if (filters.status) query = query.eq('status', filters.status)
  if (filters.tag) query = query.contains('tags', [filters.tag])

  if (filters.q) {
    const term = sanitizeLikeTerm(filters.q)
    if (term !== '') {
      // Full-text search matches whole lexemes, so it cannot answer partial
      // input like "joh". A single token is usually someone still typing, so
      // that case goes to a trigram-backed ILIKE; multi-word queries — where
      // word order and stemming matter — go to the search vector.
      if (/\s/.test(term)) {
        query = query.textSearch('search_vector', filters.q, { type: 'websearch' })
      } else {
        const like = `%${term}%`
        query = query.or(
          [
            `full_name.ilike.${like}`,
            `preferred_name.ilike.${like}`,
            `email.ilike.${like}`,
            `secondary_email.ilike.${like}`,
            `organization_name.ilike.${like}`,
            `phone.ilike.${like}`,
            `mobile_phone.ilike.${like}`,
          ].join(','),
        )
      }
    }
  }

  if (filters.sort === 'name') {
    query = query
      .order('full_name', { ascending: true, nullsFirst: false })
      .order('organization_name', { ascending: true, nullsFirst: false })
  } else if (filters.sort === 'created') {
    query = query.order('created_at', { ascending: false })
  } else {
    query = query.order('last_activity_at', { ascending: false, nullsFirst: false })
  }
  // Stable tiebreaker: without it, equal sort keys can reshuffle between pages
  // and a contact appears twice or not at all.
  query = query.order('id', { ascending: true })

  const { data, error, count } = await query.range(from, from + CONTACT_PAGE_SIZE - 1)
  if (error) fail('contacts', error)

  const rows = data ?? []
  const total = count ?? 0
  const [members, badges] = await Promise.all([
    teamMemberMap(),
    loadEngagementBadges(rows.map((row) => row.id)),
  ])

  return {
    contacts: rows.map((row) => ({
      id: row.id,
      name: displayName(row),
      email: row.email,
      phone: row.phone,
      mobile_phone: row.mobile_phone,
      organization_name: row.organization_name,
      job_title: row.job_title,
      lifecycle_stage: row.lifecycle_stage,
      status: row.status,
      tags: row.tags,
      last_activity_at: row.last_activity_at,
      created_at: row.created_at,
      owner: row.owner_id ? (members.get(row.owner_id) ?? null) : null,
      engagements: badges.get(row.id) ?? [],
    })),
    total,
    page,
    pageCount: Math.max(1, Math.ceil(total / CONTACT_PAGE_SIZE)),
    pageSize: CONTACT_PAGE_SIZE,
  }
}

async function loadEngagementBadges(
  contactIds: string[],
): Promise<Map<string, EngagementBadge[]>> {
  const grouped = new Map<string, EngagementBadge[]>()
  if (contactIds.length === 0) return grouped

  const supabase = await createClient()
  const [{ data, error }, types] = await Promise.all([
    supabase
      .from('engagements')
      .select('id, contact_id, engagement_type_id, status')
      .in('contact_id', contactIds)
      .neq('status', 'ended'),
    listEngagementTypes(),
  ])

  if (error) fail('engagements', error)
  const typeMap = new Map(types.map((type) => [type.id, type]))

  for (const row of data ?? []) {
    const type = typeMap.get(row.engagement_type_id)
    const list = grouped.get(row.contact_id) ?? []
    list.push({
      id: row.id,
      status: row.status,
      typeId: row.engagement_type_id,
      label: type?.label ?? 'Engagement',
      color: type?.color ?? 'slate',
    })
    grouped.set(row.contact_id, list)
  }

  for (const list of grouped.values()) {
    list.sort((a, b) => a.label.localeCompare(b.label))
  }
  return grouped
}

/** Cached so `generateMetadata` and the page body share one round-trip. */
export const getContact = cache(async (id: string): Promise<ContactRow | null> => {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('contacts')
    .select('*')
    .eq('id', id)
    .is('deleted_at', null)
    .maybeSingle()

  if (error) fail('the contact', error)
  return data ?? null
})

export function contactName(contact: ContactRow): string {
  return displayName(contact)
}

export async function getContactTimeline(
  contactId: string,
  options: { limit?: number; type?: ActivityType | null } = {},
): Promise<ContactTimeline> {
  const limit = Math.max(
    TIMELINE_PAGE_SIZE,
    Math.min(options.limit ?? TIMELINE_PAGE_SIZE, TIMELINE_MAX_LOADED),
  )
  const supabase = await createClient()

  let query = supabase
    .from('activities')
    .select(ACTIVITY_COLUMNS, { count: 'exact' })
    .eq('contact_id', contactId)
  if (options.type) query = query.eq('type', options.type)

  const { data, error, count } = await query
    .order('occurred_at', { ascending: false })
    .order('id', { ascending: true })
    .range(0, limit - 1)

  if (error) fail('the timeline', error)

  const rows = data ?? []
  const members = await teamMemberMap()

  return {
    activities: rows.map((row) => ({
      id: row.id,
      type: row.type,
      direction: row.direction,
      source: row.source,
      subject: row.subject,
      body: row.body,
      outcome: row.outcome,
      occurred_at: row.occurred_at,
      is_pinned: row.is_pinned,
      actor: row.actor_id ? (members.get(row.actor_id) ?? null) : null,
      actor_label: row.actor_label,
    })),
    total: count ?? rows.length,
    hasMore: (count ?? 0) > rows.length,
  }
}

/**
 * Groups a timeline into calendar days, pinned entries first within each day.
 * Sorting pinned-first in SQL instead would scatter old pinned notes across
 * the wrong dates.
 */
export function groupActivitiesByDay(activities: TimelineActivity[]): TimelineDay[] {
  const days: TimelineDay[] = []
  const index = new Map<string, TimelineDay>()

  for (const activity of activities) {
    const date = new Date(activity.occurred_at)
    const key = Number.isNaN(date.getTime())
      ? 'unknown'
      : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
          date.getDate(),
        ).padStart(2, '0')}`

    let day = index.get(key)
    if (!day) {
      day = { key, date: activity.occurred_at, activities: [] }
      index.set(key, day)
      days.push(day)
    }
    day.activities.push(activity)
  }

  for (const day of days) {
    day.activities.sort((a, b) => Number(b.is_pinned) - Number(a.is_pinned))
  }
  return days
}

export async function getContactEngagements(contactId: string): Promise<ContactEngagement[]> {
  const supabase = await createClient()
  const [{ data, error }, types, members] = await Promise.all([
    supabase
      .from('engagements')
      .select(
        'id, engagement_type_id, status, role_detail, owner_id, started_on, ended_on, last_touch_at, notes',
      )
      .eq('contact_id', contactId),
    listEngagementTypes(),
    teamMemberMap(),
  ])

  if (error) fail('engagements', error)
  const typeMap = new Map(types.map((type) => [type.id, type]))

  return (data ?? [])
    .map((row) => ({
      id: row.id,
      status: row.status,
      role_detail: row.role_detail,
      started_on: row.started_on,
      ended_on: row.ended_on,
      last_touch_at: row.last_touch_at,
      notes: row.notes,
      type: typeMap.get(row.engagement_type_id) ?? null,
      owner: row.owner_id ? (members.get(row.owner_id) ?? null) : null,
    }))
    .sort((a, b) => {
      // Live engagements are what staff act on; ended ones are history.
      const live = Number(b.status !== 'ended') - Number(a.status !== 'ended')
      if (live !== 0) return live
      return b.started_on.localeCompare(a.started_on)
    })
}

export async function getContactFollowUps(contactId: string): Promise<ContactFollowUp[]> {
  const supabase = await createClient()
  const [{ data, error }, members] = await Promise.all([
    supabase
      .from('follow_ups')
      .select('id, title, details, due_at, priority, assigned_to')
      .eq('contact_id', contactId)
      .eq('status', 'open')
      .order('due_at', { ascending: true })
      .limit(10),
    teamMemberMap(),
  ])

  if (error) fail('follow-ups', error)

  return (data ?? []).map((row) => ({
    id: row.id,
    title: row.title,
    details: row.details,
    due_at: row.due_at,
    priority: row.priority,
    assignee: row.assigned_to ? (members.get(row.assigned_to) ?? null) : null,
  }))
}

/**
 * Giving is gated by `can_view_giving()` in the database, so a staff member
 * without it reads nothing here rather than being refused. Callers still check
 * the capability first, so the panel is absent rather than empty-and-broken.
 */
export async function getContactGiving(contactId: string): Promise<ContactGiving> {
  const supabase = await createClient()
  const [summary, gifts] = await Promise.all([
    supabase.from('contact_giving_summary').select('*').eq('contact_id', contactId).maybeSingle(),
    supabase
      .from('gifts')
      .select('*')
      .eq('contact_id', contactId)
      .order('given_on', { ascending: false })
      .limit(5),
  ])

  if (summary.error) fail('the giving summary', summary.error)
  if (gifts.error) fail('gifts', gifts.error)

  return { summary: summary.data ?? null, recent: gifts.data ?? [] }
}

export async function getContactEmailEngagement(
  contactId: string,
): Promise<ContactEmailEngagement> {
  const supabase = await createClient()
  const [summary, events] = await Promise.all([
    supabase.from('contact_email_engagement').select('*').eq('contact_id', contactId).maybeSingle(),
    supabase
      .from('mailchimp_campaign_activity')
      .select('id, campaign_id, action, action_at, url')
      .eq('contact_id', contactId)
      .order('action_at', { ascending: false, nullsFirst: false })
      .limit(8),
  ])

  if (summary.error) fail('email engagement', summary.error)
  if (events.error) fail('email activity', events.error)

  const rows = events.data ?? []
  const campaignIds = [...new Set(rows.map((row) => row.campaign_id))]
  const titles = new Map<string, string>()

  if (campaignIds.length > 0) {
    const { data, error } = await supabase
      .from('mailchimp_campaigns')
      .select('id, title, subject_line')
      .in('id', campaignIds)
    if (error) fail('campaigns', error)
    for (const campaign of data ?? []) {
      const title = campaign.title?.trim() || campaign.subject_line?.trim()
      if (title) titles.set(campaign.id, title)
    }
  }

  return {
    summary: summary.data ?? null,
    recent: rows.map((row) => ({
      id: row.id,
      action: row.action,
      action_at: row.action_at,
      url: row.url,
      campaign: titles.get(row.campaign_id) ?? null,
    })),
  }
}
