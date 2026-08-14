import Link from 'next/link'
import { PROPOSAL_STATUS_LABELS } from '@/components/domain/development-badges'
import { ProposalList } from '@/components/domain/proposal-list'
import { LinkButton } from '@/components/ui/button'
import { PageHeader } from '@/components/ui/display'
import { canWrite, requireProfile } from '@/lib/auth'
import { listProposals, parseProposalFilters } from '@/lib/queries/proposals'
import { cn, formatCurrency, pluralize } from '@/lib/utils'

export const metadata = { title: 'Proposals' }

/**
 * Proposals and planned gifts.
 *
 * Open work is the default view — a settled proposal is history, and history
 * does not belong at the top of a working list. The only figure on the page is
 * the total of what is open, because that is the one number anyone actually
 * asks for; everything else is a row you can click.
 */

const SEGMENTS = [
  { key: 'open', label: 'Open' },
  { key: 'presented', label: PROPOSAL_STATUS_LABELS.presented },
  { key: 'committed', label: PROPOSAL_STATUS_LABELS.committed },
  { key: 'funded', label: PROPOSAL_STATUS_LABELS.funded },
  { key: 'all', label: 'Everything' },
] as const

export default async function ProposalsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const profile = await requireProfile()
  const params = await searchParams
  const filters = parseProposalFilters(params)
  const proposals = await listProposals(filters)
  const writable = canWrite(profile)
  const nowIso = new Date().toISOString()

  const openTotal = proposals
    .filter((proposal) => proposal.status !== 'funded' && proposal.status !== 'declined')
    .reduce((sum, proposal) => sum + (proposal.amountCents ?? 0), 0)

  function segmentHref(key: string): string {
    const next = new URLSearchParams()
    if (key !== 'open') next.set('status', key)
    if (filters.ownerId) next.set('owner', filters.ownerId)
    const query = next.toString()
    return query ? `/proposals?${query}` : '/proposals'
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Proposals"
        description="Trusts, gift annuities, estate provisions and outright gifts under discussion."
        action={writable ? <LinkButton href="/proposals/new" size="lg">Add proposal</LinkButton> : null}
      />

      <nav aria-label="Filter proposals" className="border-b border-slate-200">
        <ul className="-mb-px flex gap-x-1 overflow-x-auto">
          {SEGMENTS.map((segment) => {
            const active = filters.segment === segment.key
            return (
              <li key={segment.key}>
                <Link
                  href={segmentHref(segment.key)}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'inline-block whitespace-nowrap border-b-2 px-3 py-3 text-sm transition-colors',
                    active
                      ? 'border-brand-600 font-semibold text-brand-800'
                      : 'border-transparent font-medium text-slate-600 hover:border-slate-300 hover:text-slate-900',
                  )}
                >
                  {segment.label}
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>

      <p className="text-sm text-slate-600">
        {pluralize(proposals.length, 'proposal')}
        {openTotal > 0 ? (
          <>
            {' · '}
            <span className="font-medium tabular-nums text-slate-900">
              {formatCurrency(openTotal)}
            </span>{' '}
            in play
          </>
        ) : null}
      </p>

      <ProposalList
        proposals={proposals}
        showContact
        nowIso={nowIso}
        emptyTitle={filters.segment === 'open' ? 'Nothing open right now' : 'Nothing here'}
        emptyDescription={
          filters.segment === 'open'
            ? 'When a gift conversation turns into something specific — a trust, an annuity, a bequest — start it here.'
            : 'Try a different filter.'
        }
        emptyAction={
          writable && filters.segment === 'open' ? (
            <LinkButton href="/proposals/new">Add a proposal</LinkButton>
          ) : null
        }
      />
    </div>
  )
}
