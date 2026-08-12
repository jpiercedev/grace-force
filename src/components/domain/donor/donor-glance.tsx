import Link from 'next/link'
import type { ReactNode } from 'react'
import { CAPABILITY_LEVEL_LABELS, PROPOSAL_STATUS_LABELS } from '@/components/domain/development-badges'
import type { ContactFollowUp, ContactGiving, TimelineActivity } from '@/lib/queries/contacts'
import type { ContactInterest } from '@/lib/queries/relationships'
import type { ProposalSummary } from '@/lib/queries/proposals'
import { cn, formatCurrency, formatDate, formatRelative, isOverdue } from '@/lib/utils'
import type { ContactCapabilityRow } from '@/types/database'

/**
 * Six answers, at a glance.
 *
 * The brief asks the donor record to answer "what is the state of this
 * relationship" before it answers anything else. This is that answer: what is
 * owed, when we last spoke, what is in flight, what they have given, what they
 * care about, what they might be capable of.
 *
 * It is a row of label-and-value pairs on the canvas rather than six KPI
 * cards. Six boxes with borders and shadows read as a dashboard; six quiet
 * columns read as a summary — and a summary is what this is.
 */

function Item({
  label,
  children,
  href,
  tone = 'default',
}: {
  label: string
  children: ReactNode
  href?: string
  tone?: 'default' | 'urgent' | 'muted'
}) {
  const body = (
    <>
      <dt className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
        {label}
      </dt>
      <dd
        className={cn(
          'mt-1 text-sm leading-snug',
          tone === 'urgent' && 'font-semibold text-red-700',
          tone === 'muted' && 'text-slate-500',
          tone === 'default' && 'font-medium text-slate-900',
        )}
      >
        {children}
      </dd>
    </>
  )

  if (href) {
    return (
      <Link href={href} className="group block rounded-lg py-0.5 transition-colors">
        <div className="group-hover:[&_dd]:text-brand-800">{body}</div>
      </Link>
    )
  }
  return <div>{body}</div>
}

export function DonorGlance({
  followUps,
  lastInteraction,
  proposal,
  giving,
  capability,
  interests,
  nowIso,
  contactId,
}: {
  followUps: ContactFollowUp[]
  lastInteraction: TimelineActivity | null
  proposal: ProposalSummary | null
  /** Null when the viewer cannot see giving — the column is omitted, not empty. */
  giving: ContactGiving | null
  capability: ContactCapabilityRow | null
  interests: ContactInterest[]
  nowIso: string
  contactId: string
}) {
  const now = new Date(nowIso)
  const next = followUps[0] ?? null
  const nextOverdue = next ? isOverdue(next.due_at, now) : false
  const summary = giving?.summary ?? null

  return (
    <dl className="grid grid-cols-2 gap-x-6 gap-y-5 rounded-xl bg-white px-5 py-4 shadow-card sm:grid-cols-3 lg:grid-cols-6">
      <Item
        label="Next"
        tone={next ? (nextOverdue ? 'urgent' : 'default') : 'muted'}
        href={next ? '/follow-ups' : undefined}
      >
        {next ? (
          <>
            {next.title}
            <span className="mt-0.5 block text-xs font-normal text-slate-500">
              {nextOverdue ? 'Overdue · ' : ''}
              {formatDate(next.due_at)}
            </span>
          </>
        ) : (
          'Nothing scheduled'
        )}
      </Item>

      <Item label="Last spoke" tone={lastInteraction ? 'default' : 'muted'}>
        {lastInteraction ? (
          <>
            {formatRelative(lastInteraction.occurred_at, now)}
            {lastInteraction.subject ? (
              <span className="mt-0.5 block truncate text-xs font-normal text-slate-500">
                {lastInteraction.subject}
              </span>
            ) : null}
          </>
        ) : (
          'No contact logged'
        )}
      </Item>

      <Item
        label="Proposal"
        tone={proposal ? 'default' : 'muted'}
        href={proposal ? `/proposals/${proposal.id}` : undefined}
      >
        {proposal ? (
          <>
            <span className="block truncate">{proposal.title}</span>
            <span className="mt-0.5 block text-xs font-normal text-slate-500">
              {PROPOSAL_STATUS_LABELS[proposal.status]}
              {proposal.amountCents !== null
                ? ` · ${formatCurrency(proposal.amountCents, proposal.currency)}`
                : ''}
            </span>
          </>
        ) : (
          'None open'
        )}
      </Item>

      {giving ? (
        <Item
          label="Given"
          tone={summary && summary.gift_count > 0 ? 'default' : 'muted'}
          href={`/contacts/${contactId}?tab=giving`}
        >
          {summary && summary.gift_count > 0 ? (
            <>
              {formatCurrency(summary.total_cents)}
              <span className="mt-0.5 block text-xs font-normal text-slate-500">
                last {formatDate(summary.last_gift_on)}
              </span>
            </>
          ) : (
            'No gifts yet'
          )}
        </Item>
      ) : null}

      {giving ? (
        // Capability is a strategy note, so it is stated quietly and never as
        // a figure on its own: the level leads, the range is a whisper under
        // it, and an unreviewed record says so rather than implying nothing.
        <Item label="Capability" tone={capability && capability.level !== 'unrated' ? 'default' : 'muted'}>
          {capability && capability.level !== 'unrated' ? (
            <>
              {CAPABILITY_LEVEL_LABELS[capability.level]}
              {capability.range_low_cents !== null || capability.range_high_cents !== null ? (
                <span className="mt-0.5 block text-xs font-normal text-slate-500">
                  {formatCurrency(capability.range_low_cents ?? 0)}
                  {capability.range_high_cents !== null
                    ? `–${formatCurrency(capability.range_high_cents)}`
                    : '+'}
                </span>
              ) : null}
            </>
          ) : (
            'Not assessed'
          )}
        </Item>
      ) : null}

      <Item
        label="Cares about"
        tone={interests.length > 0 ? 'default' : 'muted'}
        href={`/contacts/${contactId}?tab=overview`}
      >
        {interests.length > 0 ? (
          <>
            {interests[0]!.label}
            {interests.length > 1 ? (
              <span className="mt-0.5 block text-xs font-normal text-slate-500">
                and {interests.length - 1} more
              </span>
            ) : null}
          </>
        ) : (
          'Not recorded'
        )}
      </Item>
    </dl>
  )
}
