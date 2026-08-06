import Link from 'next/link'
import {
  Badge,
  Card,
  EmptyState,
  PageHeader,
  badgeTone,
  type BadgeTone,
} from '@/components/ui/display'
import { requireProfile } from '@/lib/auth'
import { listPipelineSummaries } from '@/lib/queries/pipelines'
import { cn, formatCurrency, pluralize } from '@/lib/utils'

export const metadata = { title: 'Pipelines' }

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

export default async function PipelinesPage() {
  await requireProfile()
  const pipelines = await listPipelineSummaries()

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <PageHeader
        title="Pipelines"
        description="Staged work in flight, by process."
      />

      {pipelines.length === 0 ? (
        <Card>
          <EmptyState
            title="No active pipelines"
            description="An administrator can activate a pipeline in the database before boards appear here."
          />
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {/* Each card is one door: the whole surface opens the board, so it
              carries no separate button — just the name in the display voice,
              where the weight sits, and a quiet invitation. */}
          {pipelines.map((pipeline) => (
            <Link
              key={pipeline.id}
              href={`/pipelines/${pipeline.slug}`}
              className="group flex flex-col rounded-xl border border-slate-200/70 bg-white p-5 shadow-card transition-all duration-150 hover:-translate-y-0.5 hover:shadow-raised motion-reduce:transition-none motion-reduce:hover:translate-y-0"
            >
              <div className="flex items-start justify-between gap-3">
                <h2 className="min-w-0 font-display text-xl font-semibold tracking-tight text-slate-900 transition-colors duration-150 group-hover:text-brand-700">
                  {pipeline.name}
                </h2>
                {pipeline.is_default ? <Badge tone="brand">Default</Badge> : null}
              </div>

              {pipeline.description ? (
                <p className="mt-1 text-sm leading-relaxed text-slate-600">
                  {pipeline.description}
                </p>
              ) : null}

              {pipeline.stages.length === 0 ? (
                <p className="mb-5 mt-4 text-sm text-slate-500">This pipeline has no stages yet.</p>
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
                      <span className="sr-only"> open cards</span>
                    </li>
                  ))}
                </ul>
              )}

              <div className="mt-auto flex flex-wrap items-baseline justify-between gap-2 border-t border-slate-200/70 pt-3.5">
                <p className="text-sm text-slate-600">
                  {pluralize(pipeline.open_count, 'open card')}
                  {pipeline.open_value_cents !== null ? (
                    <>
                      {' · '}
                      <span className="font-display text-base font-semibold tabular-nums text-slate-900">
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
      )}
    </div>
  )
}
