import Link from 'next/link'
import { EVENT_KIND_LABELS } from '@/components/domain/development-badges'
import { LinkButton } from '@/components/ui/button'
import { EmptyState, PageHeader } from '@/components/ui/display'
import { SectionHeading } from '@/components/ui/tabs'
import { canWrite, requireProfile } from '@/lib/auth'
import { listEvents, type EventSummary } from '@/lib/queries/events'
import { formatDate, pluralize } from '@/lib/utils'

export const metadata = { title: 'Events' }

/**
 * Events, kept deliberately small.
 *
 * The brief: "Do not turn this into a full event-registration platform. The
 * goal is donor relationship context." So the list answers two questions —
 * what is coming up, and what happened — and every row leads to the only
 * screen that matters: who was there.
 */
export default async function EventsPage() {
  const profile = await requireProfile()
  const writable = canWrite(profile)
  const today = new Date().toISOString().slice(0, 10)
  const { upcoming, past } = await listEvents({ today })

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <PageHeader
        title="Events"
        description="Gatherings, and who was at them."
        action={writable ? <LinkButton href="/events/new" size="lg">Add event</LinkButton> : null}
      />

      {upcoming.length === 0 && past.length === 0 ? (
        <EmptyState
          title="No events yet"
          description="Record a banquet, a tour or a small dinner, then note who came. Attendance shows up on each person's record."
          action={writable ? <LinkButton href="/events/new">Add the first event</LinkButton> : null}
        />
      ) : null}

      {upcoming.length > 0 ? (
        <section className="space-y-3">
          <SectionHeading title="Coming up" />
          <EventRows events={upcoming} />
        </section>
      ) : null}

      {past.length > 0 ? (
        <section className="space-y-3">
          <SectionHeading title="Already happened" />
          <EventRows events={past} />
        </section>
      ) : null}
    </div>
  )
}

function EventRows({ events }: { events: EventSummary[] }) {
  return (
    <ul className="divide-y divide-slate-200 border-t border-slate-200">
      {events.map((event) => (
        <li key={event.id}>
          <Link
            href={`/events/${event.id}`}
            className="flex flex-wrap items-baseline gap-x-4 gap-y-1 py-3.5 transition-colors hover:bg-slate-50"
          >
            <span className="min-w-0 flex-1 basis-64">
              <span className="block text-[15px] font-medium text-slate-900">{event.name}</span>
              <span className="mt-0.5 block truncate text-sm text-slate-600">
                {EVENT_KIND_LABELS[event.kind]}
                {event.location ? ` · ${event.location}` : ''}
              </span>
            </span>
            <span className="w-32 shrink-0 text-sm tabular-nums text-slate-700">
              {formatDate(event.event_date)}
            </span>
            <span className="w-28 shrink-0 text-sm text-slate-500">
              {event.attendeeCount === 0
                ? 'No one yet'
                : event.attendedCount > 0
                  ? `${event.attendedCount} came`
                  : pluralize(event.attendeeCount, 'invited', 'invited')}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  )
}
