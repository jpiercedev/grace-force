import Link from 'next/link'
import { PipelineCreateForm } from '@/components/domain/pipeline-create-form'
import { LinkButton } from '@/components/ui/button'
import {
  Badge,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  PageHeader,
  badgeTone,
  type BadgeTone,
} from '@/components/ui/display'
import { canWrite, requireProfile } from '@/lib/auth'
import { listPipelinesForManage } from '@/lib/queries/pipelines'
import { cn, pluralize } from '@/lib/utils'
import { createPipeline } from './actions'

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

export default async function ManagePipelinesPage() {
  const profile = await requireProfile()
  const writable = canWrite(profile)
  const pipelines = await listPipelinesForManage()

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader
        eyebrow={
          <Link href="/sales" className="hover:text-brand-700 hover:underline">
            Sales
          </Link>
        }
        title="Pipelines"
        description="Shared by the whole team — a change here changes everyone's boards."
      />

      {pipelines.length === 0 ? (
        <Card>
          <EmptyState
            title="No pipelines yet"
            description="Create the first one below and it appears on the Sales overview."
          />
        </Card>
      ) : (
        <ul className="space-y-3">
          {pipelines.map((pipeline) => {
            const liveStages = pipeline.stages.filter((stage) => stage.archived_at === null)
            return (
              <li
                key={pipeline.id}
                className="rounded-lg border border-slate-200 bg-white p-5 shadow-card"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <h2 className="text-base font-semibold text-slate-900">{pipeline.name}</h2>
                    {pipeline.is_default ? <Badge tone="brand">Default</Badge> : null}
                    {!pipeline.is_active ? <Badge tone="slate">Archived</Badge> : null}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <LinkButton
                      href={`/pipelines/${pipeline.slug}`}
                      variant="ghost"
                      size="sm"
                    >
                      Open board
                    </LinkButton>
                    {writable ? (
                      <LinkButton
                        href={`/sales/pipelines/${pipeline.slug}`}
                        variant="secondary"
                        size="sm"
                      >
                        Edit
                      </LinkButton>
                    ) : null}
                  </div>
                </div>

                {pipeline.description ? (
                  <p className="mt-1 text-sm leading-relaxed text-slate-600">
                    {pipeline.description}
                  </p>
                ) : null}

                {liveStages.length === 0 ? (
                  <p className="mt-3 text-sm text-slate-500">No stages yet.</p>
                ) : (
                  <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-2">
                    {liveStages.map((stage) => (
                      <li
                        key={stage.id}
                        className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-700"
                      >
                        <span
                          aria-hidden="true"
                          className={cn(
                            'h-2 w-2 shrink-0 rounded-full',
                            STAGE_DOTS[badgeTone(stage.color)],
                          )}
                        />
                        {stage.name}
                      </li>
                    ))}
                  </ul>
                )}

                <p className="mt-3 border-t border-slate-200 pt-3 text-sm text-slate-600">
                  {pluralize(pipeline.open_count, 'open opportunity', 'open opportunities')}
                  {' · '}
                  {pluralize(pipeline.total_count, 'in total', 'in total')}
                </p>
              </li>
            )
          })}
        </ul>
      )}

      {writable ? (
        <Card>
          <CardHeader
            title="Create a pipeline"
            description="It starts without stages — add them on the next screen."
          />
          <CardBody className="py-5">
            <PipelineCreateForm action={createPipeline} />
          </CardBody>
        </Card>
      ) : null}
    </div>
  )
}
