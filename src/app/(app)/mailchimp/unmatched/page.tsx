import Link from 'next/link'
import { LinkButton } from '@/components/ui/button'
import {
  Badge,
  Callout,
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
} from '@/components/ui/display'
import { isAdmin, requireProfile } from '@/lib/auth'
import { mergeFieldText } from '@/lib/mailchimp/matching'
import {
  getUnmatchedMember,
  listUnmatchedMembers,
  searchContactsToLink,
  type UnmatchedMember,
} from '@/lib/mailchimp/queries'
import { memberStatusLabel, memberStatusTone } from '@/lib/mailchimp/ui'
import { formatDateTime, formatRelative, pluralize } from '@/lib/utils'
import type { Json } from '@/types/database'
import { linkMemberToContact } from '../actions'
import { LinkPanel } from './link-panel'

export const metadata = { title: 'Unmatched subscribers' }

type SearchParams = Promise<Record<string, string | string[] | undefined>>

function single(value: string | string[] | undefined): string {
  const raw = Array.isArray(value) ? value[0] : value
  return raw?.trim() ?? ''
}

/**
 * The review queue for subscribers the sync could not resolve to a contact.
 *
 * Everyone may look — knowing who is on the list but not in the CRM is useful
 * to any of the team. Only an admin may link one, which mirrors the
 * `mailchimp_members_admin_update` policy rather than substituting for it.
 */
export default async function UnmatchedPage({ searchParams }: { searchParams: SearchParams }) {
  const profile = await requireProfile()
  const admin = isAdmin(profile)
  const params = await searchParams

  const memberId = single(params.member)
  const term = single(params.q)

  const { items, total } = await listUnmatchedMembers()
  const selected = admin && memberId ? await getUnmatchedMember(memberId) : null
  const candidates = selected && term ? await searchContactsToLink(term) : []

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <PageHeader
        title="Unmatched subscribers"
        description="People on a Mailchimp audience who are not linked to a CRM contact."
        action={
          <LinkButton href="/mailchimp" variant="secondary">
            Back to email
          </LinkButton>
        }
      />

      {admin && memberId && !selected ? (
        <Callout tone="warning" role="status">
          That subscriber is no longer unmatched — someone may have linked it already.
        </Callout>
      ) : null}

      {selected ? (
        <LinkPanel
          member={selected}
          term={term}
          candidates={candidates}
          action={linkMemberToContact}
        />
      ) : null}

      <Card>
        <CardHeader
          title={total === 0 ? 'Nothing to review' : pluralize(total, 'subscriber')}
          description={
            admin
              ? 'Link a subscriber to the person it belongs to, or leave it for auto-matching on a future sync.'
              : 'An administrator can link these to a contact.'
          }
        />
        {items.length === 0 ? (
          <EmptyState
            title="Every subscriber is linked"
            description="New subscribers are matched on email as they arrive; anything ambiguous lands here."
          />
        ) : (
          <ul className="divide-y divide-slate-100">
            {items.map((member) => (
              <MemberRow key={member.id} member={member} admin={admin} selected={member.id === memberId} />
            ))}
          </ul>
        )}
      </Card>

      {total > items.length ? (
        <p className="text-xs text-slate-500">
          Showing the {items.length} most recently changed of {total.toLocaleString()}. Link some,
          or let a sync auto-match them once the matching contacts exist.
        </p>
      ) : null}
    </div>
  )
}

function MemberRow({
  member,
  admin,
  selected,
}: {
  member: UnmatchedMember
  admin: boolean
  selected: boolean
}) {
  const name = subscriberName(member.merge_fields)

  return (
    <li className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-4 py-3">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-slate-900">{name ?? member.email_address}</span>
          <Badge tone={memberStatusTone(member.status)}>{memberStatusLabel(member.status)}</Badge>
        </div>
        {name ? (
          <span className="mt-0.5 block truncate text-sm text-slate-600">
            {member.email_address}
          </span>
        ) : null}
        <span className="mt-0.5 block text-xs text-slate-500">
          {member.audience?.name ?? 'Unknown audience'}
          {member.last_changed_at ? (
            <>
              {' · changed '}
              <time
                dateTime={member.last_changed_at}
                title={formatDateTime(member.last_changed_at)}
              >
                {formatRelative(member.last_changed_at)}
              </time>
            </>
          ) : null}
        </span>
      </div>

      {admin ? (
        <Link
          href={`/mailchimp/unmatched?member=${member.id}#link-panel`}
          aria-current={selected ? 'true' : undefined}
          className="text-sm font-medium text-brand-700 underline-offset-2 hover:underline"
        >
          Link<span className="sr-only"> {member.email_address} to a contact</span>
        </Link>
      ) : null}
    </li>
  )
}

/** Names come from the FNAME/LNAME merge fields, which an audience may not use. */
function subscriberName(mergeFields: Json): string | null {
  if (!mergeFields || typeof mergeFields !== 'object' || Array.isArray(mergeFields)) return null
  const composed = [mergeFieldText(mergeFields, 'FNAME'), mergeFieldText(mergeFields, 'LNAME')]
    .filter(Boolean)
    .join(' ')
    .trim()
  return composed === '' ? null : composed
}
