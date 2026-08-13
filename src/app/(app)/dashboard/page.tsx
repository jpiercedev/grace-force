import Link from 'next/link'
import { CalendarDays } from 'lucide-react'
import { EVENT_KIND_LABELS } from '@/components/domain/development-badges'
import { ProposalList } from '@/components/domain/proposal-list'
import { LinkButton } from '@/components/ui/button'
import { Callout, PageHeader } from '@/components/ui/display'
import { SectionHeading } from '@/components/ui/tabs'
import { canViewGiving, canWrite, requireProfile } from '@/lib/auth'
import {
  ATTENTION_LIMIT,
  getDashboardStats,
  listMyOverdueFollowUps,
  listMyUpcomingFollowUps,
  listRecentActivity,
  type DashboardStats,
} from '@/lib/queries/dashboard'
import { listUpcomingEvents } from '@/lib/queries/events'
import { listMyOpenProposals } from '@/lib/queries/proposals'
import { formatDate, pluralize } from '@/lib/utils'
import { ActivityPanel, FollowUpPanel } from './panels'

export const metadata = { title: 'Dashboard' }

type SearchParams = Record<string, string | string[] | undefined>

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

/**
 * The auth guards redirect here with `?denied=…` rather than showing a bare
 * 403, so the reason has to be explained on arrival — otherwise the redirect
 * looks like a bug.
 */
const DENIED_MESSAGES: Record<string, string> = {
  write: 'That page is for staff and administrators. Your account has read-only access.',
  admin: 'That page is for administrators only.',
  giving: 'Giving records and proposals are limited to administrators and staff granted access to them.',
}

/** "Wednesday, August 5" — the eyebrow above the greeting. Rendered server-side. */
const EYEBROW_DATE = new Intl.DateTimeFormat('en-US', {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
})

/**
 * One sentence answering the only question the dashboard exists for: what
 * should I do today?
 *
 * It replaces the three KPI tiles that used to sit here. A count in a box asks
 * to be interpreted; a sentence has already done the interpreting, and the
 * queue immediately below is where the number would have sent you anyway.
 */
function daySummary(stats: DashboardStats, writable: boolean): string {
  const leads = stats.newLeadsThisWeek ?? 0
  const leadClause = leads > 0 ? `${pluralize(leads, 'new lead')} came in this week` : null

  if (stats.overdueFollowUps > 0) {
    const urgent = `${pluralize(stats.overdueFollowUps, 'follow-up is', 'follow-ups are')} overdue`
    return leadClause ? `${urgent}, and ${leadClause}.` : `${urgent} — start there.`
  }
  if (stats.openFollowUps > 0) {
    return leadClause
      ? `Nothing is overdue, and ${leadClause}.`
      : `Nothing is overdue — ${pluralize(stats.openFollowUps, 'open follow-up is', 'open follow-ups are')} in hand.`
  }
  if (leadClause) return `Your follow-up list is clear, and ${leadClause}.`
  return writable
    ? 'Your follow-up list is clear — a good day to reach out to someone.'
    : 'Nothing needs your attention today. Enjoy the quiet.'
}

/**
 * The dashboard as a prioritised work queue.
 *
 * The brief was blunt about what it is not: "Do not create a wall of KPI
 * cards. Avoid decorative statistics." So there are no stat tiles at all. The
 * page opens with what is late, then what is due this week, then the three
 * things that need a decision — proposals in flight, gatherings coming up,
 * what the rest of the team has been doing — and stops.
 */
export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const profile = await requireProfile()
  const params = await searchParams

  // One clock for the whole render: the counts, the due-date windows and every
  // relative label have to agree with each other.
  const now = new Date()
  const today = now.toISOString().slice(0, 10)
  const writable = canWrite(profile)
  const showGiving = canViewGiving(profile)

  const [stats, overdue, upcoming, activity, proposals, events] = await Promise.all([
    getDashboardStats(profile.id, { includeLeads: writable }, now),
    listMyOverdueFollowUps(profile.id, ATTENTION_LIMIT, now),
    listMyUpcomingFollowUps(profile.id, ATTENTION_LIMIT, now),
    listRecentActivity(6),
    showGiving ? listMyOpenProposals(profile.id, 4) : Promise.resolve([]),
    listUpcomingEvents(today, 3),
  ])

  const firstName = profile.full_name?.trim().split(/\s+/)[0] ?? 'there'
  const denied = single(params.denied)
  const deniedMessage = denied ? DENIED_MESSAGES[denied] : undefined
  const nowIso = now.toISOString()

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        eyebrow={EYEBROW_DATE.format(now)}
        title={`Good to see you, ${firstName}`}
        description={daySummary(stats, writable)}
        action={
          writable ? (
            <LinkButton href="/follow-ups" size="lg">
              Work the queue
            </LinkButton>
          ) : null
        }
      />

      {deniedMessage ? (
        <Callout tone="warning" title="That page isn't available to you">
          {deniedMessage}
        </Callout>
      ) : null}

      <FollowUpPanel
        hero
        title="Needs attention"
        description="Overdue and assigned to you."
        items={overdue}
        emptyTitle="Nothing is overdue"
        emptyDescription="Everything you owe people is still in hand — enjoy the quiet."
        href="/follow-ups?segment=overdue"
        linkLabel="Open queue"
        nowIso={nowIso}
      />

      {/* New leads are the one inbound thing that goes stale if nobody looks,
          so they get a line of their own rather than only a mention in the
          summary sentence. Absent entirely when there are none. */}
      {writable && (stats.newLeadsThisWeek ?? 0) > 0 ? (
        <Link
          href="/leads"
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-card transition-colors hover:border-slate-300 hover:bg-slate-50"
        >
          <span>
            <span className="block text-[15px] font-medium text-slate-900">
              {pluralize(stats.newLeadsThisWeek ?? 0, 'new lead')} this week
            </span>
            <span className="block text-sm text-slate-600">
              Someone reached out and is waiting to hear back.
            </span>
          </span>
          <span className="text-sm font-medium text-brand-700">Triage them →</span>
        </Link>
      ) : null}

      <div className="grid items-start gap-x-8 gap-y-6 lg:grid-cols-2">
        <div className="min-w-0 space-y-6">
          <FollowUpPanel
            title="Due this week"
            description="The next seven days."
            items={upcoming}
            emptyTitle="A clear week ahead"
            emptyDescription={
              // Read-only accounts cannot schedule, so the nudge would mislead.
              writable
                ? 'Nothing is due in the next seven days. Schedule a follow-up and it will land here.'
                : 'Nothing is due in the next seven days. Follow-ups assigned to you will land here.'
            }
            href="/follow-ups?segment=week"
            linkLabel="Open queue"
            nowIso={nowIso}
          />

          {showGiving && proposals.length > 0 ? (
            <section className="space-y-3">
              <SectionHeading
                title="Your proposals"
                action={
                  <Link href="/proposals" className="text-sm font-medium text-brand-700 hover:underline">
                    All proposals
                  </Link>
                }
              />
              <ProposalList proposals={proposals} showContact nowIso={nowIso} />
            </section>
          ) : null}
        </div>

        <div className="min-w-0 space-y-6">
          {events.length > 0 ? (
            <section className="space-y-3">
              <SectionHeading
                title="Coming up"
                action={
                  <Link href="/events" className="text-sm font-medium text-brand-700 hover:underline">
                    All events
                  </Link>
                }
              />
              <ul className="divide-y divide-slate-200 border-t border-slate-200">
                {events.map((event) => (
                  <li key={event.id}>
                    <Link
                      href={`/events/${event.id}`}
                      className="flex items-center gap-3 py-3 transition-colors hover:bg-slate-50"
                    >
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-50 text-accent-700">
                        <CalendarDays aria-hidden="true" className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] font-medium text-slate-900">
                          {event.name}
                        </span>
                        <span className="block truncate text-sm text-slate-600">
                          {formatDate(event.event_date)}
                          {event.location ? ` · ${event.location}` : ''}
                          {` · ${EVENT_KIND_LABELS[event.kind]}`}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <ActivityPanel items={activity} nowIso={nowIso} />
        </div>
      </div>
    </div>
  )
}
