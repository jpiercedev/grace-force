import Link from 'next/link'
import type { ReactNode } from 'react'
import { CAPABILITY_LEVEL_LABELS, PROPOSAL_STATUS_LABELS } from '@/components/domain/development-badges'
import type { ContactFollowUp, ContactGiving, TimelineActivity } from '@/lib/queries/contacts'
import type { ContactOpportunity } from '@/lib/queries/pipelines'
import type { ContactInterest } from '@/lib/queries/relationships'
import type { ProposalSummary } from '@/lib/queries/proposals'
import { cn, formatCurrency, formatDate, formatRelative, isOverdue } from '@/lib/utils'
import type { ContactCapabilityRow } from '@/types/database'

/**
 * Seven answers, at a glance.
 *
 * The brief asks the person record to answer "what is the state of this
 * relationship" before it answers anything else. This is that answer: what is
 * owed, when we last spoke, what is being pursued, what is in flight, what
 * they have given, what they care about, what they might be capable of.
 *
 * It is a row of label-and-value pairs on the canvas rather than a strip of
 * KPI cards. Boxes with borders and shadows read as a dashboard; quiet
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
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd
        className={cn(
          'mt-0.5 text-sm leading-snug',
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
      <Link href={href} className="group block rounded-md py-0.5 transition-colors">
        <div className="group-hover:[&_dd]:text-brand-700">{body}</div>
      </Link>
    )
  }
  return <div>{body}</div>
}

export function DonorGlance({
  followUps,
  lastInteraction,
  opportunity,
  proposal,
  giving,
  capability,
  interests,
  nowIso,
  contactId,
}: {
  followUps: ContactFollowUp[]
  lastInteraction: TimelineActivity | null
  /** The person's first open opportunity — the sales conversation in flight. */
  opportunity: ContactOpportunity | null
  proposal: ProposalSummary | null
  giving: ContactGiving
  capability: ContactCapabilityRow | null
  interests: ContactInterest[]
  nowIso: string
  contactId: string
}) {
  const now = new Date(nowIso)
  const next = followUps[0] ?? null
  const nextOverdue = next ? isOverdue(next.due_at, now) : false
  const summary = giving.summary

  return (
    <dl className="grid grid-cols-2 gap-x-5 gap-y-3.5 rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-card sm:grid-cols-3">
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
        label="Opportunity"
        tone={opportunity ? 'default' : 'muted'}
        href={opportunity?.pipeline ? `/pipelines/${opportunity.pipeline.slug}` : undefined}
      >
        {opportunity ? (
          <>
            <span className="block truncate">{opportunity.title}</span>
            <span className="mt-0.5 block text-xs font-normal text-slate-500">
              {opportunity.stage?.name ?? 'Open'}
              {opportunity.pipeline?.tracks_value && opportunity.value_cents !== null
                ? ` · ${formatCurrency(opportunity.value_cents, opportunity.currency)}`
                : ''}
            </span>
          </>
        ) : (
          'None open'
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

      {/* Capability is a strategy note, so it is stated quietly and never as
          a figure on its own: the level leads, the range is a whisper under
          it, and an unreviewed record says so rather than implying nothing. */}
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
