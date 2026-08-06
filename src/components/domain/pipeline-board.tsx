'use client'

import { useActionState, useEffect, useRef } from 'react'
import type { PipelineActionState } from '@/app/(app)/pipelines/actions'
import { PipelineCard } from '@/components/domain/pipeline-card'
import { Badge, Callout, badgeTone, type BadgeTone } from '@/components/ui/display'
import type { PipelineBoard as PipelineBoardData } from '@/lib/queries/pipelines'
import { cn } from '@/lib/utils'
import { CARD_STATUS_TONES, stageOutcomeLabel } from '@/lib/validation/pipeline'

export interface PipelineBoardProps {
  board: PipelineBoardData
  canEdit: boolean
  action: (prev: PipelineActionState, formData: FormData) => Promise<PipelineActionState>
}

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

/**
 * Stage columns side by side.
 *
 * The horizontal scroll lives on this container, never on the page body, so a
 * narrow screen scrolls the board rather than the whole layout.
 *
 * Every card shares this component's action state. A card that moves is
 * re-rendered inside a different column, which unmounts it — a message held on
 * the card itself would vanish with it, and the keyboard focus already does.
 * Reporting here, and taking focus, is what stops a move from being silent.
 */
export function PipelineBoard({ board, canEdit, action }: PipelineBoardProps) {
  const [state, formAction] = useActionState<PipelineActionState, FormData>(action, {})
  const statusRef = useRef<HTMLDivElement>(null)
  const stageOptions = board.stages.map((stage) => ({ id: stage.id, name: stage.name }))
  const message = state.error ?? state.notice

  useEffect(() => {
    if (message) statusRef.current?.focus()
  }, [state, message])

  return (
    <div className="space-y-3">
      {message ? (
        <div ref={statusRef} tabIndex={-1}>
          <Callout
            tone={state.error ? 'danger' : 'success'}
            role={state.error ? 'alert' : 'status'}
          >
            {message}
          </Callout>
        </div>
      ) : null}

      <div className="overflow-x-auto pb-3">
        <ul className="flex gap-4">
          {board.stages.map((stage) => {
            const headingId = `pipeline-stage-${stage.id}`
            const outcome = stageOutcomeLabel(stage)
            const stageOutcome = stage.is_won ? 'won' : stage.is_lost ? 'lost' : null
            // Flexible column widths so the board never ends flush at the
            // container edge: when every stage fits, columns grow to share the
            // row; when they don't, the cut lands mid-column and the partial
            // column is the cue that there is more to scroll to.
            return (
              <li key={stage.id} className="min-w-[15rem] max-w-[20rem] flex-1 shrink-0">
                <section
                  aria-labelledby={headingId}
                  className="flex h-full flex-col rounded-xl bg-slate-100/50 p-2.5 ring-1 ring-inset ring-slate-200/70"
                >
                  <div className="flex items-center justify-between gap-2 px-1 pb-2.5 pt-0.5">
                    <h2
                      id={headingId}
                      className="flex min-w-0 items-center gap-2 text-sm font-semibold text-slate-900"
                    >
                      <span
                        aria-hidden="true"
                        className={cn(
                          'h-2 w-2 shrink-0 rounded-full',
                          STAGE_DOTS[badgeTone(stage.color)],
                        )}
                      />
                      <span className="truncate">{stage.name}</span>
                    </h2>
                    <span className="shrink-0 rounded-full bg-white px-2 py-0.5 text-xs font-semibold tabular-nums text-slate-600 ring-1 ring-inset ring-slate-200/70">
                      {stage.cards.length}
                      <span className="sr-only"> open cards</span>
                    </span>
                  </div>

                  {outcome ? (
                    <div className="px-1 pb-2.5">
                      <Badge tone={CARD_STATUS_TONES[stage.is_won ? 'won' : 'lost']}>
                        {outcome}
                      </Badge>
                    </div>
                  ) : null}

                  {stage.cards.length === 0 ? (
                    <p className="px-2 py-8 text-center text-sm text-slate-500">
                      Nothing in this stage.
                    </p>
                  ) : (
                    <ul className="space-y-2.5">
                      {stage.cards.map((card) => (
                        <PipelineCard
                          key={card.id}
                          card={card}
                          stages={stageOptions}
                          tracksValue={board.pipeline.tracks_value}
                          canEdit={canEdit}
                          formAction={formAction}
                          stageOutcome={stageOutcome}
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
    </div>
  )
}
