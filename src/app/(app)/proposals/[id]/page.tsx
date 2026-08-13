import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { removeAttachment, uploadAttachment } from '@/app/(app)/contacts/donor-actions'
import { moveProposalStage, updateProposal } from '@/app/(app)/proposals/actions'
import { AttachmentsPanel } from '@/components/domain/attachments-panel'
import {
  PROPOSAL_FINANCIAL_FIELDS,
  PROPOSAL_KIND_LABELS,
  PROPOSAL_STATUS_LABELS,
} from '@/components/domain/development-badges'
import { ProposalForm } from '@/components/domain/proposal-form'
import { ProposalStage } from '@/components/domain/proposal-stage'
import { LinkButton } from '@/components/ui/button'
import { Avatar, EmptyState } from '@/components/ui/display'
import { SectionHeading } from '@/components/ui/tabs'
import { canViewGiving, canWrite, isAdmin, requireProfile } from '@/lib/auth'
import { getContactAttachments, withDownloadUrls } from '@/lib/queries/attachments'
import { listCallReports } from '@/lib/queries/call-reports'
import { listTeamMembers } from '@/lib/queries/contacts'
import { getProposal } from '@/lib/queries/proposals'
import { formatCurrency, formatDate } from '@/lib/utils'

type RouteParams = Promise<{ id: string }>
type SearchParams = Promise<Record<string, string | string[] | undefined>>

export async function generateMetadata({ params }: { params: RouteParams }): Promise<Metadata> {
  const { id } = await params
  const detail = await getProposal(id)
  return { title: detail?.proposal.title ?? 'Proposal' }
}

/**
 * One proposal.
 *
 * The summary the brief asked for leads: type, stage, amount, who is leading
 * it, what happens next, when it is expected. The planned-giving figures sit
 * below under their own heading, and the edit form is a separate mode rather
 * than a page of always-editable inputs — reading a proposal and changing one
 * are different jobs.
 */
export default async function ProposalPage({
  params,
  searchParams,
}: {
  params: RouteParams
  searchParams: SearchParams
}) {
  const profile = await requireProfile()
  if (!canViewGiving(profile)) redirect('/dashboard?denied=giving')

  const [{ id }, query] = await Promise.all([params, searchParams])
  const detail = await getProposal(id)
  if (!detail) notFound()

  const { proposal, contact, jointContact } = detail
  const writable = canWrite(profile)
  const editing = writable && (Array.isArray(query.edit) ? query.edit[0] : query.edit) === '1'
  const today = new Date().toISOString().slice(0, 10)

  const [team, files, reports] = await Promise.all([
    listTeamMembers(),
    contact ? getContactAttachments(contact.id) : Promise.resolve([]),
    listCallReports({}),
  ])

  const owner = team.find((member) => member.id === proposal.owner_id) ?? null
  const relatedReports = reports.filter((report) => report.contact?.id === contact?.id)
  const proposalFiles = files.filter((file) => file.proposal_id === proposal.id)

  if (editing && contact) {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <div>
          <Link
            href={`/proposals/${proposal.id}`}
            className="text-sm font-medium text-brand-700 hover:underline"
          >
            ← Back to the proposal
          </Link>
          <h1 className="mt-2 text-xl font-bold leading-tight text-slate-900">
            Edit proposal
          </h1>
        </div>
        <ProposalForm
          proposal={proposal}
          contactId={contact.id}
          contactName={contact.name}
          jointContactName={jointContact?.name ?? null}
          team={team}
          defaultOwnerId={profile.id}
          today={today}
          action={updateProposal}
          submitLabel="Save changes"
          cancelHref={`/proposals/${proposal.id}`}
        />
      </div>
    )
  }

  const financialFields = PROPOSAL_FINANCIAL_FIELDS[proposal.kind]
  const figures = [
    financialFields.includes('fair_market_value') && {
      label: 'Fair market value',
      value: proposal.fair_market_value_cents,
    },
    financialFields.includes('estimated_deduction') && {
      label: 'Estimated deduction',
      value: proposal.estimated_deduction_cents,
    },
    financialFields.includes('expected_benefit') && {
      label: 'Expected benefit to us',
      value: proposal.expected_benefit_cents,
    },
  ].filter(Boolean) as Array<{ label: string; value: number | null }>

  const hasFigures = figures.some((figure) => figure.value !== null)

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <header className="space-y-4">
        <div>
          {contact ? (
            <Link
              href={`/contacts/${contact.id}?tab=proposals`}
              className="text-sm font-medium text-brand-700 hover:underline"
            >
              ← {contact.name}
            </Link>
          ) : null}
          <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <h1 className="break-words text-xl font-bold leading-tight text-slate-900 sm:text-2xl">
                {proposal.title}
              </h1>
              <p className="mt-1 text-[15px] text-slate-600">
                {PROPOSAL_KIND_LABELS[proposal.kind]}
                {proposal.purpose ? ` · ${proposal.purpose}` : ''}
                {jointContact ? ` · with ${jointContact.name}` : ''}
              </p>
            </div>
            {writable ? (
              <LinkButton href={`/proposals/${proposal.id}?edit=1`} variant="secondary" size="lg">
                Edit
              </LinkButton>
            ) : null}
          </div>
        </div>

        {/* The summary the brief asked for, in one band. */}
        <dl className="grid grid-cols-2 gap-x-6 gap-y-5 rounded-lg bg-white px-5 py-4 shadow-card sm:grid-cols-4">
          <div>
            <dt className="text-xs font-medium text-slate-500">
              Amount
            </dt>
            <dd className="mt-1 text-lg font-semibold tabular-nums text-slate-900">
              {proposal.charitable_amount_cents !== null
                ? formatCurrency(proposal.charitable_amount_cents, proposal.currency)
                : 'Not yet set'}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-slate-500">
              Stage
            </dt>
            <dd className="mt-1 text-sm font-medium text-slate-900">
              {PROPOSAL_STATUS_LABELS[proposal.status]}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-slate-500">
              Led by
            </dt>
            <dd className="mt-1 flex items-center gap-2 text-sm font-medium text-slate-900">
              {owner ? <Avatar name={owner.name} size="sm" /> : null}
              {owner?.name ?? 'Unassigned'}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-slate-500">
              {proposal.closed_at ? 'Settled' : 'Expected'}
            </dt>
            <dd className="mt-1 text-sm font-medium tabular-nums text-slate-900">
              {proposal.closed_at
                ? formatDate(proposal.closed_at)
                : (proposal.expected_close_on ? formatDate(proposal.expected_close_on) : 'No date set')}
            </dd>
          </div>
        </dl>

        {writable ? <ProposalStage proposal={proposal} action={moveProposalStage} /> : null}
      </header>

      {proposal.notes ? (
        <section className="space-y-3">
          <SectionHeading title="Notes" />
          <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-slate-700">
            {proposal.notes}
          </p>
        </section>
      ) : null}

      {figures.length > 0 ? (
        <section className="space-y-3">
          <SectionHeading
            title="Financial details"
            description={
              hasFigures
                ? undefined
                : 'Nothing recorded yet — these appear on the proposal once an illustration exists.'
            }
          />
          {hasFigures ? (
            <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-3">
              {figures.map((figure) => (
                <div key={figure.label}>
                  <dt className="text-xs font-medium text-slate-500">
                    {figure.label}
                  </dt>
                  <dd className="mt-1 text-lg font-semibold tabular-nums text-slate-900">
                    {figure.value !== null ? formatCurrency(figure.value, proposal.currency) : '—'}
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}
        </section>
      ) : null}

      {relatedReports.length > 0 ? (
        <section className="space-y-3">
          <SectionHeading title="Meetings about this" />
          <ul className="divide-y divide-slate-200 border-t border-slate-200">
            {relatedReports.slice(0, 5).map((report) => (
              <li key={report.id}>
                <Link
                  href={`/reports/${report.id}`}
                  className="flex flex-wrap items-baseline justify-between gap-3 py-3 hover:bg-slate-50"
                >
                  <span className="text-[15px] font-medium text-slate-900">
                    {formatDate(report.metOn)}
                  </span>
                  {report.summary ? (
                    <span className="min-w-0 flex-1 truncate text-sm text-slate-600">
                      {report.summary}
                    </span>
                  ) : null}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {contact ? (
        <AttachmentsPanel
          contactId={contact.id}
          proposalId={proposal.id}
          attachments={await withDownloadUrls(proposalFiles)}
          canEdit={writable}
          currentUserId={profile.id}
          isAdmin={isAdmin(profile)}
          uploadAction={uploadAttachment}
          removeAction={removeAttachment}
          title="Documents"
          description="Illustrations, agreements and anything else that belongs with this proposal."
        />
      ) : (
        <EmptyState
          title="Donor record unavailable"
          description="This proposal's donor could not be loaded, so its documents cannot be shown."
        />
      )}
    </div>
  )
}
