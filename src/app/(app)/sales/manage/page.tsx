import Link from 'next/link'
import { CreatePipelineForm } from '@/components/domain/pipeline-manage'
import { LinkButton } from '@/components/ui/button'
import { Badge, Card, CardBody, CardHeader, PageHeader } from '@/components/ui/display'
import { SectionHeading } from '@/components/ui/tabs'
import { requireWriteAccess } from '@/lib/auth'
import { listPipelinesForManage } from '@/lib/queries/pipelines'
import { pluralize } from '@/lib/utils'
import { createPipeline } from './actions'

export const metadata = { title: 'Manage pipelines' }

/**
 * The pipeline catalogue: what exists, what each holds, and the door into
 * each editor. Creation lives here too — a pipeline is a small thing to
 * start; the work is in its stages.
 */
export default async function ManagePipelinesPage() {
  await requireWriteAccess()
  const pipelines = await listPipelinesForManage()

  const active = pipelines.filter((pipeline) => pipeline.is_active)
  const archived = pipelines.filter((pipeline) => !pipeline.is_active)

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        eyebrow="Sales"
        title="Manage pipelines"
        description="Shared structure for the whole team — every change here changes everyone's boards."
        action={
          <LinkButton href="/sales" variant="secondary">
            Back to Sales
          </LinkButton>
        }
      />

      <section className="space-y-3">
        <SectionHeading title="Pipelines" />
        {active.length === 0 ? (
          <p className="text-sm leading-relaxed text-slate-600">
            No live pipelines. Create one below, give it stages, and its board appears on Sales.
          </p>
        ) : (
          <ul className="divide-y divide-slate-200 rounded-lg border border-slate-200 bg-white shadow-card">
            {active.map((pipeline) => (
              <li key={pipeline.id}>
                <Link
                  href={`/sales/manage/${pipeline.slug}`}
                  className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 transition-colors hover:bg-slate-50"
                >
                  <span className="min-w-0 flex-1 basis-48">
                    <span className="block truncate text-sm font-medium text-brand-700">
                      {pipeline.name}
                    </span>
                    {pipeline.description ? (
                      <span className="block truncate text-[13px] text-slate-600">
                        {pipeline.description}
                      </span>
                    ) : null}
                  </span>
                  {pipeline.is_default ? <Badge tone="brand">Default</Badge> : null}
                  {pipeline.tracks_value ? <Badge tone="emerald">Tracks value</Badge> : null}
                  <span className="shrink-0 text-[13px] text-slate-500">
                    {pluralize(pipeline.stage_count, 'stage')} ·{' '}
                    {pluralize(pipeline.open_count, 'open opportunity', 'open opportunities')}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {archived.length > 0 ? (
        <section className="space-y-3">
          <SectionHeading
            title="Archived"
            description="Read-only boards. Open one to restore it."
          />
          <ul className="divide-y divide-slate-200/70 rounded-lg border border-slate-200 bg-slate-50/60">
            {archived.map((pipeline) => (
              <li key={pipeline.id}>
                <Link
                  href={`/sales/manage/${pipeline.slug}`}
                  className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 transition-colors hover:bg-slate-100/70"
                >
                  <span className="min-w-0 flex-1 basis-48 truncate text-sm text-slate-600">
                    {pipeline.name}
                  </span>
                  <span className="shrink-0 text-[13px] text-slate-500">
                    {pluralize(pipeline.card_count, 'opportunity', 'opportunities')}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <Card>
        <CardHeader
          title="New pipeline"
          description="It starts empty — add stages next, then it can hold opportunities."
        />
        <CardBody>
          <CreatePipelineForm action={createPipeline} />
        </CardBody>
      </Card>
    </div>
  )
}
