import type { PipelineActionState } from '@/app/(app)/pipelines/actions'
import { PipelineCard } from '@/components/domain/pipeline-card'
import { Badge, badgeTone } from '@/components/ui/display'
import type { PipelineBoard as PipelineBoardData } from '@/lib/queries/pipelines'
import { stageOutcomeLabel } from '@/lib/validation/pipeline'

export interface PipelineBoardProps {
  board: PipelineBoardData
  canEdit: boolean
  action: (prev: PipelineActionState, formData: FormData) => Promise<PipelineActionState>
}

/**
 * Stage columns side by side.
 *
 * The horizontal scroll lives on this container, never on the page body, so a
 * narrow screen scrolls the board rather than the whole layout.
 */
export function PipelineBoard({ board, canEdit, action }: PipelineBoardProps) {
  const stageOptions = board.stages.map((stage) => ({ id: stage.id, name: stage.name }))

  return (
    <div className="overflow-x-auto pb-2">
      <ul className="flex gap-4">
        {board.stages.map((stage) => {
          const headingId = `pipeline-stage-${stage.id}`
          const outcome = stageOutcomeLabel(stage)
          return (
            <li key={stage.id} className="w-[17rem] shrink-0">
              <section
                aria-labelledby={headingId}
                className="flex h-full flex-col rounded-lg bg-slate-100/70 p-2"
              >
                <div className="flex items-center justify-between gap-2 px-1 pb-2">
                  <h2 id={headingId} className="text-sm font-semibold text-slate-900">
                    {stage.name}
                  </h2>
                  <Badge tone={badgeTone(stage.color)}>
                    <span className="tabular-nums">{stage.cards.length}</span>
                    <span className="sr-only"> open cards</span>
                  </Badge>
                </div>

                {outcome ? (
                  <p className="px-1 pb-2 text-xs text-slate-500">{outcome}</p>
                ) : null}

                {stage.cards.length === 0 ? (
                  <p className="px-1 py-3 text-xs text-slate-500">Nothing in this stage.</p>
                ) : (
                  <ul className="space-y-2">
                    {stage.cards.map((card) => (
                      <PipelineCard
                        key={card.id}
                        card={card}
                        stages={stageOptions}
                        tracksValue={board.pipeline.tracks_value}
                        canEdit={canEdit}
                        action={action}
                      />
                    ))}
                  </ul>
                )}
              </section>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
