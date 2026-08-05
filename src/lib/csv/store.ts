import type { PostgrestError, SupabaseClient } from '@supabase/supabase-js'
import type {
  ContactLookupKeys,
  ContactStore,
  ContactWritePayload,
  GiftCreatePayload,
  GiftStore,
  GiftWritePayload,
} from '@/lib/csv/apply'
import { externalKey, type ContactMatchIndex } from '@/lib/csv/contacts'
import type { GiftMatchIndex } from '@/lib/csv/gifts'
import { chunk } from '@/lib/utils'
import type { Database } from '@/types/database'

/**
 * The Supabase side of importing.
 *
 * Every query runs through the caller's own client, so Row Level Security
 * decides what an import can see and write: a staff member cannot reach a
 * contact the interface would hide from them, and only an admin gets past the
 * `gifts` write policies.
 */

export type ImportClient = SupabaseClient<Database>

/**
 * Identifiers per request. They travel in the query string, and a filter long
 * enough to overflow the request line fails as an opaque gateway error rather
 * than a database one.
 */
const LOOKUP_CHUNK = 100

interface ContactKeyRow {
  id: string
  email_normalized: string | null
  external_source: string | null
  external_id: string | null
}

function failed(action: string, error: PostgrestError): Error {
  if (error.code === '23505') {
    return new Error(`${action}: another record already uses one of these identifiers.`)
  }
  if (error.code === '23514') {
    return new Error(`${action}: the database rejected these values (${error.message}).`)
  }
  return new Error(`${action}: ${error.message}`)
}

function indexContacts(rows: readonly ContactKeyRow[], externalSource: string): ContactMatchIndex {
  const ids = new Set<string>()
  const byExternalId = new Map<string, string>()
  const byEmail = new Map<string, string>()
  const externalKeys = new Map<string, string>()

  for (const row of rows) {
    ids.add(row.id)
    if (row.external_source && row.external_id) {
      externalKeys.set(row.id, externalKey(row.external_source, row.external_id))
      if (row.external_source === externalSource && !byExternalId.has(row.external_id)) {
        byExternalId.set(row.external_id, row.id)
      }
    }
    // Rows arrive oldest first, so a shared household address resolves to the
    // contact that has held it longest — stable across runs, which matters
    // more than which of the two is "right".
    if (row.email_normalized && !byEmail.has(row.email_normalized)) {
      byEmail.set(row.email_normalized, row.id)
    }
  }

  return { ids, byExternalId, byEmail, externalKeys }
}

export async function loadContactMatchIndex(
  db: ImportClient,
  keys: ContactLookupKeys,
  externalSource: string,
): Promise<ContactMatchIndex> {
  const found: ContactKeyRow[] = []
  const select = 'id, email_normalized, external_source, external_id'

  for (const ids of chunk(keys.ids, LOOKUP_CHUNK)) {
    const { data, error } = await db
      .from('contacts')
      .select(select)
      .is('deleted_at', null)
      .in('id', ids)
      .order('created_at', { ascending: true })
    if (error) throw failed('Looking up contacts by id', error)
    found.push(...(data ?? []))
  }

  for (const externalIds of chunk(keys.externalIds, LOOKUP_CHUNK)) {
    const { data, error } = await db
      .from('contacts')
      .select(select)
      .is('deleted_at', null)
      .eq('external_source', externalSource)
      .in('external_id', externalIds)
      .order('created_at', { ascending: true })
    if (error) throw failed('Looking up contacts by external ID', error)
    found.push(...(data ?? []))
  }

  for (const emails of chunk(keys.emails, LOOKUP_CHUNK)) {
    const { data, error } = await db
      .from('contacts')
      .select(select)
      .is('deleted_at', null)
      .in('email_normalized', emails)
      .order('created_at', { ascending: true })
    if (error) throw failed('Looking up contacts by email', error)
    found.push(...(data ?? []))
  }

  return indexContacts(found, externalSource)
}

export async function loadGiftMatchIndex(
  db: ImportClient,
  keys: { ids: string[]; externalIds: string[] },
  externalSource: string,
): Promise<GiftMatchIndex> {
  const ids = new Set<string>()
  const byExternalId = new Map<string, string>()
  const externalKeys = new Map<string, string>()
  const select = 'id, external_source, external_id'

  const absorb = (rows: readonly { id: string; external_source: string | null; external_id: string | null }[]) => {
    for (const row of rows) {
      ids.add(row.id)
      if (row.external_source && row.external_id) {
        externalKeys.set(row.id, externalKey(row.external_source, row.external_id))
        if (row.external_source === externalSource && !byExternalId.has(row.external_id)) {
          byExternalId.set(row.external_id, row.id)
        }
      }
    }
  }

  for (const batch of chunk(keys.ids, LOOKUP_CHUNK)) {
    const { data, error } = await db.from('gifts').select(select).in('id', batch)
    if (error) throw failed('Looking up gifts by id', error)
    absorb(data ?? [])
  }

  for (const batch of chunk(keys.externalIds, LOOKUP_CHUNK)) {
    const { data, error } = await db
      .from('gifts')
      .select(select)
      .eq('external_source', externalSource)
      .in('external_id', batch)
    if (error) throw failed('Looking up gifts by external ID', error)
    absorb(data ?? [])
  }

  return { ids, byExternalId, externalKeys }
}

/**
 * `preloaded` lets the commit path hand over the index it already built to
 * plan the batch. It is the same read, taken at the same moment; repeating it
 * would double the round-trips for an identical answer.
 *
 * Writes resolve a match and then insert or update, rather than using an
 * upsert on `(external_source, external_id)`. That index is partial — it
 * covers rows where `external_id is not null` — and Postgres will only infer
 * a partial index when the statement repeats its predicate, which PostgREST's
 * `on_conflict` cannot express. Matching first also lets a row without any
 * external id be recognised by email, which an upsert never could.
 */
export function createContactStore(
  db: ImportClient,
  actorId: string,
  externalSource: string,
  preloaded?: ContactMatchIndex,
): ContactStore {
  return {
    lookup: (keys) =>
      preloaded ? Promise.resolve(preloaded) : loadContactMatchIndex(db, keys, externalSource),

    async create(payload: ContactWritePayload) {
      const { data, error } = await db
        .from('contacts')
        .insert({ ...payload, created_by: actorId, updated_by: actorId })
        .select('id')
        .single()
      if (error) throw failed('Creating the contact', error)
      return data.id
    },

    async update(id: string, payload: ContactWritePayload) {
      const { data, error } = await db
        .from('contacts')
        .update({ ...payload, updated_by: actorId })
        .eq('id', id)
        .is('deleted_at', null)
        .select('id')
      if (error) throw failed('Updating the contact', error)
      // Row Level Security matching nothing looks exactly like a successful
      // no-op, so say plainly that the write was refused.
      if (!data || data.length === 0) {
        throw new Error('Updating the contact: it no longer exists, or permissions refused the change.')
      }
    },
  }
}

export function createGiftStore(
  db: ImportClient,
  actorId: string,
  externalSource: string,
  preloaded?: { gifts: GiftMatchIndex; contacts: ContactMatchIndex },
): GiftStore {
  return {
    lookupGifts: (keys) =>
      preloaded ? Promise.resolve(preloaded.gifts) : loadGiftMatchIndex(db, keys, externalSource),
    lookupContacts: (keys) =>
      preloaded
        ? Promise.resolve(preloaded.contacts)
        : loadContactMatchIndex(db, keys, externalSource),

    async create(payload: GiftCreatePayload) {
      // No activity row is written here: `gifts_log_activity` already posts
      // one, keyed on the gift id, and a second copy cannot be deduplicated.
      const { data, error } = await db
        .from('gifts')
        .insert({ ...payload, created_by: actorId })
        .select('id')
        .single()
      if (error) throw failed('Recording the gift', error)
      return data.id
    },

    async update(id: string, payload: GiftWritePayload) {
      const { data, error } = await db.from('gifts').update(payload).eq('id', id).select('id')
      if (error) throw failed('Updating the gift', error)
      if (!data || data.length === 0) {
        throw new Error('Updating the gift: it no longer exists, or only an admin may change giving records.')
      }
    },
  }
}
