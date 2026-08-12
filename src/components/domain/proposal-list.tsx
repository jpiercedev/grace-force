import Link from 'next/link'
import {
  PROPOSAL_KIND_LABELS,
  ProposalStatusBadge,
} from '@/components/domain/development-badges'
import { EmptyState } from '@/components/ui/display'
import { cn, formatCurrency, formatDate, isOverdue } from '@/lib/utils'
import type { ProposalSummary } from '@/lib/queries/proposals'

/**
 * The proposal summary line, shared by the donor's Proposals tab and the
 * Proposals destination.
 *
 * Five facts and no more: what it is, what stage it is at, how much, who it is
 * with, when it is expected. Everything else — fair market value, estimated
 * deduction, expected benefit — lives on the proposal itself behind a
 * disclosure, because those numbers only matter to someone already working on
 * the illustration.
 *
 * A row, not a card. Twelve cards is a wall; twelve rules is a list.
 */
export function ProposalList({
  proposals,
  showContact = false,
  emptyTitle = 'No proposals yet',
  emptyDescription,
  emptyAction,
  nowIso,
}: {
  proposals: ProposalSummary[]
  showContact?: boolean
  emptyTitle?: string
  emptyDescription?: string
  emptyAction?: React.ReactNode
  nowIso: string
}) {
  if (proposals.length === 0) {
    return (
      <EmptyState title={emptyTitle} description={emptyDescription} action={emptyAction} />
    )
  }

  const now = new Date(nowIso)

  return (
    <ul className="divide-y divide-slate-200 border-t border-slate-200">
      {proposals.map((proposal) => {
        const open = proposal.status !== 'funded' && proposal.status !== 'declined'
        const late = open && proposal.expectedCloseOn !== null && isOverdue(proposal.expectedCloseOn, now)

        return (
          <li key={proposal.id}>
            <Link
              href={`/proposals/${proposal.id}`}
              className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-1 py-3.5 transition-colors hover:bg-slate-50"
            >
              <span className="min-w-0 flex-1 basis-64">
                <span className="block truncate text-[15px] font-medium text-slate-900">
                  {proposal.title}
                </span>
                <span className="mt-0.5 block truncate text-sm text-slate-600">
                  {PROPOSAL_KIND_LABELS[proposal.kind]}
                  {showContact && proposal.contact ? ` · ${proposal.contact.name}` : ''}
                  {proposal.jointContact ? ` & ${proposal.jointContact.name}` : ''}
                  {proposal.purpose ? ` · ${proposal.purpose}` : ''}
                </span>
              </span>

              <span className="shrink-0 text-[15px] font-semibold tabular-nums text-slate-900">
                {proposal.amountCents !== null
                  ? formatCurrency(proposal.amountCents, proposal.currency)
                  : '—'}
              </span>

              <span className="shrink-0">
                <ProposalStatusBadge status={proposal.status} />
              </span>

              <span
                className={cn(
                  'w-28 shrink-0 text-sm tabular-nums',
                  late ? 'font-semibold text-red-700' : 'text-slate-500',
                )}
              >
                {proposal.expectedCloseOn
                  ? `${late ? 'Due ' : 'By '}${formatDate(proposal.expectedCloseOn)}`
                  : open
                    ? 'No date set'
                    : ''}
              </span>
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
