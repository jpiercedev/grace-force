import Link from 'next/link'
import type { ReactNode } from 'react'
import {
  CONTACT_SOURCE_LABELS,
  FollowUpPriorityBadge,
  MAILCHIMP_ACTION_LABELS,
} from '@/components/domain/contact-badges'
import { Badge, Card, CardBody, CardHeader, EmptyState } from '@/components/ui/display'
import type {
  ContactEmailEngagement,
  ContactFollowUp,
  ContactGiving,
} from '@/lib/queries/contacts'
import { cn, formatCurrency, formatDate, formatDateTime, formatRelative, isOverdue } from '@/lib/utils'
import type { ContactRow } from '@/types/database'

/**
 * The right rail of the contact record: the reference facts, and the
 * summaries the relationship is actually judged on.
 *
 * All server components — nothing here is interactive.
 */

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-3 gap-2 py-1.5">
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="col-span-2 break-words text-sm text-slate-800">{children}</dd>
    </div>
  )
}

function addressLines(contact: ContactRow): string[] {
  const cityLine = [contact.city, contact.region].filter(Boolean).join(', ')
  return [
    contact.address_line1,
    contact.address_line2,
    [cityLine, contact.postal_code].filter(Boolean).join(' '),
    contact.country,
  ]
    .map((line) => line?.trim() ?? '')
    .filter((line) => line !== '')
}

export function ContactDetailsPanel({ contact }: { contact: ContactRow }) {
  const address = addressLines(contact)

  return (
    <Card>
      <CardHeader title="Details" />
      <CardBody>
        <dl className="divide-y divide-slate-100">
          <Row label="Email">
            {contact.email ? (
              <a href={`mailto:${contact.email}`} className="text-brand-700 hover:underline">
                {contact.email}
              </a>
            ) : (
              <Muted>Not recorded</Muted>
            )}
            {contact.secondary_email ? (
              <a
                href={`mailto:${contact.secondary_email}`}
                className="mt-0.5 block text-brand-700 hover:underline"
              >
                {contact.secondary_email}
              </a>
            ) : null}
          </Row>

          <Row label="Phone">
            {contact.phone || contact.mobile_phone ? (
              <>
                {contact.phone ? (
                  <a href={`tel:${contact.phone}`} className="block hover:underline">
                    {contact.phone}
                  </a>
                ) : null}
                {contact.mobile_phone ? (
                  <a href={`tel:${contact.mobile_phone}`} className="block hover:underline">
                    {contact.mobile_phone} <span className="text-xs text-slate-500">mobile</span>
                  </a>
                ) : null}
              </>
            ) : (
              <Muted>Not recorded</Muted>
            )}
          </Row>

          <Row label="Address">
            {address.length > 0 ? (
              <address className="not-italic">
                {address.map((line) => (
                  <span key={line} className="block">
                    {line}
                  </span>
                ))}
              </address>
            ) : (
              <Muted>Not recorded</Muted>
            )}
          </Row>

          <Row label="Birthday">
            {contact.birthday ? formatDate(contact.birthday) : <Muted>Not recorded</Muted>}
          </Row>

          <Row label="Source">
            {CONTACT_SOURCE_LABELS[contact.source]}
            {contact.source_detail ? (
              <span className="block text-xs text-slate-500">{contact.source_detail}</span>
            ) : null}
          </Row>

          <Row label="Added">
            <time dateTime={contact.created_at}>{formatDate(contact.created_at)}</time>
          </Row>

          <Row label="Updated">
            <time dateTime={contact.updated_at}>{formatDate(contact.updated_at)}</time>
          </Row>
        </dl>

        {contact.notes ? (
          <div className="mt-3 border-t border-slate-100 pt-3">
            <h3 className="text-xs font-medium uppercase tracking-wide text-slate-500">Notes</h3>
            <p className="mt-1 whitespace-pre-wrap break-words text-sm text-slate-700">
              {contact.notes}
            </p>
          </div>
        ) : null}
      </CardBody>
    </Card>
  )
}

function Muted({ children }: { children: ReactNode }) {
  return <span className="text-slate-400">{children}</span>
}

export function ContactFollowUpsPanel({
  followUps,
  nowIso,
}: {
  followUps: ContactFollowUp[]
  nowIso: string
}) {
  const now = new Date(nowIso)

  return (
    <Card>
      <CardHeader
        title="Open follow-ups"
        action={
          <Link href="/follow-ups" className="text-xs font-medium text-brand-700 hover:underline">
            All follow-ups
          </Link>
        }
      />
      {followUps.length === 0 ? (
        <EmptyState title="Nothing outstanding" description="No one owes this contact anything." />
      ) : (
        <ul className="divide-y divide-slate-100">
          {followUps.map((followUp) => {
            const overdue = isOverdue(followUp.due_at, now)
            return (
              <li key={followUp.id} className="space-y-1 px-4 py-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  <p className="text-sm font-medium text-slate-900">{followUp.title}</p>
                  <FollowUpPriorityBadge priority={followUp.priority} />
                  {overdue ? <Badge tone="red">Overdue</Badge> : null}
                </div>
                <p className={cn('text-xs', overdue ? 'font-semibold text-red-700' : 'text-slate-500')}>
                  Due <time dateTime={followUp.due_at}>{formatDateTime(followUp.due_at)}</time>
                  {' · '}
                  {followUp.assignee ? followUp.assignee.name : 'Unassigned'}
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
 * Rendered only when the viewer holds `can_view_giving`. Row Level Security
 * would return nothing regardless, but an empty panel reads as "they have never
 * given" rather than "you cannot see this", which is a worse lie.
 */
export function ContactGivingPanel({ giving }: { giving: ContactGiving }) {
  const { summary, recent } = giving

  return (
    <Card>
      <CardHeader
        title="Giving"
        action={
          <Link href="/giving" className="text-xs font-medium text-brand-700 hover:underline">
            Giving reports
          </Link>
        }
      />
      {!summary || summary.gift_count === 0 ? (
        <EmptyState
          title="No gifts recorded"
          description="Nothing has been received from this contact yet."
        />
      ) : (
        <CardBody className="space-y-3">
          <dl className="grid grid-cols-2 gap-3">
            <Figure label="Total given" value={formatCurrency(summary.total_cents)} />
            <Figure label="Gifts" value={summary.gift_count.toLocaleString()} />
            <Figure label="This year" value={formatCurrency(summary.ytd_cents)} />
            <Figure label="Last 12 months" value={formatCurrency(summary.trailing_12mo_cents)} />
            <Figure label="Largest" value={formatCurrency(summary.largest_gift_cents)} />
            <Figure label="Average" value={formatCurrency(summary.average_gift_cents)} />
          </dl>

          <p className="text-xs text-slate-500">
            First gift {formatDate(summary.first_gift_on)} · most recent{' '}
            {formatDate(summary.last_gift_on)}
            {summary.has_recurring ? ' · recurring giver' : ''}
          </p>

          {recent.length > 0 ? (
            <ul className="divide-y divide-slate-100 border-t border-slate-100 pt-1">
              {recent.map((gift) => (
                <li key={gift.id} className="flex items-baseline justify-between gap-2 py-1.5">
                  <span className="text-sm tabular-nums text-slate-900">
                    {formatCurrency(gift.amount_cents, gift.currency)}
                  </span>
                  <span className="text-xs text-slate-500">
                    {formatDate(gift.given_on)}
                    {gift.fund ? ` · ${gift.fund}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </CardBody>
      )}
    </Card>
  )
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="text-sm font-semibold tabular-nums text-slate-900">{value}</dd>
    </div>
  )
}

export function ContactEmailPanel({ engagement }: { engagement: ContactEmailEngagement }) {
  const { summary, recent } = engagement
  const hasData = summary !== null && summary.emails_received > 0

  return (
    <Card>
      <CardHeader title="Email engagement" description="From Mailchimp campaigns." />
      {!hasData ? (
        <EmptyState
          title="No email activity"
          description="Once this contact is matched to a Mailchimp audience, sends, opens and clicks appear here."
        />
      ) : (
        <CardBody className="space-y-3">
          <dl className="grid grid-cols-3 gap-3">
            <Figure label="Received" value={summary.emails_received.toLocaleString()} />
            <Figure label="Opened" value={summary.campaigns_opened.toLocaleString()} />
            <Figure label="Clicked" value={summary.campaigns_clicked.toLocaleString()} />
          </dl>

          {summary.bounces > 0 || summary.unsubscribes > 0 ? (
            <p className="text-xs text-amber-800">
              {summary.bounces > 0 ? `${summary.bounces} bounced` : ''}
              {summary.bounces > 0 && summary.unsubscribes > 0 ? ' · ' : ''}
              {summary.unsubscribes > 0 ? `${summary.unsubscribes} unsubscribed` : ''}
            </p>
          ) : null}

          {summary.last_email_event_at ? (
            <p className="text-xs text-slate-500">
              Last activity {formatRelative(summary.last_email_event_at)}
            </p>
          ) : null}

          {recent.length > 0 ? (
            <ul className="divide-y divide-slate-100 border-t border-slate-100 pt-1">
              {recent.map((event) => (
                <li key={event.id} className="flex items-baseline justify-between gap-2 py-1.5">
                  <span className="min-w-0 text-sm text-slate-800">
                    <span className="font-medium">{MAILCHIMP_ACTION_LABELS[event.action]}</span>
                    {event.campaign ? (
                      <span className="block truncate text-xs text-slate-500">
                        {event.campaign}
                      </span>
                    ) : null}
                  </span>
                  <span className="shrink-0 text-xs text-slate-500">
                    {formatDate(event.action_at)}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </CardBody>
      )}
    </Card>
  )
}
