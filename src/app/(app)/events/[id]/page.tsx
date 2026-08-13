import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { removeAttendee, saveAttendee, updateEvent } from '@/app/(app)/events/actions'
import { EVENT_KIND_LABELS } from '@/components/domain/development-badges'
import { EventAttendees } from '@/components/domain/event-attendees'
import { EventForm } from '@/components/domain/event-form'
import { LinkButton } from '@/components/ui/button'
import { canWrite, requireProfile } from '@/lib/auth'
import { listTeamMembers } from '@/lib/queries/contacts'
import { getEvent } from '@/lib/queries/events'
import { formatDate } from '@/lib/utils'

type RouteParams = Promise<{ id: string }>
type SearchParams = Promise<Record<string, string | string[] | undefined>>

export async function generateMetadata({ params }: { params: RouteParams }): Promise<Metadata> {
  const { id } = await params
  const detail = await getEvent(id)
  return { title: detail?.event.name ?? 'Event' }
}

/**
 * One event, and the only thing anyone comes here for: who was there.
 *
 * Every attendee name links straight to their donor record, which is the whole
 * point — an event in this CRM exists to be a route into a relationship.
 */
export default async function EventPage({
  params,
  searchParams,
}: {
  params: RouteParams
  searchParams: SearchParams
}) {
  const profile = await requireProfile()
  const [{ id }, query] = await Promise.all([params, searchParams])

  const detail = await getEvent(id)
  if (!detail) notFound()

  const { event, attendees } = detail
  const writable = canWrite(profile)
  const editing = writable && (Array.isArray(query.edit) ? query.edit[0] : query.edit) === '1'

  if (editing) {
    const team = await listTeamMembers()
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <div>
          <Link href={`/events/${event.id}`} className="text-sm font-medium text-brand-700 hover:underline">
            ← Back to the event
          </Link>
          <h1 className="mt-2 text-xl font-bold leading-tight text-slate-900">
            Edit event
          </h1>
        </div>
        <EventForm
          event={event}
          team={team}
          defaultOwnerId={profile.id}
          today={event.event_date}
          action={updateEvent}
          submitLabel="Save changes"
          cancelHref={`/events/${event.id}`}
        />
      </div>
    )
  }

  const when = [
    formatDate(event.event_date),
    // A time column holds `18:30:00`; nobody says the seconds out loud.
    event.start_time ? event.start_time.slice(0, 5) : null,
  ]
    .filter(Boolean)
    .join(' at ')

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <header>
        <Link href="/events" className="text-sm font-medium text-brand-700 hover:underline">
          ← Events
        </Link>
        <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="break-words text-xl font-bold leading-tight text-slate-900 sm:text-2xl">
              {event.name}
            </h1>
            <p className="mt-1 text-[15px] text-slate-600">
              {when}
              {event.location ? ` · ${event.location}` : ''}
              {` · ${EVENT_KIND_LABELS[event.kind]}`}
            </p>
          </div>
          {writable ? (
            <LinkButton href={`/events/${event.id}?edit=1`} variant="secondary" size="lg">
              Edit
            </LinkButton>
          ) : null}
        </div>
        {event.description ? (
          <p className="mt-4 max-w-2xl whitespace-pre-wrap text-[15px] leading-relaxed text-slate-700">
            {event.description}
          </p>
        ) : null}
      </header>

      <EventAttendees
        eventId={event.id}
        eventName={event.name}
        attendees={attendees}
        canEdit={writable}
        saveAction={saveAttendee}
        removeAction={removeAttendee}
      />
    </div>
  )
}
