import 'server-only'

import {
  CONTACT_REF_FIELDS,
  toContactRef,
  type ContactRef,
  type ContactRefRow,
} from '@/lib/queries/dashboard'
import { createClient } from '@/lib/supabase/server'
import { contactDisplayName, truncate } from '@/lib/utils'
import type {
  ActivityType,
  ContactStatus,
  LeadStatus,
  LifecycleStage,
} from '@/types/database'

/**
 * Global search across contacts, the timeline and leads.
 *
 * Contacts are searched through the generated `search_vector`, which is what
 * the column exists for. Full text matches whole lexemes, so a partial word —
 * "joh" for "Johnson" — finds nothing; those queries, and any query the vector
 * cannot answer, fall back to ILIKE. Activities and leads have no vector, so
 * they are always ILIKE.
 *
 * Leads hold unvetted third-party PII and RLS hides them from viewers entirely,
 * so the caller says whether to look there at all.
 */

export const SEARCH_GROUP_LIMIT = 10
/** Below this, full text has nothing to match on and the fallback answers directly. */
export const MIN_FULLTEXT_LENGTH = 3
export const SNIPPET_RADIUS = 70

function fail(what: string, error: { message: string }): never {
  throw new Error(`Could not search ${what}: ${error.message}`)
}

/**
 * PostgREST's `or=` filter is comma- and parenthesis-delimited, so those
 * characters would rewrite the query and are removed. `%` and `*` go too, so
 * typing a wildcard searches for text instead of matching everything. `_` is
 * deliberately kept: it only ever widens a match, and stripping it would break
 * searching for an email like `first_last@example.org`.
 */
export function sanitizeLikeTerm(value: string): string {
  return value
    .replace(/[,()%*\\"']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * A readable window of text around the first thing that matched, so a result
 * shows *why* it matched rather than just its first line.
 *
 * With `fallback: false` an unmatched field yields nothing, which is what makes
 * a contact's notes appear only when the notes are the reason it is listed.
 */
export function snippet(
  text: string | null | undefined,
  term: string,
  options: { radius?: number; fallback?: boolean } = {},
): string | null {
  const radius = options.radius ?? SNIPPET_RADIUS
  const fallback = options.fallback ?? true
  const source = text?.replace(/\s+/g, ' ').trim() ?? ''
  if (source === '') return null

  const haystack = source.toLowerCase()
  const words = term.trim().toLowerCase().split(/\s+/).filter(Boolean)
  // Longest word first: it is the most specific, and a phrase that is not
  // present verbatim still lands near the part the reader cares about.
  const candidates = [term.trim().toLowerCase(), ...words.sort((a, b) => b.length - a.length)]

  for (const candidate of candidates) {
    if (candidate === '') continue
    const index = haystack.indexOf(candidate)
    if (index === -1) continue
    const start = Math.max(0, index - radius)
    const end = Math.min(source.length, index + candidate.length + radius)
    const lead = start > 0 ? '…' : ''
    const tail = end < source.length ? '…' : ''
    return `${lead}${source.slice(start, end).trim()}${tail}`
  }

  return fallback ? truncate(source, radius * 2) : null
}

// --- Shapes -----------------------------------------------------------------

export interface ContactHit {
  id: string
  name: string
  email: string | null
  phone: string | null
  organization_name: string | null
  lifecycle_stage: LifecycleStage
  status: ContactStatus
  last_activity_at: string | null
  snippet: string | null
}

export interface ActivityHit {
  id: string
  type: ActivityType
  subject: string | null
  snippet: string | null
  occurred_at: string
  contact: ContactRef | null
}

export interface LeadHit {
  id: string
  name: string
  email: string | null
  organization_name: string | null
  interest: string | null
  status: LeadStatus
  created_at: string
  /** Set once the lead has been converted, so the result can link to the person. */
  contact_id: string | null
  snippet: string | null
}

export interface SearchGroup<T> {
  items: T[]
  total: number
}

export interface SearchResults {
  q: string
  contacts: SearchGroup<ContactHit>
  activities: SearchGroup<ActivityHit>
  /** Null when the viewer cannot see leads, so the group is omitted rather than shown empty. */
  leads: SearchGroup<LeadHit> | null
  /** True when ILIKE answered for contacts because full text could not. */
  usedFallback: boolean
  total: number
}

const CONTACT_SEARCH_FIELDS = `
  id, full_name, preferred_name, first_name, last_name, organization_name, email,
  phone, lifecycle_stage, status, last_activity_at, notes
`

interface ContactSearchRow {
  id: string
  full_name: string | null
  preferred_name: string | null
  first_name: string | null
  last_name: string | null
  organization_name: string | null
  email: string | null
  phone: string | null
  lifecycle_stage: LifecycleStage
  status: ContactStatus
  last_activity_at: string | null
  notes: string | null
}

function toContactHit(row: ContactSearchRow, q: string): ContactHit {
  return {
    id: row.id,
    name: contactDisplayName(row),
    email: row.email,
    phone: row.phone,
    organization_name: row.organization_name,
    lifecycle_stage: row.lifecycle_stage,
    status: row.status,
    last_activity_at: row.last_activity_at,
    snippet: snippet(row.notes, q, { fallback: false }),
  }
}

// --- Group searches ---------------------------------------------------------

async function searchContacts(
  q: string,
  limit: number,
): Promise<SearchGroup<ContactHit> & { usedFallback: boolean }> {
  const supabase = await createClient()
  const term = sanitizeLikeTerm(q)

  if (q.trim().length >= MIN_FULLTEXT_LENGTH) {
    const { data, error, count } = await supabase
      .from('contacts')
      .select(CONTACT_SEARCH_FIELDS, { count: 'exact' })
      .is('deleted_at', null)
      .textSearch('search_vector', q, { type: 'websearch' })
      // No rank is available without an RPC, so recency decides the order —
      // the person you dealt with last week is usually the one you meant.
      .order('last_activity_at', { ascending: false, nullsFirst: false })
      .order('id', { ascending: true })
      .limit(limit)

    if (error) fail('contacts', error)
    const rows = data ?? []
    if (rows.length > 0) {
      return {
        items: rows.map((row) => toContactHit(row, q)),
        total: count ?? rows.length,
        usedFallback: false,
      }
    }
  }

  if (term === '') return { items: [], total: 0, usedFallback: true }

  const like = `%${term}%`
  const { data, error, count } = await supabase
    .from('contacts')
    .select(CONTACT_SEARCH_FIELDS, { count: 'exact' })
    .is('deleted_at', null)
    .or(
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
    .order('last_activity_at', { ascending: false, nullsFirst: false })
    .order('id', { ascending: true })
    .limit(limit)

  if (error) fail('contacts', error)
  const rows = data ?? []
  return {
    items: rows.map((row) => toContactHit(row, q)),
    total: count ?? rows.length,
    usedFallback: true,
  }
}

interface ActivitySearchRow {
  id: string
  type: ActivityType
  subject: string | null
  body: string | null
  occurred_at: string
  contact: ContactRefRow | null
}

const ACTIVITY_SEARCH_FIELDS = `
  id, type, subject, body, occurred_at,
  contact:contacts!inner(${CONTACT_REF_FIELDS})
`

async function searchActivities(q: string, limit: number): Promise<SearchGroup<ActivityHit>> {
  const term = sanitizeLikeTerm(q)
  if (term === '') return { items: [], total: 0 }

  const supabase = await createClient()
  const like = `%${term}%`
  const { data, error, count } = await supabase
    .from('activities')
    .select(ACTIVITY_SEARCH_FIELDS, { count: 'exact' })
    .is('contact.deleted_at', null)
    .or(`subject.ilike.${like},body.ilike.${like}`)
    .order('occurred_at', { ascending: false })
    .order('id', { ascending: true })
    .limit(limit)
    .overrideTypes<ActivitySearchRow[], { merge: false }>()

  if (error) fail('the timeline', error)

  const rows = data ?? []
  return {
    items: rows.map((row) => ({
      id: row.id,
      type: row.type,
      subject: row.subject,
      snippet: snippet(row.body ?? row.subject, q),
      occurred_at: row.occurred_at,
      contact: toContactRef(row.contact),
    })),
    total: count ?? rows.length,
  }
}

function leadName(row: {
  first_name: string | null
  last_name: string | null
  organization_name: string | null
  email: string | null
}): string {
  const composed = [row.first_name, row.last_name].filter(Boolean).join(' ').trim()
  return composed || row.organization_name?.trim() || row.email?.trim() || 'Unnamed lead'
}

async function searchLeads(q: string, limit: number): Promise<SearchGroup<LeadHit>> {
  const term = sanitizeLikeTerm(q)
  if (term === '') return { items: [], total: 0 }

  const supabase = await createClient()
  const like = `%${term}%`
  const { data, error, count } = await supabase
    .from('leads')
    .select(
      'id, first_name, last_name, email, organization_name, message, interest, status, created_at, contact_id',
      { count: 'exact' },
    )
    .or(
      [
        `first_name.ilike.${like}`,
        `last_name.ilike.${like}`,
        `email.ilike.${like}`,
        `organization_name.ilike.${like}`,
        `message.ilike.${like}`,
      ].join(','),
    )
    .order('created_at', { ascending: false })
    .order('id', { ascending: true })
    .limit(limit)

  if (error) fail('leads', error)

  const rows = data ?? []
  return {
    items: rows.map((row) => ({
      id: row.id,
      name: leadName(row),
      email: row.email,
      organization_name: row.organization_name,
      interest: row.interest,
      status: row.status,
      created_at: row.created_at,
      contact_id: row.contact_id,
      snippet: snippet(row.message, q, { fallback: false }),
    })),
    total: count ?? rows.length,
  }
}

// --- Entry point ------------------------------------------------------------

export async function searchEverything(
  q: string,
  options: { includeLeads: boolean; limit?: number },
): Promise<SearchResults> {
  const limit = options.limit ?? SEARCH_GROUP_LIMIT
  const trimmed = q.trim()

  if (trimmed === '') {
    return {
      q: trimmed,
      contacts: { items: [], total: 0 },
      activities: { items: [], total: 0 },
      leads: options.includeLeads ? { items: [], total: 0 } : null,
      usedFallback: false,
      total: 0,
    }
  }

  const [contacts, activities, leads] = await Promise.all([
    searchContacts(trimmed, limit),
    searchActivities(trimmed, limit),
    options.includeLeads ? searchLeads(trimmed, limit) : null,
  ])

  return {
    q: trimmed,
    contacts: { items: contacts.items, total: contacts.total },
    activities,
    leads,
    usedFallback: contacts.usedFallback,
    total: contacts.total + activities.total + (leads?.total ?? 0),
  }
}
