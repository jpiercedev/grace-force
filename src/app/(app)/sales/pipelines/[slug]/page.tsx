import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { PipelineEditor } from '@/components/domain/pipeline-editor'
import { LinkButton } from '@/components/ui/button'
import { Callout, PageHeader } from '@/components/ui/display'
import { canWrite, requireProfile } from '@/lib/auth'
import { getPipelineForManage } from '@/lib/queries/pipelines'
import { managePipeline } from '../actions'

type RouteParams = Promise<{ slug: string }>

export async function generateMetadata({ params }: { params: RouteParams }): Promise<Metadata> {
  const { slug } = await params
  const pipeline = await getPipelineForManage(slug)
  return { title: pipeline ? `Edit ${pipeline.name}` : 'Edit pipeline' }
}

export default async function EditPipelinePage({ params }: { params: RouteParams }) {
  const profile = await requireProfile()
  const { slug } = await params
  const pipeline = await getPipelineForManage(slug)
  if (!pipeline) notFound()

  const canEdit = canWrite(profile)

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader
        eyebrow={
          <Link href="/sales/pipelines" className="hover:text-brand-700 hover:underline">
            Pipelines
          </Link>
        }
        title={pipeline.name}
        description={
          canEdit
            ? 'Rename it, shape its stages, or retire it — the whole team sees the change.'
            : 'A read-only view — ask an administrator for write access to change pipelines.'
        }
        action={
          <LinkButton href={`/pipelines/${pipeline.slug}`} variant="secondary">
            Open board
          </LinkButton>
        }
      />

      {!pipeline.is_active ? (
        <Callout tone="warning" title="Archived pipeline">
          This pipeline is out of daily use and its board is read-only.
          {canEdit ? ' Restore it from the danger zone below to bring it back.' : ''}
        </Callout>
      ) : null}

      <PipelineEditor pipeline={pipeline} canEdit={canEdit} action={managePipeline} />
    </div>
  )
}
