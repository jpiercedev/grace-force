import Link from 'next/link'
import { LinkButton } from '@/components/ui/button'
import { Badge, Card, CardBody, CardHeader, EmptyState, PageHeader, badgeTone } from '@/components/ui/display'
import { requireProfile } from '@/lib/auth'
import { listPipelineSummaries } from '@/lib/queries/pipelines'
import { formatCurrency, pluralize } from '@/lib/utils'

export const metadata = { title: 'Pipelines' }

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
        <div className="space-y-4">
          {pipelines.map((pipeline) => (
            <Card key={pipeline.id}>
              <CardHeader
                title={
                  <Link
                    href={`/pipelines/${pipeline.slug}`}
                    className="text-brand-700 underline-offset-2 hover:underline"
                  >
                    {pipeline.name}
                  </Link>
                }
                description={pipeline.description}
                action={
                  <LinkButton href={`/pipelines/${pipeline.slug}`} variant="secondary" size="sm">
                    Open board
                  </LinkButton>
                }
              />
              <CardBody className="space-y-3">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-slate-600">
                  <span className="font-medium text-slate-900">
                    {pluralize(pipeline.open_count, 'open card')}
                  </span>
                  {pipeline.open_value_cents !== null ? (
                    <span>
                      Open value{' '}
                      <span className="font-semibold tabular-nums text-slate-900">
                        {formatCurrency(pipeline.open_value_cents)}
                      </span>
                    </span>
                  ) : null}
                  {pipeline.is_default ? <Badge tone="brand">Default</Badge> : null}
                </div>

                {pipeline.stages.length === 0 ? (
                  <p className="text-sm text-slate-500">This pipeline has no stages yet.</p>
                ) : (
                  <ul className="flex flex-wrap gap-2">
                    {pipeline.stages.map((stage) => (
                      <li key={stage.id}>
                        <Badge tone={badgeTone(stage.color)}>
                          {stage.name}
                          <span className="tabular-nums font-semibold">{stage.open_count}</span>
                          <span className="sr-only"> open cards</span>
                        </Badge>
                      </li>
                    ))}
                  </ul>
                )}
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
