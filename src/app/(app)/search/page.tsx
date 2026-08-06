import Link from 'next/link'
import {
  ACTIVITY_TYPE_LABELS,
  ContactStatusBadge,
  LifecycleStageBadge,
} from '@/components/domain/contact-badges'
import { LinkButton } from '@/components/ui/button'
import { Badge, Card, CardBody, CardHeader, EmptyState, PageHeader } from '@/components/ui/display'
import type { BadgeTone } from '@/components/ui/display'
import { canWrite, requireProfile } from '@/lib/auth'
import { interestLabel } from '@/lib/leads/triage'
import { searchEverything, type SearchResults } from '@/lib/queries/search'
import { formatDate, formatDateTime, formatRelative, pluralize } from '@/lib/utils'
import type { LeadStatus } from '@/types/database'
import { SearchForm } from './search-form'

export const metadata = { title: 'Search' }

type SearchParams = Record<string, string | string[] | undefined>

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value
}

const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  new: 'New',
  in_review: 'In review',
  converted: 'Converted',
  spam: 'Spam',
  archived: 'Archived',
}

const LEAD_STATUS_TONES: Record<LeadStatus, BadgeTone> = {
  new: 'brand',
  in_review: 'sky',
  converted: 'emerald',
  spam: 'zinc',
  archived: 'zinc',
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
    <div className="mx-auto max-w-5xl space-y-5">
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
        <div className="space-y-4">
          <p className="text-sm text-slate-600" role="status">
            {pluralize(results.total, 'match', 'matches')} for “{q}”
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
    <CardBody className="border-t border-slate-100 py-3">
      <p className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
        <span>
          Showing {shown} of {total}.
        </span>
        <Link href={href} className="font-medium text-brand-700 underline-offset-2 hover:underline">
          {label}
        </Link>
      </p>
    </CardBody>
  )
}

function ContactResults({ results, q }: { results: SearchResults; q: string }) {
  const { items, total } = results.contacts
  if (total === 0) return null

  return (
    <Card>
      <CardHeader
        title="Contacts"
        description={pluralize(total, 'match', 'matches')}
        action={
          <LinkButton
            href={`/contacts?q=${encodeURIComponent(q)}`}
            variant="secondary"
            size="sm"
          >
            Open in contacts
          </LinkButton>
        }
      />
      <ul className="divide-y divide-slate-100">
        {items.map((contact) => (
          <li key={contact.id} className="px-4 py-3">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <Link
                href={`/contacts/${contact.id}`}
                className="text-sm font-semibold text-brand-700 underline-offset-2 hover:underline"
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
  )
}

function ActivityResults({ results }: { results: SearchResults }) {
  const { items, total } = results.activities
  if (total === 0) return null

  return (
    <Card>
      <CardHeader title="Timeline" description={pluralize(total, 'match', 'matches')} />
      <ul className="divide-y divide-slate-100">
        {items.map((activity) => {
          const title = activity.subject?.trim() || ACTIVITY_TYPE_LABELS[activity.type]
          return (
            <li key={activity.id} className="px-4 py-3">
              <p className="text-sm font-medium text-slate-900">{title}</p>
              {/* A body-less activity's snippet is its subject again; printing
                  the same line twice reads as a glitch. */}
              {activity.snippet && activity.snippet !== title ? (
                <p className="mt-0.5 text-sm text-slate-600">{activity.snippet}</p>
              ) : null}
              <p className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-slate-500">
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
        <CardBody className="border-t border-slate-100 py-3">
          <p className="text-xs text-slate-500">
            Showing {items.length} of {total}. Open a contact to read its full timeline.
          </p>
        </CardBody>
      ) : null}
    </Card>
  )
}

function LeadResults({ results }: { results: SearchResults }) {
  if (!results.leads || results.leads.total === 0) return null
  const { items, total } = results.leads

  return (
    <Card>
      <CardHeader
        title="Leads"
        description={pluralize(total, 'match', 'matches')}
        action={
          <LinkButton href="/leads" variant="secondary" size="sm">
            Open leads
          </LinkButton>
        }
      />
      <ul className="divide-y divide-slate-100">
        {items.map((lead) => (
          <li key={lead.id} className="px-4 py-3">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              {/* A converted lead has a person to open; an unconverted one goes
                  to the leads queue, which owns triage and lead detail. */}
              <Link
                href={lead.contact_id ? `/contacts/${lead.contact_id}` : '/leads'}
                className="text-sm font-semibold text-brand-700 underline-offset-2 hover:underline"
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
          </li>
        ))}
      </ul>
      <GroupFooter shown={items.length} total={total} href="/leads" label="See them all in leads" />
    </Card>
  )
}
