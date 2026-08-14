import Link from 'next/link'
import { Badge, Card, EmptyState, PageHeader, badgeTone } from '@/components/ui/display'
import { Button, LinkButton } from '@/components/ui/button'
import { Input, Label, Select } from '@/components/ui/form'
import { canWrite, requireProfile } from '@/lib/auth'
import {
  OPPORTUNITY_LIST_LIMIT,
  listAssignableProfiles,
  listOpportunities,
  listPipelineSummaries,
  type OpportunityFilters,
  type OpportunityListItem,
} from '@/lib/queries/pipelines'
import { CARD_STATUS_LABELS, CARD_STATUS_TONES } from '@/lib/validation/pipeline'
import { contactDisplayName, formatCurrency, formatDate, pluralize } from '@/lib/utils'
import type { PipelineCardStatus } from '@/types/database'

export const metadata = { title: 'Opportunities' }

type SearchParams = Promise<Record<string, string | string[] | undefined>>

function single(value: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(value) ? value[0] : value
  return raw?.trim() || undefined
}

const STATUS_VALUES = ['open', 'won', 'lost', 'archived', 'all'] as const
type StatusFilter = (typeof STATUS_VALUES)[number]

function parseStatus(value: string | undefined): StatusFilter {
  return (STATUS_VALUES as readonly string[]).includes(value ?? '') ? (value as StatusFilter) : 'open'
}

const DUE_WINDOWS: Record<string, { label: string; days: number }> = {
  overdue: { label: 'Past their close date', days: 0 },
  '7': { label: 'Next 7 days', days: 7 },
  '30': { label: 'Next 30 days', days: 30 },
  '90': { label: 'Next 90 days', days: 90 },
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function parseId(value: string | undefined): string | undefined {
  return value && UUID.test(value) ? value : undefined
}

/** Owner cell / meta line. */
function ownerName(item: OpportunityListItem): string {
  return item.owner ? (item.owner.full_name?.trim() || item.owner.email) : 'Unassigned'
}

/**
 * The flat, filterable view of every opportunity — the table complement to
 * the boards, and the screen that answers "what is assigned to whom, and
 * what is due". On phones the table becomes stacked summaries.
 */
export default async function OpportunitiesPage({
  searchParams,
}: {
  searchParams: SearchParams
}) {
  const profile = await requireProfile()
  const query = await searchParams

  const status = parseStatus(single(query.status))
  const pipelineId = parseId(single(query.pipeline))
  const rawStageId = parseId(single(query.stage))
  const rawOwner = single(query.owner)
  const ownerId = rawOwner === 'unassigned' ? 'unassigned' : parseId(rawOwner)
  const due = single(query.due)
  const dueWindow = due ? DUE_WINDOWS[due] : undefined
  const q = single(query.q)

  const [pipelines, team] = await Promise.all([listPipelineSummaries(), listAssignableProfiles()])

  const activePipeline = pipelines.find((pipeline) => pipeline.id === pipelineId)
  const stages = activePipeline?.stages ?? []
  // Switching pipelines resubmits the previous pipeline's stage — silently
  // matching nothing. A stage filter only counts when it belongs to the
  // pipeline actually selected.
  const stageId = stages.some((stage) => stage.id === rawStageId) ? rawStageId : undefined

  const filters: OpportunityFilters = {
    status: status === 'all' ? 'all' : (status as PipelineCardStatus),
    pipelineId,
    stageId,
    ownerId,
    closeWithinDays: dueWindow?.days,
    q,
  }

  const items = await listOpportunities(filters)

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <PageHeader
        eyebrow="Sales"
        title="Opportunities"
        description="Every opportunity across every pipeline, in one filterable list."
        action={
          <>
            <LinkButton href="/sales" variant="secondary">
              Boards
            </LinkButton>
            {canWrite(profile) ? <LinkButton href="/sales/new">New opportunity</LinkButton> : null}
          </>
        }
      />

      {/* GET form: the filtered list is a real URL — shareable, refreshable. */}
      <form
        method="get"
        action="/sales/opportunities"
        className="flex flex-wrap items-end gap-x-3 gap-y-3 rounded-lg border border-slate-200 bg-white p-3.5 shadow-card"
      >
        <div className="min-w-0 flex-1 basis-52 space-y-1.5">
          <Label htmlFor="filter-q">Search</Label>
          <Input
            id="filter-q"
            name="q"
            type="search"
            defaultValue={q ?? ''}
            placeholder="Person, organization or title"
          />
        </div>
        <div className="w-40 space-y-1.5">
          <Label htmlFor="filter-pipeline">Pipeline</Label>
          <Select id="filter-pipeline" name="pipeline" defaultValue={pipelineId ?? ''}>
            <option value="">All pipelines</option>
            {pipelines.map((pipeline) => (
              <option key={pipeline.id} value={pipeline.id}>
                {pipeline.name}
              </option>
            ))}
          </Select>
        </div>
        {activePipeline ? (
          <div className="w-40 space-y-1.5">
            <Label htmlFor="filter-stage">Stage</Label>
            <Select id="filter-stage" name="stage" defaultValue={stageId ?? ''}>
              <option value="">All stages</option>
              {stages.map((stage) => (
                <option key={stage.id} value={stage.id}>
                  {stage.name}
                </option>
              ))}
            </Select>
          </div>
        ) : null}
        <div className="w-40 space-y-1.5">
          <Label htmlFor="filter-owner">Owner</Label>
          <Select id="filter-owner" name="owner" defaultValue={rawOwner ?? ''}>
            <option value="">Anyone</option>
            <option value="unassigned">Unassigned</option>
            {team.map((member) => (
              <option key={member.id} value={member.id}>
                {member.full_name?.trim() || member.email}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-40 space-y-1.5">
          <Label htmlFor="filter-due">Expected close</Label>
          <Select id="filter-due" name="due" defaultValue={due ?? ''}>
            <option value="">Any time</option>
            {Object.entries(DUE_WINDOWS).map(([key, window]) => (
              <option key={key} value={key}>
                {window.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="w-32 space-y-1.5">
          <Label htmlFor="filter-status">Status</Label>
          <Select id="filter-status" name="status" defaultValue={status}>
            {STATUS_VALUES.map((value) => (
              <option key={value} value={value}>
                {value === 'all' ? 'Any status' : CARD_STATUS_LABELS[value as PipelineCardStatus]}
              </option>
            ))}
          </Select>
        </div>
        <Button type="submit" variant="secondary">
          Filter
        </Button>
      </form>

      <p className="text-sm text-slate-600" role="status">
        {items.length === OPPORTUNITY_LIST_LIMIT
          ? `Showing the first ${OPPORTUNITY_LIST_LIMIT} matches — narrow the filters to see the rest.`
          : pluralize(items.length, 'opportunity', 'opportunities')}
      </p>

      {items.length === 0 ? (
        <Card>
          <EmptyState
            title="Nothing matches these filters"
            description="Loosen a filter, or start a new opportunity from a person's record."
          />
        </Card>
      ) : (
        <>
          {/* Table from md up… */}
          <div className="hidden overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-card md:block">
            <table className="w-full min-w-[52rem] border-collapse text-sm">
              <thead>
                <tr className="bg-slate-50 text-left text-xs text-slate-500">
                  <th scope="col" className="px-3.5 py-2.5 font-medium">Opportunity</th>
                  <th scope="col" className="px-3.5 py-2.5 font-medium">Person</th>
                  <th scope="col" className="px-3.5 py-2.5 font-medium">Stage</th>
                  <th scope="col" className="px-3.5 py-2.5 font-medium">Owner</th>
                  <th scope="col" className="px-3.5 py-2.5 text-right font-medium">Value</th>
                  <th scope="col" className="px-3.5 py-2.5 font-medium">Expected close</th>
                  <th scope="col" className="px-3.5 py-2.5 font-medium">Next step</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {items.map((item) => (
                  <tr key={item.id} className="align-top transition-colors hover:bg-slate-50">
                    <td className="max-w-64 px-3.5 py-2.5">
                      <Link
                        href={`/sales/opportunities/${item.id}`}
                        className="font-medium text-brand-700 hover:underline"
                      >
                        {item.title}
                      </Link>
                      <p className="truncate text-xs text-slate-500">
                        {item.pipeline?.name}
                        {item.organization_name ? ` · ${item.organization_name}` : ''}
                      </p>
                    </td>
                    <td className="max-w-48 px-3.5 py-2.5">
                      {item.contact ? (
                        <Link
                          href={`/contacts/${item.contact_id}`}
                          className="text-slate-900 hover:text-brand-700 hover:underline"
                        >
                          {contactDisplayName(item.contact)}
                        </Link>
                      ) : (
                        <span className="text-slate-500">Unknown</span>
                      )}
                    </td>
                    <td className="px-3.5 py-2.5">
                      {item.status === 'open' && item.stage ? (
                        <Badge tone={badgeTone(item.stage.color)}>{item.stage.name}</Badge>
                      ) : (
                        <Badge tone={CARD_STATUS_TONES[item.status]}>
                          {CARD_STATUS_LABELS[item.status]}
                        </Badge>
                      )}
                    </td>
                    <td className="max-w-40 truncate px-3.5 py-2.5 text-slate-700">
                      {ownerName(item)}
                    </td>
                    <td className="px-3.5 py-2.5 text-right tabular-nums text-slate-900">
                      {item.pipeline?.tracks_value && item.value_cents !== null
                        ? formatCurrency(item.value_cents, item.currency)
                        : '—'}
                    </td>
                    <td className="px-3.5 py-2.5 text-slate-700">
                      {item.expected_close_on ? formatDate(item.expected_close_on) : '—'}
                    </td>
                    <td className="max-w-56 truncate px-3.5 py-2.5 text-slate-600" title={item.next_step ?? undefined}>
                      {item.next_step ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* …stacked summaries below it — never a squeezed table. */}
          <ul className="space-y-3 md:hidden">
            {items.map((item) => (
              <li
                key={item.id}
                className="space-y-1.5 rounded-lg border border-slate-200 bg-white p-3.5 shadow-card"
              >
                <div className="flex items-start justify-between gap-3">
                  <Link
                    href={`/sales/opportunities/${item.id}`}
                    className="min-w-0 text-sm font-semibold text-brand-700 hover:underline"
                  >
                    {item.title}
                  </Link>
                  {item.status === 'open' && item.stage ? (
                    <Badge tone={badgeTone(item.stage.color)}>{item.stage.name}</Badge>
                  ) : (
                    <Badge tone={CARD_STATUS_TONES[item.status]}>
                      {CARD_STATUS_LABELS[item.status]}
                    </Badge>
                  )}
                </div>
                <p className="text-[13px] text-slate-600">
                  {item.contact ? (
                    <Link href={`/contacts/${item.contact_id}`} className="font-medium hover:underline">
                      {contactDisplayName(item.contact)}
                    </Link>
                  ) : (
                    'Unknown person'
                  )}
                  {item.pipeline ? ` · ${item.pipeline.name}` : ''}
                </p>
                <p className="text-[13px] text-slate-500">
                  {ownerName(item)}
                  {item.expected_close_on ? ` · closes ${formatDate(item.expected_close_on)}` : ''}
                  {item.pipeline?.tracks_value && item.value_cents !== null
                    ? ` · ${formatCurrency(item.value_cents, item.currency)}`
                    : ''}
                </p>
                {item.next_step ? (
                  <p className="text-[13px] text-slate-600">Next: {item.next_step}</p>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}
