import Link from 'next/link'
import type { ReactNode } from 'react'
import {
  ACTIVITY_TYPE_LABELS,
  ContactStatusBadge,
  LifecycleStageBadge,
} from '@/components/domain/contact-badges'
import { Avatar, Badge, Card, EmptyState, PageHeader } from '@/components/ui/display'
import { canWrite, requireProfile } from '@/lib/auth'
import { LEAD_STATUS_LABELS, LEAD_STATUS_TONES, interestLabel } from '@/lib/leads/triage'
import { searchEverything, type SearchResults } from '@/lib/queries/search'
import { formatDate, formatDateTime, formatRelative, pluralize } from '@/lib/utils'
import { SearchForm } from './search-form'

export const metadata = { title: 'Search' }

type SearchParams = Record<string, string | string[] | undefined>

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const profile = await requireProfile()
  const params = await searchParams
  const q = (single(params.q) ?? '').trim()

  // Viewers cannot read leads at all, so the group is not requested for them.
  const results: SearchResults | null =
    q === '' ? null : await searchEverything(q, { includeLeads: canWrite(profile) })

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <PageHeader
        title="Search"
        description="One box across contacts, the timeline and leads."
      />

      <SearchForm q={q} />

      {results === null ? (
        <Card>
          <EmptyState
            title="What are you looking for?"
            description="Two letters or fewer match on partial words; longer queries also read notes and timeline entries."
          />
        </Card>
      ) : results.total === 0 ? (
        <Card>
          <EmptyState
            title={`Nothing matched “${q}”`}
            description="Try a shorter query, a different spelling, or part of an email address. Archived contacts are not searched."
          />
        </Card>
      ) : (
        <div className="space-y-7 pt-1">
          <p className="text-sm text-slate-500" role="status">
            {pluralize(results.total, 'match', 'matches')} for{' '}
            <span className="font-medium text-slate-700">“{q}”</span>
            {results.usedFallback && results.contacts.items.length > 0
              ? ' · matched on partial words'
              : ''}
          </p>

          <ContactResults results={results} q={q} />
          <ActivityResults results={results} />
          <LeadResults results={results} />
        </div>
      )}
    </div>
  )
}

/** Small-caps group heading sitting on the canvas, above its card of rows. */
function GroupHeading({
  title,
  total,
  action,
}: {
  title: string
  total: number
  action?: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-1 pb-2.5">
      <h2 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
        {title}
        <span className="ml-2 normal-case tracking-normal text-slate-400">
          {pluralize(total, 'match', 'matches')}
        </span>
      </h2>
      {action}
    </div>
  )
}

function GroupLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link
      href={href}
      className="text-xs font-medium text-brand-700 underline-offset-2 hover:underline"
    >
      {children}
    </Link>
  )
}

function GroupFooter({
  shown,
  total,
  href,
  label,
}: {
  shown: number
  total: number
  href: string
  label: string
}) {
  if (total <= shown) return null
  return (
    <div className="border-t border-slate-100 px-5 py-3">
      <p className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
        <span>
          Showing {shown} of {total}.
        </span>
        <Link href={href} className="font-medium text-brand-700 underline-offset-2 hover:underline">
          {label}
        </Link>
      </p>
    </div>
  )
}

function ContactResults({ results, q }: { results: SearchResults; q: string }) {
  const { items, total } = results.contacts
  if (total === 0) return null

  return (
    <section>
      <GroupHeading
        title="Contacts"
        total={total}
        action={<GroupLink href={`/contacts?q=${encodeURIComponent(q)}`}>Open in contacts</GroupLink>}
      />
      <Card>
        <ul className="divide-y divide-slate-100">
          {items.map((contact) => (
            <li
              key={contact.id}
              className="flex gap-3.5 px-5 py-4 transition-colors hover:bg-slate-100/60"
            >
              <Avatar name={contact.name} size="md" className="mt-0.5" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <Link
                    href={`/contacts/${contact.id}`}
                    className="text-sm font-semibold text-slate-900 underline-offset-2 hover:text-brand-700 hover:underline"
                  >
                    {contact.name}
                  </Link>
                  <LifecycleStageBadge stage={contact.lifecycle_stage} />
                  {contact.status !== 'active' ? (
                    <ContactStatusBadge status={contact.status} />
                  ) : null}
                </div>

                <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-sm text-slate-600">
                  {contact.email ? <span className="break-all">{contact.email}</span> : null}
                  {contact.email && contact.phone ? <span aria-hidden="true">·</span> : null}
                  {contact.phone ? <span>{contact.phone}</span> : null}
                  {contact.organization_name ? (
                    <>
                      {contact.email || contact.phone ? <span aria-hidden="true">·</span> : null}
                      <span>{contact.organization_name}</span>
                    </>
                  ) : null}
                </p>

                {contact.snippet ? (
                  <p className="mt-1 text-sm text-slate-500">{contact.snippet}</p>
                ) : null}

                <p className="mt-1 text-xs text-slate-500">
                  {contact.last_activity_at ? (
                    <>
                      Last activity{' '}
                      <time
                        dateTime={contact.last_activity_at}
                        title={formatDateTime(contact.last_activity_at)}
                      >
                        {formatRelative(contact.last_activity_at)}
                      </time>
                    </>
                  ) : (
                    'No activity yet'
                  )}
                </p>
              </div>
            </li>
          ))}
        </ul>
        <GroupFooter
          shown={items.length}
          total={total}
          href={`/contacts?q=${encodeURIComponent(q)}`}
          label="See them all in contacts"
        />
      </Card>
    </section>
  )
}

function ActivityResults({ results }: { results: SearchResults }) {
  const { items, total } = results.activities
  if (total === 0) return null

  return (
    <section>
      <GroupHeading title="Timeline" total={total} />
      <Card>
        <ul className="divide-y divide-slate-100">
          {items.map((activity) => {
            const title = activity.subject?.trim() || ACTIVITY_TYPE_LABELS[activity.type]
            return (
              <li key={activity.id} className="px-5 py-4 transition-colors hover:bg-slate-100/60">
                <p className="text-sm font-semibold text-slate-900">{title}</p>
                {/* A body-less activity's snippet is its subject again; printing
                    the same line twice reads as a glitch. */}
                {activity.snippet && activity.snippet !== title ? (
                  <p className="mt-0.5 text-sm text-slate-600">{activity.snippet}</p>
                ) : null}
                <p className="mt-1.5 flex flex-wrap items-center gap-x-1.5 text-xs text-slate-500">
                  {activity.contact ? (
                    <Link
                      href={`/contacts/${activity.contact.id}`}
                      className="font-medium text-brand-700 underline-offset-2 hover:underline"
                    >
                      {activity.contact.name}
                    </Link>
                  ) : (
                    <span className="text-slate-500">Unknown contact</span>
                  )}
                  <span aria-hidden="true">·</span>
                  <span>{ACTIVITY_TYPE_LABELS[activity.type]}</span>
                  <span aria-hidden="true">·</span>
                  <time dateTime={activity.occurred_at} title={formatDateTime(activity.occurred_at)}>
                    {formatRelative(activity.occurred_at)}
                  </time>
                </p>
              </li>
            )
          })}
        </ul>
        {total > items.length ? (
          <div className="border-t border-slate-100 px-5 py-3">
            <p className="text-xs text-slate-500">
              Showing {items.length} of {total}. Open a contact to read its full timeline.
            </p>
          </div>
        ) : null}
      </Card>
    </section>
  )
}

function LeadResults({ results }: { results: SearchResults }) {
  if (!results.leads || results.leads.total === 0) return null
  const { items, total } = results.leads

  return (
    <section>
      <GroupHeading
        title="Leads"
        total={total}
        action={<GroupLink href="/leads">Open leads</GroupLink>}
      />
      <Card>
        <ul className="divide-y divide-slate-100">
          {items.map((lead) => (
            <li
              key={lead.id}
              className="flex gap-3.5 px-5 py-4 transition-colors hover:bg-slate-100/60"
            >
              <Avatar name={lead.name} size="md" className="mt-0.5" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  {/* A converted lead has a person to open; an unconverted one goes
                      to the leads queue, which owns triage and lead detail. */}
                  <Link
                    href={lead.contact_id ? `/contacts/${lead.contact_id}` : '/leads'}
                    className="text-sm font-semibold text-slate-900 underline-offset-2 hover:text-brand-700 hover:underline"
                  >
                    {lead.name}
                  </Link>
                  <Badge tone={LEAD_STATUS_TONES[lead.status]}>
                    {LEAD_STATUS_LABELS[lead.status]}
                  </Badge>
                </div>

                <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-sm text-slate-600">
                  {lead.email ? <span className="break-all">{lead.email}</span> : null}
                  {lead.email && lead.organization_name ? <span aria-hidden="true">·</span> : null}
                  {lead.organization_name ? <span>{lead.organization_name}</span> : null}
                  {lead.interest ? (
                    <>
                      {lead.email || lead.organization_name ? <span aria-hidden="true">·</span> : null}
                      <span>{interestLabel(lead.interest)}</span>
                    </>
                  ) : null}
                </p>

                {lead.snippet ? <p className="mt-1 text-sm text-slate-500">{lead.snippet}</p> : null}

                <p className="mt-1 text-xs text-slate-500">
                  Submitted <time dateTime={lead.created_at}>{formatDate(lead.created_at)}</time>
                </p>
              </div>
            </li>
          ))}
        </ul>
        <GroupFooter shown={items.length} total={total} href="/leads" label="See them all in leads" />
      </Card>
    </section>
  )
}
