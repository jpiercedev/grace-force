import Link from 'next/link'
import type { ReactNode } from 'react'
import { LinkButton } from '@/components/ui/button'
import { Badge, badgeTone, EmptyState } from '@/components/ui/display'
import { SectionHeading } from '@/components/ui/tabs'
import type { ContactOpportunity } from '@/lib/queries/pipelines'
import { formatCurrency, formatDate } from '@/lib/utils'
import { CARD_STATUS_LABELS, CARD_STATUS_TONES } from '@/lib/validation/pipeline'

/**
 * The sales section of a person record: their open opportunities across every
 * pipeline, with the recently settled few as a quiet postscript.
 *
 * Open rows carry what a colleague needs before picking up the phone — where
 * the deal stands, what it is worth, when it should land, whose it is, and
 * what happens next. Settled rows are one line each: history for context, not
 * work to be done.
 */

function opportunityHref(opportunity: ContactOpportunity): string | null {
  return opportunity.pipeline ? `/pipelines/${opportunity.pipeline.slug}` : null
}

function OpenOpportunityRow({ opportunity }: { opportunity: ContactOpportunity }) {
  const href = opportunityHref(opportunity)
  const ownerName = opportunity.owner
    ? opportunity.owner.full_name?.trim() || opportunity.owner.email
    : null
  const showValue =
    opportunity.pipeline?.tracks_value === true && opportunity.value_cents !== null

  const meta: ReactNode[] = []
  if (opportunity.pipeline) meta.push(<span key="pipeline">{opportunity.pipeline.name}</span>)
  if (opportunity.expected_close_on) {
    meta.push(
      <time key="close" dateTime={opportunity.expected_close_on}>
        Closes {formatDate(opportunity.expected_close_on)}
      </time>,
    )
  }
  if (ownerName) meta.push(<span key="owner">{ownerName}</span>)

  return (
    <li className="px-3.5 py-2.5">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <p className="min-w-0 text-sm font-medium text-slate-900">
          {href ? (
            <Link href={href} className="text-brand-700 hover:underline">
              {opportunity.title}
            </Link>
          ) : (
            opportunity.title
          )}
        </p>
        <span className="flex shrink-0 items-center gap-2">
          {showValue ? (
            <span className="text-sm font-medium tabular-nums text-slate-900">
              {formatCurrency(opportunity.value_cents, opportunity.currency)}
            </span>
          ) : null}
          {opportunity.stage ? (
            <Badge tone={badgeTone(opportunity.stage.color)}>{opportunity.stage.name}</Badge>
          ) : null}
        </span>
      </div>
      {meta.length > 0 ? (
        <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[13px] text-slate-500">
          {meta.map((part, index) => (
            <span key={index} className="flex items-center gap-x-1.5">
              {index > 0 ? <span aria-hidden="true">·</span> : null}
              {part}
            </span>
          ))}
        </p>
      ) : null}
      {opportunity.next_step ? (
        <p className="mt-0.5 text-[13px] text-slate-600">Next step: {opportunity.next_step}</p>
      ) : null}
    </li>
  )
}

export function ContactOpportunities({
  contactId,
  open,
  settled,
  canEdit,
}: {
  contactId: string
  open: ContactOpportunity[]
  settled: ContactOpportunity[]
  canEdit: boolean
}) {
  const addHref = `/sales/new?contact=${contactId}`

  return (
    <section className="space-y-2">
      <SectionHeading
        title="Sales"
        description="Opportunities this person is part of, across every pipeline."
        action={
          canEdit && open.length > 0 ? (
            <LinkButton href={addHref} variant="secondary" size="sm">
              Add to a pipeline
            </LinkButton>
          ) : null
        }
      />

      {open.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-white shadow-card">
          <EmptyState
            title="No open opportunities"
            description="When a conversation turns into something worth pursuing, add them to a pipeline and it will be tracked here."
            action={
              canEdit ? (
                <LinkButton href={addHref} variant="secondary">
                  Add to a pipeline
                </LinkButton>
              ) : null
            }
          />
        </div>
      ) : (
        <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white shadow-card">
          {open.map((opportunity) => (
            <OpenOpportunityRow key={opportunity.id} opportunity={opportunity} />
          ))}
        </ul>
      )}

      {settled.length > 0 ? (
        <div className="pt-1">
          <h3 className="text-xs font-semibold text-slate-500">Recently settled</h3>
          <ul className="mt-1.5 space-y-1.5">
            {settled.map((opportunity) => (
              <li
                key={opportunity.id}
                className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px] text-slate-600"
              >
                <span className="min-w-0 truncate">{opportunity.title}</span>
                <Badge tone={CARD_STATUS_TONES[opportunity.status]}>
                  {CARD_STATUS_LABELS[opportunity.status]}
                </Badge>
                {opportunity.closed_at ? (
                  <time dateTime={opportunity.closed_at} className="text-xs text-slate-500">
                    {formatDate(opportunity.closed_at)}
                  </time>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  )
}
