import 'server-only'

import { CONTACT_REF_FIELDS, toContactRef, type ContactRef } from '@/lib/queries/dashboard'
import { createClient } from '@/lib/supabase/server'
import type { EventAttendance, EventRow } from '@/types/database'

/**
 * Reads for events and attendance.
 *
 * Everything here answers one of two questions: "who was at this?" and "what
 * has this donor been to?". Anything an event-registration platform would also
 * want to know is deliberately not asked.
 */

function fail(what: string, error: { message: string }): never {
  throw new Error(`Could not load ${what}: ${error.message}`)
}

export const EVENT_PAGE_SIZE = 50

export interface EventSummary extends EventRow {
  attendeeCount: number
  attendedCount: number
}

/**
 * Upcoming events ascending then past events descending: the list reads
 * outward from today in both directions, which is how someone scanning for
 * "the next one" and "the last one" actually looks.
 */
export async function listEvents(options: { today: string }): Promise<{
  upcoming: EventSummary[]
  past: EventSummary[]
}> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('events')
    .select('*, event_attendees(id, status)')
    .order('event_date', { ascending: false })
    .limit(EVENT_PAGE_SIZE)

  if (error) fail('events', error)

  const rows = (data ?? []) as unknown as Array<
    EventRow & { event_attendees: Array<{ id: string; status: EventAttendance }> }
  >

  const summaries = rows.map(({ event_attendees, ...event }): EventSummary => ({
    ...event,
    attendeeCount: event_attendees.length,
    attendedCount: event_attendees.filter((a) => a.status === 'attended').length,
  }))

  return {
    upcoming: summaries
      .filter((event) => event.event_date >= options.today)
      .sort((a, b) => a.event_date.localeCompare(b.event_date)),
    past: summaries.filter((event) => event.event_date < options.today),
  }
}

export interface EventAttendeeEntry {
  id: string
  status: EventAttendance
  note: string | null
  contact: ContactRef
}

export interface EventDetail {
  event: EventRow
  attendees: EventAttendeeEntry[]
}

export async function getEvent(id: string): Promise<EventDetail | null> {
  const supabase = await createClient()

  const [{ data: event, error: eventError }, { data: attendees, error: attendeeError }] =
    await Promise.all([
      supabase.from('events').select('*').eq('id', id).maybeSingle(),
      supabase
        .from('event_attendees')
        .select(`id, status, note, contact:contacts(${CONTACT_REF_FIELDS})`)
        .eq('event_id', id),
    ])

  if (eventError) fail('the event', eventError)
  if (attendeeError) fail('the attendee list', attendeeError)
  if (!event) return null

  const entries: EventAttendeeEntry[] = []
  for (const raw of (attendees ?? []) as unknown as Array<{
    id: string
    status: EventAttendance
    note: string | null
    contact: never
  }>) {
    const contact = toContactRef(raw.contact)
    if (!contact) continue
    entries.push({ id: raw.id, status: raw.status, note: raw.note, contact })
  }

  entries.sort((a, b) => a.contact.name.localeCompare(b.contact.name))
  return { event, attendees: entries }
}

export interface ContactEventEntry {
  id: string
  status: EventAttendance
  note: string | null
  event: Pick<EventRow, 'id' | 'name' | 'event_date' | 'location' | 'kind'>
}

/** What this donor has been to — the Events tab on their record. */
export async function getContactEvents(contactId: string): Promise<ContactEventEntry[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('event_attendees')
    .select('id, status, note, events(id, name, event_date, location, kind)')
    .eq('contact_id', contactId)

  if (error) fail('events for this person', error)

  const rows = (data ?? []) as unknown as Array<{
    id: string
    status: EventAttendance
    note: string | null
    events: ContactEventEntry['event'] | null
  }>

  return rows
    .filter((row) => row.events !== null)
    .map((row) => ({ id: row.id, status: row.status, note: row.note, event: row.events! }))
    .sort((a, b) => b.event.event_date.localeCompare(a.event.event_date))
}

/** The event picker when adding attendance from a donor record. */
export async function listEventOptions(): Promise<
  Array<Pick<EventRow, 'id' | 'name' | 'event_date'>>
> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('events')
    .select('id, name, event_date')
    .order('event_date', { ascending: false })
    .limit(EVENT_PAGE_SIZE)

  if (error) fail('events', error)
  return data ?? []
}

/** The next few gatherings, for the dashboard. */
export async function listUpcomingEvents(today: string, limit = 4): Promise<EventRow[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from('events')
    .select('*')
    .gte('event_date', today)
    .order('event_date', { ascending: true })
    .limit(limit)

  if (error) fail('upcoming events', error)
  return data ?? []
}
