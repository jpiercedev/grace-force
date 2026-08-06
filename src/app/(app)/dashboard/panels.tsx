import { parseISO } from 'date-fns'
import Link from 'next/link'
import { CalendarClock, CircleCheckBig, KanbanSquare, Sparkles } from 'lucide-react'
import { ACTIVITY_TYPE_LABELS, FollowUpPriorityBadge } from '@/components/domain/contact-badges'
import { LinkButton } from '@/components/ui/button'
import {
  Avatar,
  Badge,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  badgeTone,
} from '@/components/ui/display'
import type {
  DashboardActivity,
  DashboardFollowUp,
  DashboardPipelineGroup,
} from '@/lib/queries/dashboard'
import type { GivingSnapshot } from '@/lib/queries/giving'
import {
  cn,
  formatCurrency,
  formatDate,
  formatDateTime,
  formatRelative,
  isOverdue,
} from '@/lib/utils'

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
 */

/**
 * `expected_close_on` and `given_on` are DATE columns. `new Date('2026-08-05')`
 * reads as UTC midnight and then formats a day early west of Greenwich, so the
 * string is parsed as a local calendar day first.
 */
function formatDay(value: string): string {
  return formatDate(parseISO(value))
}

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
  /** The "Needs attention" treatment: serif heading, avatar rows, primary action. */
  hero?: boolean
}) {
  const now = new Date(nowIso)

  if (hero) {
    return (
      <Card>
        {/* The one serif card heading on the page — this panel is why you came in. */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200/70 px-5 py-4">
          <div className="min-w-0">
            <h2 className="font-display text-xl font-semibold tracking-tight text-slate-900">
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
        <h2
          id="recent-activity-heading"
          className="text-xs font-semibold uppercase tracking-wider text-slate-500"
        >
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

export function PipelinePanel({ groups }: { groups: DashboardPipelineGroup[] }) {
  return (
    <Card>
      <CardHeader
        title="My pipeline"
        description="Open cards you own, by process."
        action={
          <LinkButton href="/pipelines" variant="secondary" size="sm">
            All pipelines
          </LinkButton>
        }
      />
      {groups.length === 0 ? (
        <EmptyState
          icon={<KanbanSquare className="h-5 w-5" aria-hidden="true" />}
          title="No cards carry your name"
          description="When you own a card on any pipeline board, it will keep its place here."
        />
      ) : (
        <ul className="divide-y divide-slate-100">
          {groups.map((group) => (
            <li key={group.id} className="px-5 py-3.5">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <Link
                  href={`/pipelines/${group.slug}`}
                  className="text-sm font-semibold text-brand-700 underline-offset-2 hover:underline"
                >
                  {group.name}
                </Link>
                {group.value_cents !== null ? (
                  <span className="text-xs text-slate-500">
                    Open value{' '}
                    <span className="font-semibold tabular-nums text-slate-900">
                      {formatCurrency(group.value_cents)}
                    </span>
                  </span>
                ) : null}
              </div>
              <ul className="mt-2 space-y-2.5">
                {group.cards.map((card) => (
                  // Two fixed lines (badge + title, then meta) so every card
                  // stacks the same way instead of wrapping unpredictably.
                  <li key={card.id}>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      {/* Tone follows the stage's own colour, matching the board. */}
                      <Badge tone={badgeTone(card.stage_color)}>{card.stage_name}</Badge>
                      <span className="min-w-0 text-sm text-slate-900">{card.title}</span>
                    </div>
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-sm text-slate-500">
                      <ContactLink contact={card.contact} />
                      {card.value_cents !== null ? (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="tabular-nums">{formatCurrency(card.value_cents)}</span>
                        </>
                      ) : null}
                      {card.expected_close_on ? (
                        <>
                          <span aria-hidden="true">·</span>
                          <time dateTime={card.expected_close_on}>
                            Closes {formatDay(card.expected_close_on)}
                          </time>
                        </>
                      ) : null}
                    </p>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

/**
 * Rendered only for profiles that pass `canViewGiving`. The caller omits it
 * entirely otherwise, rather than showing an empty box that hints at data the
 * reader is not allowed to see. It sits below the work panels on purpose:
 * giving is context for the day, not a task on it.
 */
export function GivingStrip({ snapshot }: { snapshot: GivingSnapshot }) {
  const hasGiving = snapshot.recent.length > 0 || snapshot.yearToDateCents > 0

  return (
    <Card>
      <CardHeader
        title="Giving"
        description="Generosity in context."
        action={
          <LinkButton href="/giving" variant="secondary" size="sm">
            Open giving
          </LinkButton>
        }
      />
      <CardBody className="grid gap-x-10 gap-y-5 sm:grid-cols-[11rem,minmax(0,1fr)]">
        {/* Ledger totals in the quiet serif voice, beside the recent entries. */}
        <dl className="flex flex-wrap gap-x-10 gap-y-5 sm:flex-col sm:gap-y-6">
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              This month
            </dt>
            <dd className="mt-1.5 font-display text-[1.75rem] font-semibold leading-none tabular-nums text-slate-900">
              {formatCurrency(snapshot.monthToDateCents)}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wider text-slate-500">
              Year to date
            </dt>
            <dd className="mt-1.5 font-display text-[1.75rem] font-semibold leading-none tabular-nums text-slate-900">
              {formatCurrency(snapshot.yearToDateCents)}
            </dd>
          </div>
        </dl>

        {hasGiving ? (
          <ul className="divide-y divide-slate-100 border-t border-slate-200/70 pt-1 sm:border-l sm:border-t-0 sm:pl-10 sm:pt-0">
            {snapshot.recent.map((gift) => (
              <li
                key={gift.id}
                className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 py-2 first:pt-2 last:pb-0 sm:first:pt-0"
              >
                <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 text-sm">
                  <ContactLink contact={gift.contact} />
                  {gift.fund ? <span className="text-xs text-slate-500">{gift.fund}</span> : null}
                </span>
                {/* Fixed-width date column right-aligns every amount above the
                    one below it; ml-auto keeps the pair flush right when the
                    row wraps on narrow screens. */}
                <span className="ml-auto flex items-baseline gap-2 text-sm">
                  <span className="font-semibold tabular-nums text-slate-900">
                    {formatCurrency(gift.amount_cents, gift.currency)}
                  </span>
                  <time className="w-24 text-right text-xs text-slate-500" dateTime={gift.given_on}>
                    {formatDay(gift.given_on)}
                  </time>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm leading-relaxed text-slate-600 sm:border-l sm:border-slate-200/70 sm:pl-10">
            No gifts have been recorded yet. Import a giving history and totals will appear here.
          </p>
        )}
      </CardBody>
    </Card>
  )
}
