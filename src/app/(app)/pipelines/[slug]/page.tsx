import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { PipelineBoard } from '@/components/domain/pipeline-board'
import { LinkButton } from '@/components/ui/button'
import { Callout, Card, EmptyState, PageHeader } from '@/components/ui/display'
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

/** Plain label + figure, inline on the canvas — not a row of tiles. */
function BoardFigure({
  label,
  value,
  dot,
  figureClass = 'text-slate-900',
}: {
  label: string
  value: string | number
  dot?: string
  figureClass?: string
}) {
  return (
    <div>
      <dt className="flex items-center gap-1.5 text-xs font-medium text-slate-500">
        {dot ? <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} /> : null}
        {label}
      </dt>
      <dd className={`mt-1.5 text-2xl font-semibold leading-none tabular-nums ${figureClass}`}>
        {value}
      </dd>
    </div>
  )
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
        eyebrow={
          <Link href="/sales" className="hover:text-brand-700 hover:underline">
            Sales
          </Link>
        }
        title={board.pipeline.name}
        description={board.pipeline.description}
        action={
          <>
            {canWrite(profile) ? (
              <LinkButton href={`/sales/pipelines/${board.pipeline.slug}`} variant="secondary">
                Edit pipeline
              </LinkButton>
            ) : null}
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

      {/* A ledger summary rule rather than a grid of tiles: the figures sit
          inline on the canvas between two hairlines. */}
      <dl className="flex flex-wrap items-end gap-x-10 gap-y-4 border-y border-slate-200 py-4">
        <BoardFigure label="Open cards" value={board.open_count} />
        {board.open_value_cents !== null ? (
          <BoardFigure label="Open value" value={formatCurrency(board.open_value_cents)} />
        ) : null}
        <BoardFigure
          label="Won"
          value={board.won_count}
          dot="bg-emerald-500"
          figureClass="text-emerald-800"
        />
        <BoardFigure
          label="Lost"
          value={board.lost_count}
          dot="bg-slate-400"
          figureClass="text-slate-600"
        />
      </dl>

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
