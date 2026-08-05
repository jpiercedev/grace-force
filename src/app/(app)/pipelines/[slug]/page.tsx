import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { PipelineBoard } from '@/components/domain/pipeline-board'
import { LinkButton } from '@/components/ui/button'
import { Callout, Card, EmptyState, PageHeader, StatTile } from '@/components/ui/display'
import { canWrite, requireProfile } from '@/lib/auth'
import { getPipelineBoard, getPipelineBySlug } from '@/lib/queries/pipelines'
import { formatCurrency } from '@/lib/utils'
import { updatePipelineCard } from '../actions'

type RouteParams = Promise<{ slug: string }>

export async function generateMetadata({ params }: { params: RouteParams }): Promise<Metadata> {
  const { slug } = await params
  const pipeline = await getPipelineBySlug(slug)
  return { title: pipeline?.name ?? 'Pipeline' }
}

export default async function PipelineBoardPage({ params }: { params: RouteParams }) {
  const profile = await requireProfile()
  const { slug } = await params
  const board = await getPipelineBoard(slug)
  if (!board) notFound()

  const editable = canWrite(profile) && board.pipeline.is_active

  return (
    <div className="space-y-5">
      <PageHeader
        title={board.pipeline.name}
        description={board.pipeline.description}
        action={
          <>
            <LinkButton href="/pipelines" variant="secondary">
              All pipelines
            </LinkButton>
            {editable ? (
              <LinkButton href={`/pipelines/${board.pipeline.slug}/add`}>Add a contact</LinkButton>
            ) : null}
          </>
        }
      />

      {board.pipeline.is_active ? null : (
        <Callout tone="warning" title="Archived pipeline">
          This pipeline is no longer active, so cards on it are read-only.
        </Callout>
      )}

      {/* StatTile renders its own <dl>, so the grid stays a plain container. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile label="Open cards" value={board.open_count} tone="brand" />
        {board.open_value_cents !== null ? (
          <StatTile label="Open value" value={formatCurrency(board.open_value_cents)} />
        ) : null}
        <StatTile label="Won" value={board.won_count} tone="emerald" />
        <StatTile label="Lost" value={board.lost_count} />
      </div>

      {board.stages.length === 0 ? (
        <Card>
          <EmptyState
            title="No stages yet"
            description="An administrator needs to add stages before this pipeline can hold work."
          />
        </Card>
      ) : (
        <PipelineBoard board={board} canEdit={editable} action={updatePipelineCard} />
      )}
    </div>
  )
}
