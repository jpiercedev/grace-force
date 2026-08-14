import Link from 'next/link'
import { Button, LinkButton } from '@/components/ui/button'
import { Badge, EmptyState, PageHeader, badgeTone } from '@/components/ui/display'
import { Input, Label, Select } from '@/components/ui/form'
import { canWrite, requireProfile } from '@/lib/auth'
import {
  OPPORTUNITY_LIST_LIMIT,
  listAssignableProfiles,
  listOpportunities,
  listPipelineSummaries,
  listSalesPipelineOptions,
  type OpportunityFilters,
  type OpportunityListItem,
} from '@/lib/queries/pipelines'
import {
  cn,
  contactDisplayName,
  formatCurrency,
  formatDate,
  pluralize,
  truncate,
} from '@/lib/utils'
import { CARD_STATUS_LABELS } from '@/lib/validation/pipeline'
import type { PipelineCardStatus } from '@/types/database'

export const metadata = { title: 'Sales' }

type SearchParams = Promise<Record<string, string | string[] | undefined>>

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function single(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value
  return raw?.trim() || undefined
}

/** A malformed id in a shared URL must read as "no filter", not a 500. */
function uuidParam(value: string | string[] | undefined): string | undefined {
  const raw = single(value)
  return raw && UUID_PATTERN.test(raw) ? raw : undefined
}

const CLOSE_WINDOWS = [
  { value: '0', label: 'Overdue' },
  { value: '30', label: 'Next 30 days' },
  { value: '90', label: 'Next 90 days' },
] as const

const STATUSES = ['open', 'won', 'lost', 'archived'] as const satisfies readonly PipelineCardStatus[]

/** Plain label + figure between hairlines — the board's ledger rule, reused. */
function Figure({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <dt className="text-xs font-medium text-slate-500">{label}</dt>
      <dd className="mt-1.5 text-2xl font-semibold leading-none tabular-nums text-slate-900">
        {value}
      </dd>
    </div>
  )
}

export default async function SalesPage({ searchParams }: { searchParams: SearchParams }) {
  const profile = await requireProfile()
  const params = await searchParams
  const writable = canWrite(profile)

  const q = single(params.q)
  const pipelineId = uuidParam(params.pipeline)
  const stageId = uuidParam(params.stage)
  const ownerId = uuidParam(params.owner)
  const closeRaw = single(params.close)
  const closeWithin = CLOSE_WINDOWS.some((window) => window.value === closeRaw)
    ? Number(closeRaw)
    : undefined
  const statusRaw = single(params.status)
  const status = STATUSES.find((option) => option === statusRaw)

  const filters: OpportunityFilters = {
    q,
    pipeline: pipelineId,
    stage: stageId,
    owner: ownerId,
    closeWithin,
    status,
  }
  const filtered = Boolean(
    q || pipelineId || stageId || ownerId || closeWithin !== undefined || (status && status !== 'open'),
  )

  // The headline figures always describe the open book, so a narrowed list
  // needs a second unfiltered read; the default view reuses one round trip.
  const listPromise = listOpportunities(filters)
  const [opportunities, statsSource, summaries, pipelineOptions, team] = await Promise.all([
    listPromise,
    filtered ? listOpportunities() : listPromise,
    listPipelineSummaries(),
    listSalesPipelineOptions(),
    listAssignableProfiles(),
  ])

  const today = new Date().toISOString().slice(0, 10)
  const horizonDate = new Date()
  horizonDate.setDate(horizonDate.getDate() + 30)
  const horizon = horizonDate.toISOString().slice(0, 10)

  const openCount = statsSource.length
  const openValueCents = statsSource.reduce(
    (total, item) => total + (item.pipeline?.tracks_value ? (item.value_cents ?? 0) : 0),
    0,
  )
  const closingSoon = statsSource.filter(
    (item) => item.expected_close_on !== null && item.expected_close_on <= horizon,
  ).length

  const pipelineChoice = pipelineOptions.find((option) => option.id === pipelineId)

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <PageHeader
        title="Sales"
        description="Every opportunity the team is working, across all pipelines."
        action={writable ? <LinkButton href="/sales/new">New opportunity</LinkButton> : null}
      />

      <dl className="flex flex-wrap items-end gap-x-10 gap-y-4 border-y border-slate-200 py-4">
        <Figure label="Open opportunities" value={openCount} />
        <Figure label="Open value" value={formatCurrency(openValueCents)} />
        <Figure label="Closing in 30 days" value={closingSoon} />
      </dl>

      <section aria-labelledby="sales-boards" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="sales-boards" className="text-sm font-semibold text-slate-900">
            Boards
          </h2>
          <LinkButton href="/sales/pipelines" variant="ghost" size="sm">
            Manage pipelines
          </LinkButton>
        </div>

        {summaries.length === 0 ? (
          <div className="rounded-lg border border-slate-200 bg-white shadow-card">
            <EmptyState
              title="No active pipelines"
              description="Create a pipeline before opportunities have anywhere to live."
              action={
                writable ? (
                  <LinkButton href="/sales/pipelines" variant="secondary">
                    Create a pipeline
                  </LinkButton>
                ) : null
              }
            />
          </div>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {summaries.map((pipeline) => (
              <li key={pipeline.id}>
                <Link
                  href={`/pipelines/${pipeline.slug}`}
                  className="group flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-card transition-colors duration-150 hover:border-slate-300 hover:bg-slate-50"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-slate-900 transition-colors duration-150 group-hover:text-brand-700">
                      {pipeline.name}
                    </span>
                    <span className="mt-0.5 block text-xs text-slate-500">
                      {pluralize(pipeline.open_count, 'open opportunity', 'open opportunities')}
                      {pipeline.open_value_cents !== null ? (
                        <>
                          {' · '}
                          <span className="font-semibold tabular-nums text-slate-700">
                            {formatCurrency(pipeline.open_value_cents)}
                          </span>
                        </>
                      ) : null}
                    </span>
                  </span>
                  <span
                    aria-hidden="true"
                    className="shrink-0 text-slate-400 transition-transform duration-150 group-hover:translate-x-0.5 group-hover:text-brand-700 motion-reduce:transform-none"
                  >
                    →
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* A plain GET form keeps the URL the source of truth: bookmarkable,
          shareable, reload-safe. Selects never auto-submit — Apply does. */}
      <form
        method="get"
        action="/sales"
        role="search"
        aria-label="Filter opportunities"
        className="rounded-lg border border-slate-200 bg-white p-3 shadow-card"
      >
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <div className="space-y-1">
            <Label htmlFor="sales-q">Search</Label>
            <Input
              id="sales-q"
              name="q"
              type="search"
              defaultValue={q ?? ''}
              placeholder="Name, organization or opportunity…"
            />
          </div>

          <div className="space-y-1">
            <Label htmlFor="sales-pipeline">Pipeline</Label>
            <Select id="sales-pipeline" name="pipeline" defaultValue={pipelineId ?? ''}>
              <option value="">All pipelines</option>
              {pipelineOptions.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </Select>
          </div>

          {/* The stage list belongs to one pipeline; until Apply names one,
              the control is disabled rather than offering every stage of
              every pipeline jumbled together. */}
          <div className="space-y-1">
            <Label htmlFor="sales-stage">Stage</Label>
            <Select
              id="sales-stage"
              name="stage"
              defaultValue={stageId ?? ''}
              disabled={!pipelineChoice}
            >
              <option value="">
                {pipelineChoice ? 'Any stage' : 'Choose a pipeline first'}
              </option>
              {pipelineChoice?.stages.map((stage) => (
                <option key={stage.id} value={stage.id}>
                  {stage.name}
                </option>
              ))}
            </Select>
          </div>

          <div className="space-y-1">
            <Label htmlFor="sales-owner">Owner</Label>
            <Select id="sales-owner" name="owner" defaultValue={ownerId ?? ''}>
              <option value="">Anyone</option>
              {team.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.full_name?.trim() || member.email}
                </option>
              ))}
            </Select>
          </div>

          <div className="space-y-1">
            <Label htmlFor="sales-close">Expected close</Label>
            <Select id="sales-close" name="close" defaultValue={closeRaw ?? ''}>
              <option value="">Any time</option>
              {CLOSE_WINDOWS.map((window) => (
                <option key={window.value} value={window.value}>
                  {window.label}
                </option>
              ))}
            </Select>
          </div>

          <div className="space-y-1">
            <Label htmlFor="sales-status">Status</Label>
            <Select id="sales-status" name="status" defaultValue={status ?? 'open'}>
              {STATUSES.map((option) => (
                <option key={option} value={option}>
                  {CARD_STATUS_LABELS[option]}
                </option>
              ))}
            </Select>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          {filtered ? (
            <Link
              href="/sales"
              className="text-xs font-medium text-slate-500 hover:text-brand-700 hover:underline"
            >
              Clear all filters
            </Link>
          ) : (
            <span />
          )}
          <Button type="submit" variant="secondary">
            Apply
          </Button>
        </div>
      </form>

      {opportunities.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-white shadow-card">
          {filtered ? (
            <EmptyState
              title="No opportunities match"
              description="Try a broader search, or clear the filters to see the whole book."
              action={
                <LinkButton href="/sales" variant="secondary">
                  Clear filters
                </LinkButton>
              }
            />
          ) : (
            <EmptyState
              title="No open opportunities yet"
              description="When someone is ready for a next step, start an opportunity and it will show up here and on its board."
              action={
                writable ? <LinkButton href="/sales/new">New opportunity</LinkButton> : null
              }
            />
          )}
        </div>
      ) : (
        <OpportunityList opportunities={opportunities} today={today} />
      )}

      {opportunities.length === OPPORTUNITY_LIST_LIMIT ? (
        <p className="text-xs text-slate-500">
          Showing the first {OPPORTUNITY_LIST_LIMIT} opportunities — narrow with the filters to
          see the rest.
        </p>
      ) : null}
    </div>
  )
}

/**
 * One pass over the data builds display rows; the table (≥sm, scrolling in its
 * own container) and the stacked cards (<sm) both render from that.
 */
function OpportunityList({
  opportunities,
  today,
}: {
  opportunities: OpportunityListItem[]
  today: string
}) {
  const rows = opportunities.map((item) => ({
    id: item.id,
    title: item.title,
    boardHref: item.pipeline ? `/pipelines/${item.pipeline.slug}` : '/sales',
    organization: item.organization_name,
    contactId: item.contact_id,
    contactName: item.contact ? contactDisplayName(item.contact) : 'Unknown contact',
    pipelineName: item.pipeline?.name ?? '—',
    stage: item.stage,
    value:
      item.pipeline?.tracks_value && item.value_cents !== null
        ? formatCurrency(item.value_cents, item.currency)
        : '—',
    close: item.expected_close_on,
    // Compared as date strings: parsing '2026-08-14' lands at UTC midnight,
    // which would call a card overdue for its whole expected-close day.
    pastDue: item.status === 'open' && item.expected_close_on !== null && item.expected_close_on < today,
    ownerName: item.owner ? (item.owner.full_name?.trim() || item.owner.email) : 'Unassigned',
    nextStep: item.next_step ? truncate(item.next_step, 60) : '—',
  }))

  return (
    <>
      <div className="hidden overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-card sm:block">
        <table className="w-full min-w-[56rem] text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs font-medium text-slate-500">
              <th scope="col" className="px-4 py-2.5 font-medium">Opportunity</th>
              <th scope="col" className="px-4 py-2.5 font-medium">Person</th>
              <th scope="col" className="px-4 py-2.5 font-medium">Pipeline · Stage</th>
              <th scope="col" className="px-4 py-2.5 text-right font-medium">Value</th>
              <th scope="col" className="px-4 py-2.5 font-medium">Expected close</th>
              <th scope="col" className="px-4 py-2.5 font-medium">Owner</th>
              <th scope="col" className="px-4 py-2.5 font-medium">Next step</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200/70">
            {rows.map((row) => (
              <tr key={row.id} className="align-top">
                <td className="max-w-64 px-4 py-3">
                  <Link
                    href={row.boardHref}
                    className="font-medium text-slate-900 underline-offset-2 hover:text-brand-700 hover:underline"
                  >
                    {row.title}
                  </Link>
                  {row.organization ? (
                    <p className="mt-0.5 truncate text-xs text-slate-500">{row.organization}</p>
                  ) : null}
                </td>
                <td className="px-4 py-3">
                  <Link
                    href={`/contacts/${row.contactId}`}
                    className="text-slate-700 underline-offset-2 hover:text-brand-700 hover:underline"
                  >
                    {row.contactName}
                  </Link>
                </td>
                <td className="px-4 py-3 text-slate-600">
                  <span className="inline-flex flex-wrap items-center gap-1.5">
                    {row.pipelineName}
                    {row.stage ? (
                      <>
                        <span aria-hidden="true">·</span>
                        <Badge tone={badgeTone(row.stage.color)}>{row.stage.name}</Badge>
                      </>
                    ) : null}
                  </span>
                </td>
                <td className="px-4 py-3 text-right tabular-nums text-slate-700">{row.value}</td>
                <td className="px-4 py-3">
                  <span className={cn(row.pastDue ? 'font-medium text-red-700' : 'text-slate-600')}>
                    {formatDate(row.close)}
                  </span>
                  {row.pastDue ? (
                    <p className="text-xs font-medium text-red-700">Overdue</p>
                  ) : null}
                </td>
                <td className="px-4 py-3 text-slate-600">{row.ownerName}</td>
                <td className="max-w-52 truncate px-4 py-3 text-slate-600" title={row.nextStep}>
                  {row.nextStep}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="space-y-3 sm:hidden">
        {rows.map((row) => (
          <li
            key={row.id}
            className="space-y-2 rounded-lg border border-slate-200 bg-white p-4 shadow-card"
          >
            <div>
              <Link
                href={row.boardHref}
                className="text-sm font-semibold text-slate-900 underline-offset-2 hover:text-brand-700 hover:underline"
              >
                {row.title}
              </Link>
              {row.organization ? (
                <p className="truncate text-xs text-slate-500">{row.organization}</p>
              ) : null}
            </div>

            <p className="text-sm">
              <Link
                href={`/contacts/${row.contactId}`}
                className="text-slate-700 underline-offset-2 hover:text-brand-700 hover:underline"
              >
                {row.contactName}
              </Link>
            </p>

            <p className="flex flex-wrap items-center gap-1.5 text-xs text-slate-600">
              {row.pipelineName}
              {row.stage ? (
                <>
                  <span aria-hidden="true">·</span>
                  <Badge tone={badgeTone(row.stage.color)}>{row.stage.name}</Badge>
                </>
              ) : null}
            </p>

            <dl className="space-y-0.5 text-xs text-slate-500">
              <div className="flex gap-1">
                <dt>Value</dt>
                <dd className="font-medium tabular-nums text-slate-600">{row.value}</dd>
              </div>
              <div className="flex gap-1">
                <dt>Expected close</dt>
                <dd className={cn('font-medium', row.pastDue ? 'text-red-700' : 'text-slate-600')}>
                  {formatDate(row.close)}
                  {row.pastDue ? ' — overdue' : ''}
                </dd>
              </div>
              <div className="flex gap-1">
                <dt>Owner</dt>
                <dd className="font-medium text-slate-600">{row.ownerName}</dd>
              </div>
              {row.nextStep !== '—' ? (
                <div className="flex gap-1">
                  <dt>Next</dt>
                  <dd className="min-w-0 truncate font-medium text-slate-600">{row.nextStep}</dd>
                </div>
              ) : null}
            </dl>
          </li>
        ))}
      </ul>
    </>
  )
}
