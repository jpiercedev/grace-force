import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { PipelineSettingsForm, StageEditor } from '@/components/domain/pipeline-manage'
import { LinkButton } from '@/components/ui/button'
import { Callout, Card, CardBody, CardHeader } from '@/components/ui/display'
import { PageHeader } from '@/components/ui/display'
import { requireWriteAccess } from '@/lib/auth'
import { getPipelineForManage } from '@/lib/queries/pipelines'
import { addStage, updatePipeline, updateStage } from '../actions'

type RouteParams = Promise<{ slug: string }>

export async function generateMetadata({ params }: { params: RouteParams }): Promise<Metadata> {
  const { slug } = await params
  const pipeline = await getPipelineForManage(slug)
  return { title: pipeline ? `Edit ${pipeline.name}` : 'Edit pipeline' }
}

/**
 * One pipeline's editor: its name and description, its stages in order, and
 * the safe ends of its lifecycle. Destructive paths defer to the database
 * guards — the interface explains them, the triggers enforce them.
 */
export default async function EditPipelinePage({ params }: { params: RouteParams }) {
  await requireWriteAccess()
  const { slug } = await params

  const pipeline = await getPipelineForManage(slug)
  if (!pipeline) notFound()

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader
        eyebrow="Manage pipelines"
        title={pipeline.name}
        description="Changes apply to the shared board immediately."
        action={
          <>
            <LinkButton href="/sales/manage" variant="secondary">
              All pipelines
            </LinkButton>
            <LinkButton href={`/sales/pipelines/${pipeline.slug}`} variant="secondary">
              Open board
            </LinkButton>
          </>
        }
      />

      {pipeline.is_active ? null : (
        <Callout tone="warning" title="Archived pipeline">
          This pipeline is archived: its board is read-only and it no longer appears on Sales.
          Restore it below to bring it back.
        </Callout>
      )}

      <Card>
        <CardHeader title="Stages" description="Opportunities move left to right through these." />
        <CardBody>
          <StageEditor pipeline={pipeline} addAction={addStage} updateAction={updateStage} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Pipeline settings" />
        <CardBody>
          <PipelineSettingsForm pipeline={pipeline} action={updatePipeline} />
        </CardBody>
      </Card>
    </div>
  )
}
