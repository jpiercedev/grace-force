import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { OpportunityEditForm } from '@/components/domain/opportunity-edit-form'
import { LinkButton } from '@/components/ui/button'
import { Avatar, Badge, Callout, Card, CardBody, PageHeader, badgeTone } from '@/components/ui/display'
import { SectionHeading } from '@/components/ui/tabs'
import { canWrite, requireProfile } from '@/lib/auth'
import { getOpportunity, listAssignableProfiles } from '@/lib/queries/pipelines'
import { CARD_STATUS_LABELS, CARD_STATUS_TONES } from '@/lib/validation/pipeline'
import { contactDisplayName, formatCurrency, formatDate, formatDateTime } from '@/lib/utils'
import { updateOpportunityDetails } from '../../actions'

type RouteParams = Promise<{ id: string }>

export async function generateMetadata({ params }: { params: RouteParams }): Promise<Metadata> {
  const { id } = await params
  const opportunity = await getOpportunity(id)
  return { title: opportunity?.title ?? 'Opportunity' }
}

/**
 * One opportunity in full: the person it belongs to, where it sits, and the
 * editable facts. Stage moves and closing stay on the board — this page is
 * for the details.
 */
export default async function OpportunityPage({ params }: { params: RouteParams }) {
  const profile = await requireProfile()
  const { id } = await params

  const opportunity = await getOpportunity(id)
  if (!opportunity) notFound()

  const writable = canWrite(profile)
  const person = opportunity.contact ? contactDisplayName(opportunity.contact) : 'Unknown person'
  const creatorName = opportunity.creator
    ? opportunity.creator.full_name?.trim() || opportunity.creator.email
    : null

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader
        eyebrow="Sales"
        title={opportunity.title}
        description={
          opportunity.pipeline
            ? `${opportunity.pipeline.name}${opportunity.stage && opportunity.status === 'open' ? ` · ${opportunity.stage.name}` : ''}`
            : undefined
        }
        action={
          <>
            {opportunity.pipeline ? (
              <LinkButton href={`/sales/pipelines/${opportunity.pipeline.slug}`} variant="secondary">
                Open board
              </LinkButton>
            ) : null}
            <LinkButton href={`/contacts/${opportunity.contact_id}`} variant="secondary">
              Open person
            </LinkButton>
          </>
        }
      />

      {/* Who and where — the identity strip. */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-card">
        <Avatar name={person} size="md" />
        <div className="min-w-0 flex-1">
          <Link
            href={`/contacts/${opportunity.contact_id}`}
            className="block truncate text-sm font-semibold text-slate-900 hover:text-brand-700 hover:underline"
          >
            {person}
          </Link>
          <p className="truncate text-[13px] text-slate-600">
            {opportunity.organization_name ??
              opportunity.contact?.organization_name ??
              opportunity.contact?.email ??
              ''}
          </p>
        </div>
        {opportunity.status === 'open' && opportunity.stage ? (
          <Badge tone={badgeTone(opportunity.stage.color)}>{opportunity.stage.name}</Badge>
        ) : (
          <Badge tone={CARD_STATUS_TONES[opportunity.status]}>
            {CARD_STATUS_LABELS[opportunity.status]}
          </Badge>
        )}
        {opportunity.pipeline?.tracks_value && opportunity.value_cents !== null ? (
          <p className="text-sm font-semibold tabular-nums text-slate-900">
            {formatCurrency(opportunity.value_cents, opportunity.currency)}
          </p>
        ) : null}
      </div>

      {opportunity.status !== 'open' ? (
        <Callout tone={opportunity.status === 'won' ? 'success' : 'warning'}>
          This opportunity was {CARD_STATUS_LABELS[opportunity.status].toLowerCase()}
          {opportunity.closed_at ? ` on ${formatDate(opportunity.closed_at)}` : ''}
          {opportunity.close_reason ? ` — ${opportunity.close_reason}` : '.'}
        </Callout>
      ) : null}

      {opportunity.status === 'open' && writable ? (
        <Card>
          <CardBody className="py-5">
            <OpportunityEditForm
              action={updateOpportunityDetails}
              opportunity={opportunity}
              team={await listAssignableProfiles()}
              tracksValue={opportunity.pipeline?.tracks_value ?? false}
            />
          </CardBody>
        </Card>
      ) : (
        <section className="space-y-2">
          <SectionHeading title="Details" />
          <dl className="space-y-2 rounded-lg border border-slate-200 bg-white px-4 py-3.5 text-sm shadow-card">
            <div className="flex flex-wrap gap-x-2">
              <dt className="w-32 shrink-0 text-slate-500">Owner</dt>
              <dd className="font-medium text-slate-800">
                {opportunity.owner
                  ? opportunity.owner.full_name?.trim() || opportunity.owner.email
                  : 'Unassigned'}
              </dd>
            </div>
            {opportunity.expected_close_on ? (
              <div className="flex flex-wrap gap-x-2">
                <dt className="w-32 shrink-0 text-slate-500">Expected close</dt>
                <dd className="font-medium text-slate-800">
                  {formatDate(opportunity.expected_close_on)}
                </dd>
              </div>
            ) : null}
            {opportunity.next_step ? (
              <div className="flex flex-wrap gap-x-2">
                <dt className="w-32 shrink-0 text-slate-500">Next step</dt>
                <dd className="font-medium text-slate-800">{opportunity.next_step}</dd>
              </div>
            ) : null}
            {opportunity.details ? (
              <div className="flex flex-wrap gap-x-2">
                <dt className="w-32 shrink-0 text-slate-500">Notes</dt>
                <dd className="min-w-0 whitespace-pre-wrap text-slate-700">
                  {opportunity.details}
                </dd>
              </div>
            ) : null}
          </dl>
        </section>
      )}

      {/* Attribution stays visible: who started this, and when it last moved. */}
      <p className="text-xs text-slate-500">
        Created {formatDateTime(opportunity.created_at)}
        {creatorName ? ` by ${creatorName}` : ''} · Last updated{' '}
        {formatDateTime(opportunity.updated_at)}
      </p>
    </div>
  )
}
