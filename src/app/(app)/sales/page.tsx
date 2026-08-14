import Link from 'next/link'
import {
  Badge,
  Card,
  EmptyState,
  PageHeader,
  badgeTone,
  type BadgeTone,
} from '@/components/ui/display'
import { LinkButton } from '@/components/ui/button'
import { SectionHeading } from '@/components/ui/tabs'
import { canWrite, requireProfile } from '@/lib/auth'
import {
  getSalesOverview,
  listPipelineSummaries,
  type OpportunityListItem,
} from '@/lib/queries/pipelines'
import { cn, contactDisplayName, formatCurrency, formatDate, pluralize } from '@/lib/utils'

export const metadata = { title: 'Sales' }

/**
 * Stage identity dots, mirroring the Badge dot colors. Written out literally
 * because Tailwind's compiler only keeps classes it can see.
 */
const STAGE_DOTS: Record<BadgeTone, string> = {
  slate: 'bg-slate-400',
  zinc: 'bg-slate-400',
  emerald: 'bg-emerald-500',
  sky: 'bg-sky-500',
  indigo: 'bg-indigo-500',
  violet: 'bg-violet-500',
  amber: 'bg-amber-500',
  rose: 'bg-rose-500',
  red: 'bg-red-600',
  brand: 'bg-brand-500',
}

/** Plain label + figure, inline on the canvas — not a row of tiles. */
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

function ClosingSoonRow({ item }: { item: OpportunityListItem }) {
  const person = item.contact ? contactDisplayName(item.contact) : 'Unknown person'
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5">
      <div className="min-w-0 flex-1 basis-52">
        <Link
          href={`/sales/opportunities/${item.id}`}
          className="block truncate text-sm font-medium text-brand-700 hover:underline"
        >
          {item.title}
        </Link>
        <p className="truncate text-[13px] text-slate-600">
          <Link href={`/contacts/${item.contact_id}`} className="hover:underline">
            {person}
          </Link>
          {item.pipeline ? ` · ${item.pipeline.name}` : ''}
          {item.stage ? ` · ${item.stage.name}` : ''}
        </p>
        {item.next_step ? (
          <p className="truncate text-[13px] text-slate-500">Next: {item.next_step}</p>
        ) : null}
      </div>
      <div className="shrink-0 text-right">
        {item.expected_close_on ? (
          <p className="text-[13px] font-medium text-slate-700">
            {formatDate(item.expected_close_on)}
          </p>
        ) : null}
        {item.pipeline?.tracks_value && item.value_cents !== null ? (
          <p className="text-[13px] font-semibold tabular-nums text-slate-900">
            {formatCurrency(item.value_cents, item.currency)}
          </p>
        ) : null}
      </div>
    </li>
  )
}

/**
 * The Sales overview: what is in flight, which boards it lives on, and what
 * is about to land. People-first — every row leads back to a person.
 */
export default async function SalesPage() {
  const profile = await requireProfile()
  const writable = canWrite(profile)

  const [overview, pipelines] = await Promise.all([getSalesOverview(), listPipelineSummaries()])

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        title="Sales"
        description="Every open opportunity, on shared boards the whole team can see."
        action={
          writable ? (
            <>
              <LinkButton href="/sales/manage" variant="secondary">
                Manage pipelines
              </LinkButton>
              <LinkButton href="/sales/new">New opportunity</LinkButton>
            </>
          ) : null
        }
      />

      <dl className="flex flex-wrap items-end gap-x-10 gap-y-4 border-y border-slate-200 py-4">
        <Figure label="Open opportunities" value={overview.open_count} />
        <Figure label="Open value" value={formatCurrency(overview.open_value_cents)} />
        <Figure label="Closing in 30 days" value={overview.closing_soon_count} />
        <Figure label="Won this quarter" value={overview.won_this_quarter} />
        <div className="ml-auto self-center">
          <Link
            href="/sales/opportunities"
            className="text-sm font-medium text-brand-700 hover:underline"
          >
            All opportunities →
          </Link>
        </div>
      </dl>

      {pipelines.length === 0 ? (
        <Card>
          <EmptyState
            title="No active pipelines"
            description={
              writable
                ? 'Create a pipeline and its stages, and shared boards will appear here.'
                : 'Boards will appear here once a staff member creates a pipeline.'
            }
            action={writable ? <LinkButton href="/sales/manage">Manage pipelines</LinkButton> : null}
          />
        </Card>
      ) : (
        <section className="space-y-3">
          <SectionHeading title="Pipelines" description="Each board is shared with the whole team." />
          <div className="grid gap-4 sm:grid-cols-2">
            {/* Each card is one door: the whole surface opens the board. */}
            {pipelines.map((pipeline) => (
              <Link
                key={pipeline.id}
                href={`/sales/pipelines/${pipeline.slug}`}
                className="group flex flex-col rounded-lg border border-slate-200 bg-white p-5 shadow-card transition-colors duration-150 hover:border-slate-300 hover:bg-slate-50"
              >
                <div className="flex items-start justify-between gap-3">
                  <h3 className="min-w-0 text-base font-semibold text-slate-900 transition-colors duration-150 group-hover:text-brand-700">
                    {pipeline.name}
                  </h3>
                  {pipeline.is_default ? <Badge tone="brand">Default</Badge> : null}
                </div>

                {pipeline.description ? (
                  <p className="mt-1 text-sm leading-relaxed text-slate-600">
                    {pipeline.description}
                  </p>
                ) : null}

                {pipeline.stages.length === 0 ? (
                  <p className="mb-5 mt-4 text-sm text-slate-500">
                    This pipeline has no stages yet.
                  </p>
                ) : (
                  <ul className="mb-5 mt-4 flex flex-wrap gap-x-4 gap-y-2">
                    {pipeline.stages.map((stage) => (
                      <li
                        key={stage.id}
                        className={cn(
                          'inline-flex items-center gap-1.5 text-xs',
                          stage.open_count === 0 ? 'text-slate-500' : 'font-medium text-slate-700',
                        )}
                      >
                        <span
                          aria-hidden="true"
                          className={cn(
                            'h-2 w-2 shrink-0 rounded-full',
                            STAGE_DOTS[badgeTone(stage.color)],
                            stage.open_count === 0 && 'opacity-40',
                          )}
                        />
                        {stage.name}
                        <span className="font-semibold tabular-nums">{stage.open_count}</span>
                        <span className="sr-only"> open opportunities</span>
                      </li>
                    ))}
                  </ul>
                )}

                <div className="mt-auto flex flex-wrap items-baseline justify-between gap-2 border-t border-slate-200 pt-3.5">
                  <p className="text-sm text-slate-600">
                    {pluralize(pipeline.open_count, 'open opportunity', 'open opportunities')}
                    {pipeline.open_value_cents !== null ? (
                      <>
                        {' · '}
                        <span className="text-sm font-semibold tabular-nums text-slate-900">
                          {formatCurrency(pipeline.open_value_cents)}
                        </span>{' '}
                        open
                      </>
                    ) : null}
                  </p>
                  <span className="text-sm font-medium text-brand-700">
                    Open board{' '}
                    <span
                      aria-hidden="true"
                      className="inline-block transition-transform duration-150 group-hover:translate-x-0.5 motion-reduce:transform-none"
                    >
                      →
                    </span>
                  </span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="space-y-3">
        <SectionHeading
          title="Closing soon"
          description="Open opportunities expected to close in the next 30 days."
          action={
            <Link
              href="/sales/opportunities?due=30"
              className="text-sm font-medium text-brand-700 hover:underline"
            >
              View all
            </Link>
          }
        />
        {overview.closing_soon.length === 0 ? (
          <p className="text-sm leading-relaxed text-slate-600">
            Nothing has an expected close date in the next 30 days. Opportunities with a close date
            will queue up here as it approaches.
          </p>
        ) : (
          <ul className="divide-y divide-slate-200 border-t border-slate-200">
            {overview.closing_soon.map((item) => (
              <ClosingSoonRow key={item.id} item={item} />
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
