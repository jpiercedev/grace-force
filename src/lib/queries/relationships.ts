import 'server-only'

import { cache } from 'react'
import { CONTACT_REF_FIELDS, toContactRef, type ContactRef } from '@/lib/queries/dashboard'
import {
  RELATIONSHIP_INVERSE_LABELS,
  RELATIONSHIP_LABELS,
  isSymmetricRelationship,
} from '@/lib/relationships'
import { createClient } from '@/lib/supabase/server'
import type {
  ContactCapabilityRow,
  InterestAreaRow,
  RelationshipKind,
} from '@/types/database'

/**
 * The donor-profile reads: who they are connected to, what they care about,
 * and — behind the giving permission — what they may be capable of.
 */

function fail(what: string, error: { message: string }): never {
  throw new Error(`Could not load ${what}: ${error.message}`)
}

// --- Related constituents ---------------------------------------------------

export interface RelatedPerson {
  /** The link row, so it can be edited or removed. */
  id: string
  contact: ContactRef
  kind: RelationshipKind
  /** Already resolved for the viewing contact — no direction logic downstream. */
  label: string
  note: string | null
  /** True when this contact sits on the `to` side of the stored row. */
  incoming: boolean
}

const LINK_SELECT = `
  id, kind, note, from_contact_id, to_contact_id,
  from_contact:contacts!contact_relationships_from_contact_id_fkey(${CONTACT_REF_FIELDS}),
  to_contact:contacts!contact_relationships_to_contact_id_fkey(${CONTACT_REF_FIELDS})
`

interface LinkRow {
  id: string
  kind: RelationshipKind
  note: string | null
  from_contact_id: string
  to_contact_id: string
  from_contact: { id: string; deleted_at?: string | null } | null
  to_contact: { id: string } | null
}

/**
 * Both directions in one read, resolved to the label the *viewer* should see.
 *
 * A stored row means "<from> is the <kind> of <to>", so which label applies
 * depends on which side this contact is standing on. Doing that here means no
 * component ever has to think about direction — it receives a name and a word.
 */
export async function getRelatedPeople(contactId: string): Promise<RelatedPerson[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('contact_relationships')
    .select(LINK_SELECT)
    .or(`from_contact_id.eq.${contactId},to_contact_id.eq.${contactId}`)
    .order('created_at', { ascending: true })

  if (error) fail('related people', error)

  const people: RelatedPerson[] = []
  for (const raw of (data ?? []) as unknown as LinkRow[]) {
    const incoming = raw.to_contact_id === contactId
    const other = toContactRef(
      (incoming ? raw.from_contact : raw.to_contact) as never,
    )
    // A hard-deleted counterpart leaves an unreadable row rather than a broken
    // one: RLS or a cascade may have removed the other side.
    if (!other) continue

    people.push({
      id: raw.id,
      contact: other,
      kind: raw.kind,
      label: incoming ? RELATIONSHIP_LABELS[raw.kind] : RELATIONSHIP_INVERSE_LABELS[raw.kind],
      note: raw.note,
      incoming,
    })
  }

  // Family first, then everyone else, each alphabetical — a household should
  // read as a household rather than in insertion order.
  const familyFirst = new Set<RelationshipKind>(['spouse', 'partner', 'child', 'parent', 'sibling', 'family_member'])
  return people.sort((a, b) => {
    const rank = Number(familyFirst.has(b.kind)) - Number(familyFirst.has(a.kind))
    return rank !== 0 ? rank : a.contact.name.localeCompare(b.contact.name)
  })
}

/**
 * True when this pair is already linked in a way that would make a new row a
 * duplicate statement of the same fact. Symmetric kinds match in either
 * direction; asymmetric ones only in the direction being written.
 */
export async function relationshipExists(
  fromContactId: string,
  toContactId: string,
  kind: RelationshipKind,
): Promise<boolean> {
  const supabase = await createClient()
  let query = supabase.from('contact_relationships').select('id').eq('kind', kind).limit(1)

  query = isSymmetricRelationship(kind)
    ? query.or(
        `and(from_contact_id.eq.${fromContactId},to_contact_id.eq.${toContactId}),` +
          `and(from_contact_id.eq.${toContactId},to_contact_id.eq.${fromContactId})`,
      )
    : query.eq('from_contact_id', fromContactId).eq('to_contact_id', toContactId)

  const { data, error } = await query
  if (error) fail('existing relationships', error)
  return (data ?? []).length > 0
}

// --- Interests --------------------------------------------------------------

export interface ContactInterest {
  id: string
  areaId: string
  label: string
  note: string | null
}

export const listInterestAreas = cache(async (): Promise<InterestAreaRow[]> => {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('interest_areas')
    .select('*')
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
    .order('label', { ascending: true })

  if (error) fail('interest areas', error)
  return data ?? []
})

export async function getContactInterests(contactId: string): Promise<ContactInterest[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('contact_interests')
    .select('id, note, interest_area_id, interest_areas(id, label, sort_order)')
    .eq('contact_id', contactId)

  if (error) fail('interests', error)

  const rows = (data ?? []) as unknown as Array<{
    id: string
    note: string | null
    interest_area_id: string
    interest_areas: { id: string; label: string; sort_order: number } | null
  }>

  return rows
    .filter((row) => row.interest_areas !== null)
    .sort((a, b) => (a.interest_areas!.sort_order - b.interest_areas!.sort_order))
    .map((row) => ({
      id: row.id,
      areaId: row.interest_area_id,
      label: row.interest_areas!.label,
      note: row.note,
    }))
}

// --- Giving capability ------------------------------------------------------

/**
 * Returns null both when nothing has been recorded and when the viewer lacks
 * the giving capability — RLS makes those indistinguishable here, and the
 * caller checks the permission before deciding whether to render the section
 * at all, so the ambiguity never reaches a person.
 */
export async function getContactCapability(
  contactId: string,
): Promise<ContactCapabilityRow | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('contact_capability')
    .select('*')
    .eq('contact_id', contactId)
    .maybeSingle()

  if (error) fail('giving capability', error)
  return data ?? null
}
