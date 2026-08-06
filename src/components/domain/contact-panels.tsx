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
import {
  cn,
  formatCurrency,
  formatDate,
  formatDateTime,
  formatRelative,
  isOverdue,
  pluralize,
} from '@/lib/utils'
import type { ContactRow } from '@/types/database'

/**
 * The right rail of the contact record: what should happen next, how the
 * relationship stands, and the reference facts — in that order of urgency.
 *
 * All server components — nothing here is interactive.
 */

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    // A fixed narrow label column: an equal-thirds grid squeezed values so
    // hard that ordinary emails wrapped mid-word.
    <div className="grid grid-cols-[5.5rem_minmax(0,1fr)] gap-2 py-2">
      <dt className="pt-px text-[11px] font-semibold uppercase tracking-wider text-slate-500">
        {label}
      </dt>
      <dd className="break-words text-sm text-slate-800">{children}</dd>
    </div>
  )
}

function addressLines(contact: ContactRow): string[] {
  const cityLine = [contact.city, contact.region].filter(Boolean).join(', ')
  const lines = [
    contact.address_line1,
    contact.address_line2,
    [cityLine, contact.postal_code].filter(Boolean).join(' '),
  ]
    .map((line) => line?.trim() ?? '')
    .filter((line) => line !== '')
  // A bare country with nothing else on file reads as a data glitch and
  // falsely implies an address exists — let the row say "Not recorded".
  const country = contact.country?.trim()
  return country && lines.length > 0 ? [...lines, country] : lines
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
              // break-all: when an address must wrap, an even break beats
              // break-words orphaning a single character on the next line.
              <a href={`mailto:${contact.email}`} className="break-all text-brand-700 hover:underline">
                {contact.email}
              </a>
            ) : (
              <Muted>Not recorded</Muted>
            )}
            {contact.secondary_email ? (
              <a
                href={`mailto:${contact.secondary_email}`}
                className="mt-0.5 block break-all text-brand-700 hover:underline"
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
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Notes
            </h3>
            <p className="mt-1.5 whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-700">
              {contact.notes}
            </p>
          </div>
        ) : null}
      </CardBody>
    </Card>
  )
}

function Muted({ children }: { children: ReactNode }) {
  // slate-500 is the floor for muted text: slate-400 fails AA at this size.
  return <span className="text-slate-500">{children}</span>
}

/**
 * The "Next" moment: what this relationship is owed. It leads the sidebar so
 * the first glance answers "is anything waiting on us?" before the history.
 */
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
        title="Next"
        description="Open follow-ups for this contact."
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
              <li key={followUp.id} className="space-y-1 px-5 py-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  <p className="text-sm font-semibold text-slate-900">{followUp.title}</p>
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
 *
 * Giving is stewardship context, not accounting: the total speaks in the
 * serif voice and the ledger of recent gifts stays muted beneath it.
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
        <CardBody className="space-y-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Total given
            </p>
            <p className="mt-1 font-display text-[1.75rem] font-semibold leading-none tracking-tight tabular-nums text-slate-900">
              {formatCurrency(summary.total_cents)}
            </p>
            <p className="mt-2 text-xs leading-relaxed text-slate-500">
              {pluralize(summary.gift_count, 'gift')} · first {formatDate(summary.first_gift_on)}{' '}
              · most recent{' '}
              {formatDate(summary.last_gift_on)}
              {summary.has_recurring ? ' · recurring giver' : ''}
            </p>
          </div>

          <dl className="grid grid-cols-2 gap-x-3 gap-y-3 border-t border-slate-100 pt-3.5">
            <Figure label="This year" value={formatCurrency(summary.ytd_cents)} />
            <Figure label="Last 12 months" value={formatCurrency(summary.trailing_12mo_cents)} />
            <Figure label="Largest" value={formatCurrency(summary.largest_gift_cents)} />
            <Figure label="Average" value={formatCurrency(summary.average_gift_cents)} />
          </dl>

          {recent.length > 0 ? (
            <div className="border-t border-slate-100 pt-3">
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Recent gifts
              </h3>
              <ul className="mt-1 divide-y divide-slate-100">
                {recent.map((gift) => (
                  <li key={gift.id} className="flex items-baseline justify-between gap-2 py-1.5">
                    <span className="text-sm font-medium tabular-nums text-slate-800">
                      {formatCurrency(gift.amount_cents, gift.currency)}
                    </span>
                    <span className="text-xs text-slate-500">
                      {formatDate(gift.given_on)}
                      {gift.fund ? ` · ${gift.fund}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </CardBody>
      )}
    </Card>
  )
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</dt>
      {/* Serif, a step below the headline total, so the four supporting
          figures read as context rather than competing headlines. */}
      <dd className="mt-0.5 font-display text-lg font-semibold tabular-nums text-slate-900">
        {value}
      </dd>
    </div>
  )
}

/** Machine data stays in the sans voice, and quiet: it is telemetry, not story. */
function QuietFigure({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-sm font-semibold tabular-nums text-slate-700">{value}</dd>
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
            <QuietFigure label="Received" value={summary.emails_received.toLocaleString()} />
            <QuietFigure label="Opened" value={summary.campaigns_opened.toLocaleString()} />
            <QuietFigure label="Clicked" value={summary.campaigns_clicked.toLocaleString()} />
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
                  <span className="min-w-0 text-sm text-slate-700">
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
