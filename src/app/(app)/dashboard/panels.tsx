import Link from 'next/link'
import { CalendarClock, CircleCheckBig, Sparkles } from 'lucide-react'
import { ACTIVITY_TYPE_LABELS, FollowUpPriorityBadge } from '@/components/domain/contact-badges'
import { LinkButton } from '@/components/ui/button'
import { Avatar, Badge, badgeTone, Card, CardHeader, EmptyState } from '@/components/ui/display'
import type { DashboardActivity, DashboardFollowUp } from '@/lib/queries/dashboard'
import type { OpportunityListItem } from '@/lib/queries/pipelines'
import { cn, contactDisplayName, formatCurrency, formatDate, formatDateTime, formatRelative, isOverdue } from '@/lib/utils'

/**
 * Dashboard panels.
 *
 * Server components: nothing here is interactive, and the whole page is a
 * read. Each panel owns its own empty state, because a fresh install shows
 * every one of them at once and "nothing yet" has to read as calm rather than
 * broken.
 *
 * The page is deliberately not five equal boxes: "Needs attention" leads in a
 * hero treatment, the week's work follows, and the activity feed sits directly
 * on the canvas as a quieter story rail.
 *
 * The pipeline summary and giving strip that used to live here are gone. Both
 * were summaries of the CRM rather than work waiting on a person, and both
 * have destinations of their own — which is exactly the distinction the
 * dashboard now draws.
 */

function ContactLink({ contact }: { contact: { id: string; name: string } | null }) {
  // Italic marks the placeholder as not-a-name; slate-500 keeps it readable (AA).
  if (!contact) return <span className="italic text-slate-500">Unknown contact</span>
  return (
    <Link
      href={`/contacts/${contact.id}`}
      className="font-medium text-brand-700 underline-offset-2 hover:underline"
    >
      {contact.name}
    </Link>
  )
}

function DueLabel({
  dueAt,
  now,
  className,
}: {
  dueAt: string
  now: Date
  className?: string
}) {
  const overdue = isOverdue(dueAt, now)
  return (
    // Colour never carries "overdue" on its own; the word is there too.
    <time
      dateTime={dueAt}
      title={formatDateTime(dueAt)}
      className={cn(overdue ? 'font-medium text-red-700' : undefined, className)}
    >
      {overdue ? `Overdue ${formatRelative(dueAt, now)}` : `Due ${formatRelative(dueAt, now)}`}
    </time>
  )
}

export function FollowUpPanel({
  title,
  description,
  items,
  emptyTitle,
  emptyDescription,
  href,
  linkLabel,
  nowIso,
  hero = false,
}: {
  title: string
  description: string
  items: DashboardFollowUp[]
  emptyTitle: string
  emptyDescription: string
  href: string
  linkLabel: string
  nowIso: string
  /** The "Needs attention" treatment: stronger header, avatar rows, primary action. */
  hero?: boolean
}) {
  const now = new Date(nowIso)

  if (hero) {
    return (
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-slate-900">
              {title}
            </h2>
            <p className="mt-0.5 text-sm text-slate-500">{description}</p>
          </div>
          {/* Primary only while there is work behind it; a loud button over an
              empty list would nag. */}
          <LinkButton href={href} variant={items.length > 0 ? 'primary' : 'secondary'} size="sm">
            {linkLabel}
          </LinkButton>
        </div>
        {items.length === 0 ? (
          <EmptyState
            icon={<CircleCheckBig className="h-5 w-5" aria-hidden="true" />}
            title={emptyTitle}
            description={emptyDescription}
          />
        ) : (
          <ul className="divide-y divide-slate-100">
            {items.map((item) => (
              <li key={item.id} className="flex items-start gap-3 px-5 py-3.5 sm:items-center sm:gap-4">
                <Avatar name={item.contact?.name ?? 'Unknown contact'} size="md" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium leading-snug text-slate-900">{item.title}</p>
                  <p className="mt-0.5 text-sm leading-snug">
                    <ContactLink contact={item.contact} />
                  </p>
                  {/* On a phone the chip and due label sit under the words —
                      three columns in 390px would crush the title. */}
                  <p className="mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 sm:hidden">
                    <FollowUpPriorityBadge priority={item.priority} />
                    <DueLabel
                      dueAt={item.due_at}
                      now={now}
                      className={cn(
                        'text-sm tabular-nums',
                        !isOverdue(item.due_at, now) && 'text-slate-500',
                      )}
                    />
                  </p>
                </div>
                {/* From sm up, chip + due label form a scannable right column. */}
                <div className="hidden shrink-0 items-center gap-x-4 sm:flex">
                  <FollowUpPriorityBadge priority={item.priority} />
                  <DueLabel
                    dueAt={item.due_at}
                    now={now}
                    className={cn(
                      'w-32 whitespace-nowrap text-right text-sm tabular-nums',
                      !isOverdue(item.due_at, now) && 'text-slate-500',
                    )}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader
        title={title}
        description={description}
        action={
          <LinkButton href={href} variant="secondary" size="sm">
            {linkLabel}
          </LinkButton>
        }
      />
      {items.length === 0 ? (
        <EmptyState
          icon={<CalendarClock className="h-5 w-5" aria-hidden="true" />}
          title={emptyTitle}
          description={emptyDescription}
        />
      ) : (
        <ul className="divide-y divide-slate-100">
          {items.map((item) => (
            <li key={item.id} className="px-5 py-3">
              <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                <p className="min-w-0 text-sm font-medium text-slate-900">{item.title}</p>
                <FollowUpPriorityBadge priority={item.priority} />
              </div>
              <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-sm text-slate-500">
                <ContactLink contact={item.contact} />
                <span aria-hidden="true">·</span>
                <DueLabel dueAt={item.due_at} now={now} />
              </p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

/**
 * Open opportunities expected to close inside the panel's window, soonest
 * first. No EmptyState treatment when the list is empty: on most mornings
 * "nothing closing" is one calm line, not an event that needs an icon.
 */
export function ClosingSoonPanel({
  items,
  today,
}: {
  items: OpportunityListItem[]
  /** ISO date (YYYY-MM-DD) — the page's one clock, so "overdue" matches the queries. */
  today: string
}) {
  return (
    <Card>
      <CardHeader
        title="Closing soon"
        description="Expected to close in the next 30 days."
        action={
          <LinkButton href="/sales" variant="secondary" size="sm">
            All opportunities
          </LinkButton>
        }
      />
      {items.length === 0 ? (
        <p className="px-5 py-4 text-sm text-slate-500">
          Nothing is scheduled to close in the next 30 days.
        </p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {items.map((item) => {
            // Dates, not timestamps: a card expected to close "today" is on
            // time all day, so only a strictly earlier date reads as overdue.
            const overdue = item.expected_close_on !== null && item.expected_close_on < today
            return (
              <li key={item.id} className="px-5 py-3">
                <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                  <p className="min-w-0 text-sm font-medium text-slate-900">
                    {item.pipeline ? (
                      <Link
                        href={`/pipelines/${item.pipeline.slug}`}
                        className="hover:text-brand-700 hover:underline"
                      >
                        {item.title}
                      </Link>
                    ) : (
                      item.title
                    )}
                  </p>
                  {item.stage ? (
                    <Badge tone={badgeTone(item.stage.color)}>{item.stage.name}</Badge>
                  ) : null}
                </div>
                <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-sm text-slate-500">
                  <ContactLink
                    contact={
                      item.contact
                        ? { id: item.contact.id, name: contactDisplayName(item.contact) }
                        : null
                    }
                  />
                  {item.pipeline?.tracks_value && item.value_cents !== null ? (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="tabular-nums text-slate-600">
                        {formatCurrency(item.value_cents, item.currency)}
                      </span>
                    </>
                  ) : null}
                  {item.expected_close_on ? (
                    <>
                      <span aria-hidden="true">·</span>
                      {/* Colour never carries "overdue" on its own; the word is there too. */}
                      <time
                        dateTime={item.expected_close_on}
                        className={overdue ? 'font-medium text-red-700' : undefined}
                      >
                        {formatDate(item.expected_close_on)}
                        {overdue ? ' · overdue' : ''}
                      </time>
                    </>
                  ) : null}
                </p>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}

/**
 * The team's story, told quietly: no card, just a labelled rail sitting on the
 * canvas with hairlines between entries — context, not a queue.
 */
export function ActivityPanel({
  items,
  nowIso,
}: {
  items: DashboardActivity[]
  nowIso: string
}) {
  const now = new Date(nowIso)

  return (
    <section aria-labelledby="recent-activity-heading">
      <div className="border-b border-slate-200 pb-2.5">
        <h2 id="recent-activity-heading" className="text-sm font-semibold text-slate-900">
          Recent activity
        </h2>
      </div>
      {items.length === 0 ? (
        <EmptyState
          icon={<Sparkles className="h-5 w-5" aria-hidden="true" />}
          title="The story starts here"
          description="Calls, notes, gifts and pipeline moves from the whole team gather here as they happen."
        />
      ) : (
        <ol className="divide-y divide-slate-200/70">
          {items.map((item) => {
            const subject = item.subject?.trim()
            return (
              <li key={item.id} className="flex gap-3 py-3">
                <Avatar
                  name={item.contact?.name ?? ACTIVITY_TYPE_LABELS[item.type]}
                  size="sm"
                  className="mt-0.5"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm leading-snug text-slate-900">
                    <ContactLink contact={item.contact} />{' '}
                    <span className="text-slate-600">— {subject || ACTIVITY_TYPE_LABELS[item.type]}</span>
                  </p>
                  {item.body ? (
                    <p className="mt-0.5 line-clamp-1 text-[13px] leading-snug text-slate-600">
                      {item.body}
                    </p>
                  ) : null}
                  <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-slate-600">
                    {/* The type label only appears when the headline is a subject —
                        otherwise the headline already is this label, verbatim. */}
                    {subject ? (
                      <>
                        <span>{ACTIVITY_TYPE_LABELS[item.type]}</span>
                        <span aria-hidden="true">·</span>
                      </>
                    ) : null}
                    {item.actor ? (
                      <>
                        <span>{item.actor}</span>
                        <span aria-hidden="true">·</span>
                      </>
                    ) : null}
                    <time dateTime={item.occurred_at} title={formatDateTime(item.occurred_at)}>
                      {formatRelative(item.occurred_at, now)}
                    </time>
                  </p>
                </div>
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}
