import { parseISO } from 'date-fns'
import Link from 'next/link'
import { ACTIVITY_TYPE_LABELS, FollowUpPriorityBadge } from '@/components/domain/contact-badges'
import { LinkButton } from '@/components/ui/button'
import { Badge, Card, CardBody, CardHeader, EmptyState } from '@/components/ui/display'
import type {
  DashboardActivity,
  DashboardFollowUp,
  DashboardPipelineGroup,
} from '@/lib/queries/dashboard'
import type { GivingSnapshot } from '@/lib/queries/giving'
import { formatCurrency, formatDate, formatDateTime, formatRelative, isOverdue } from '@/lib/utils'

/**
 * Dashboard panels.
 *
 * Server components: nothing here is interactive, and the whole page is a
 * read. Each panel owns its own empty state, because a fresh install shows
 * every one of them at once and "nothing yet" has to read as calm rather than
 * broken.
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
  if (!contact) return <span className="text-slate-400">Unknown contact</span>
  return (
    <Link
      href={`/contacts/${contact.id}`}
      className="font-medium text-brand-700 underline-offset-2 hover:underline"
    >
      {contact.name}
    </Link>
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
}: {
  title: string
  description: string
  items: DashboardFollowUp[]
  emptyTitle: string
  emptyDescription: string
  href: string
  linkLabel: string
  nowIso: string
}) {
  const now = new Date(nowIso)

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
        <EmptyState title={emptyTitle} description={emptyDescription} />
      ) : (
        <ul className="divide-y divide-slate-100">
          {items.map((item) => (
            <li key={item.id} className="px-4 py-3">
              <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                <p className="min-w-0 text-sm font-medium text-slate-900">{item.title}</p>
                <FollowUpPriorityBadge priority={item.priority} />
              </div>
              <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-slate-500">
                <ContactLink contact={item.contact} />
                <span aria-hidden="true">·</span>
                {/* Colour never carries "overdue" on its own; the word is there too. */}
                <time
                  dateTime={item.due_at}
                  title={formatDateTime(item.due_at)}
                  className={isOverdue(item.due_at, now) ? 'font-medium text-red-700' : undefined}
                >
                  {isOverdue(item.due_at, now)
                    ? `Overdue ${formatRelative(item.due_at, now)}`
                    : `Due ${formatRelative(item.due_at, now)}`}
                </time>
              </p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

export function ActivityPanel({
  items,
  nowIso,
}: {
  items: DashboardActivity[]
  nowIso: string
}) {
  const now = new Date(nowIso)

  return (
    <Card>
      <CardHeader
        title="Recent activity"
        description="What has happened across every relationship."
      />
      {items.length === 0 ? (
        <EmptyState
          title="Nothing has happened yet"
          description="Calls, notes, gifts and pipeline moves all land here as soon as anyone logs one."
        />
      ) : (
        <ul className="divide-y divide-slate-100">
          {items.map((item) => (
            <li key={item.id} className="px-4 py-3">
              <p className="text-sm font-medium text-slate-900">
                {item.subject?.trim() || ACTIVITY_TYPE_LABELS[item.type]}
              </p>
              {item.body ? (
                <p className="mt-0.5 line-clamp-2 text-sm text-slate-600">{item.body}</p>
              ) : null}
              {/* The type is repeated in text because the panel carries no icon. */}
              <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-slate-500">
                <ContactLink contact={item.contact} />
                <span aria-hidden="true">·</span>
                <span>{ACTIVITY_TYPE_LABELS[item.type]}</span>
                {item.actor ? (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>{item.actor}</span>
                  </>
                ) : null}
                <span aria-hidden="true">·</span>
                <time dateTime={item.occurred_at} title={formatDateTime(item.occurred_at)}>
                  {formatRelative(item.occurred_at, now)}
                </time>
              </p>
            </li>
          ))}
        </ul>
      )}
    </Card>
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
          title="No cards assigned to you"
          description="Cards you own on any pipeline board will be listed here."
        />
      ) : (
        <ul className="divide-y divide-slate-100">
          {groups.map((group) => (
            <li key={group.id} className="px-4 py-3">
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
              <ul className="mt-2 space-y-2">
                {group.cards.map((card) => (
                  <li key={card.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                    <Badge tone="violet">{card.stage_name}</Badge>
                    <span className="min-w-0 text-sm text-slate-900">{card.title}</span>
                    <span className="flex flex-wrap items-center gap-x-1.5 text-xs text-slate-500">
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
                    </span>
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
 * reader is not allowed to see.
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
      <CardBody className="space-y-4">
        <dl className="grid gap-4 sm:grid-cols-2">
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
              This month
            </dt>
            <dd className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">
              {formatCurrency(snapshot.monthToDateCents)}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Year to date
            </dt>
            <dd className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">
              {formatCurrency(snapshot.yearToDateCents)}
            </dd>
          </div>
        </dl>

        {hasGiving ? (
          <ul className="divide-y divide-slate-100 border-t border-slate-100">
            {snapshot.recent.map((gift) => (
              <li
                key={gift.id}
                className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 pt-2 first:pt-3"
              >
                <span className="flex flex-wrap items-center gap-x-1.5 text-sm">
                  <ContactLink contact={gift.contact} />
                  {gift.fund ? <span className="text-xs text-slate-500">{gift.fund}</span> : null}
                </span>
                <span className="flex items-center gap-2 text-sm">
                  <span className="font-semibold tabular-nums text-slate-900">
                    {formatCurrency(gift.amount_cents, gift.currency)}
                  </span>
                  <time className="text-xs text-slate-500" dateTime={gift.given_on}>
                    {formatDay(gift.given_on)}
                  </time>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-500">
            No gifts have been recorded yet. Import a giving history and totals will appear here.
          </p>
        )}
      </CardBody>
    </Card>
  )
}
