'use server'

import { requireProfile } from '@/lib/auth'
import { sanitizeLikeTerm } from '@/lib/queries/search'
import { createClient } from '@/lib/supabase/server'
import { contactDisplayName } from '@/lib/utils'

/**
 * Backing search for the person picker used when linking a relative, adding an
 * attendee or naming a second donor.
 *
 * A `<select>` of every contact is unusable past a few hundred people and a
 * free-text box cannot produce an id, so the picker searches. It returns a
 * short list; the caller renders it as radio buttons, which are keyboard
 * operable and screen-reader legible without any combobox choreography.
 */

export interface PersonHit {
  id: string
  name: string
  /** Email or organisation — enough to tell two Susan Taylors apart. */
  detail: string | null
}

const LIMIT = 8

export async function findPeople(query: string, excludeId?: string): Promise<PersonHit[]> {
  await requireProfile()

  const term = sanitizeLikeTerm(query.trim())
  if (term.length < 2) return []

  const supabase = await createClient()
  const pattern = `%${term}%`
  const { data, error } = await supabase
    .from('contacts')
    .select('id, full_name, preferred_name, first_name, last_name, organization_name, email')
    .is('deleted_at', null)
    .or(
      `full_name.ilike.${pattern},preferred_name.ilike.${pattern},` +
        `organization_name.ilike.${pattern},email.ilike.${pattern}`,
    )
    .order('last_activity_at', { ascending: false, nullsFirst: false })
    .limit(LIMIT + 1)

  if (error) return []

  return (data ?? [])
    .filter((row) => row.id !== excludeId)
    .slice(0, LIMIT)
    .map((row) => ({
      id: row.id,
      name: contactDisplayName(row),
      detail: row.email ?? row.organization_name,
    }))
}
