'use client'

import { ArrowDown, ArrowUp, ChevronDown, ChevronRight } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useId, useRef, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { Button, type ButtonProps } from '@/components/ui/button'
import { Avatar } from '@/components/ui/display'
import { Field, Select, Textarea } from '@/components/ui/form'
import type { BoardCard } from '@/lib/queries/pipelines'
import { cn, contactDisplayName, formatCurrency, formatDate } from '@/lib/utils'
import { CLOSE_ACTIONS } from '@/lib/validation/pipeline'

export interface PipelineCardStageOption {
  id: string
  name: string
}

export interface PipelineCardProps {
  card: BoardCard
  stages: PipelineCardStageOption[]
  tracksValue: boolean
  canEdit: boolean
  /** Owned by the board, which survives a card moving between columns. */
  formAction: (formData: FormData) => void
  /** Set when the card sits in a terminal stage, so it can render settled. */
  stageOutcome?: 'won' | 'lost' | null
}

function SubmitButton({ children, ...props }: ButtonProps) {
  const { pending } = useFormStatus()
  return (
    <Button {...props} type="submit" disabled={pending}>
      {children}
    </Button>
  )
}

/**
 * Folds the card's title into a button's accessible name. A board column
 * otherwise offers a stack of buttons all called "Move", which is unusable
 * from a screen reader's element list.
 */
function Subject({ title }: { title: string }) {
  return <span className="sr-only">: {title}</span>
}

/**
 * A board card with an explicit, keyboard-operable stage control.
 *
 * Movement is a labelled select plus a submit button rather than a drag
 * handle: dragging is the enhancement, this is the interface.
 */
export function PipelineCard({
  card,
  stages,
  tracksValue,
  canEdit,
  formAction,
  stageOutcome = null,
}: PipelineCardProps) {
  const [closing, setClosing] = useState(false)
  const [closeReason, setCloseReason] = useState('')
  const stageSelectId = useId()
  const panelId = useId()
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!closing) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setClosing(false)
        setCloseReason('')
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [closing])

  useEffect(() => {
    if (!closing) return
    panelRef.current?.querySelector<HTMLElement>('textarea, button')?.focus()
  }, [closing])

  const contactName = card.contact ? contactDisplayName(card.contact) : 'Unknown contact'
  const ownerName = card.owner ? (card.owner.full_name?.trim() || card.owner.email) : 'Unassigned'

  // A card in a won or lost column — or one that has been closed — reads as
  // settled: tinted or muted, and it no longer rises to meet the cursor.
  const settled = stageOutcome !== null || card.status !== 'open'
  const wonish = stageOutcome === 'won' || card.status === 'won'

  return (
    <li>
      <div
        className={cn(
          'space-y-2.5 rounded-lg border p-3 shadow-card',
          !settled &&
            'border-slate-200 bg-white transition-colors duration-150 hover:border-slate-300',
          settled && (wonish ? 'border-emerald-200/70 bg-emerald-50/60' : 'border-slate-200/60 bg-white/60'),
        )}
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <Avatar
            name={contactName}
            size="sm"
            className={cn(settled && 'opacity-70 saturate-50')}
          />
          <div className="min-w-0">
            <Link
              href={`/contacts/${card.contact_id}`}
              className={cn(
                'block max-w-full truncate text-sm font-semibold underline-offset-2 hover:text-brand-700 hover:underline',
                settled ? 'text-slate-600' : 'text-slate-900',
              )}
            >
              {contactName}
            </Link>
            {card.organization_name ? (
              <p className="truncate text-xs text-slate-500">{card.organization_name}</p>
            ) : null}
          </div>
        </div>

        {/* Clamped so one wordy title cannot bury the value and owner facts
            below the fold of a very tall card; the full text stays reachable
            via the tooltip and the sr-only button names. */}
        <p
          className={cn(
            'line-clamp-3 text-sm leading-snug',
            settled ? 'text-slate-500' : 'text-slate-700',
          )}
          title={card.title}
        >
          {card.title}
        </p>

        {tracksValue && card.value_cents !== null ? (
          <p
            className={cn(
              'text-sm font-semibold tabular-nums',
              settled ? 'text-slate-600' : 'text-slate-900',
            )}
          >
            {formatCurrency(card.value_cents, card.currency)}
          </p>
        ) : null}

        <dl className="space-y-0.5 text-xs text-slate-500">
          <div className="flex gap-1">
            <dt>Owner</dt>
            <dd className="min-w-0 truncate font-medium text-slate-600">{ownerName}</dd>
          </div>
          {card.expected_close_on ? (
            <div className="flex gap-1">
              <dt>Expected close</dt>
              <dd className="font-medium text-slate-600">{formatDate(card.expected_close_on)}</dd>
            </div>
          ) : null}
        </dl>

        {card.next_step ? (
          <p className="truncate text-xs text-slate-600" title={card.next_step}>
            <span aria-hidden="true">→ </span>Next: {card.next_step}
          </p>
        ) : null}

        {canEdit ? (
          <div className="space-y-1 border-t border-slate-200/60 pt-2.5">
            <form action={formAction} className="flex items-center gap-1.5">
              <input type="hidden" name="id" value={card.id} />
              <input type="hidden" name="intent" value="move" />
              <label htmlFor={stageSelectId} className="sr-only">
                Move “{card.title}” to a different stage
              </label>
              <Select
                id={stageSelectId}
                name="stage_id"
                defaultValue={card.stage_id}
                className="min-w-0 flex-1 shadow-none ring-slate-300"
              >
                {stages.map((stage) => (
                  <option key={stage.id} value={stage.id}>
                    {stage.name}
                  </option>
                ))}
              </Select>
              <SubmitButton variant="secondary" size="sm">
                Move
                <Subject title={card.title} />
              </SubmitButton>
            </form>

            <div className="flex items-center gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="min-w-0 flex-1 justify-start px-1.5 text-slate-500 hover:text-slate-800"
                aria-expanded={closing}
                aria-controls={closing ? panelId : undefined}
                onClick={() => {
                  if (closing) setCloseReason('')
                  setClosing((open) => !open)
                }}
              >
                {/* The flipping chevron is what marks this quiet ghost button as
                    a disclosure rather than inert muted text. */}
                {closing ? (
                  <ChevronDown className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <ChevronRight className="h-4 w-4" aria-hidden="true" />
                )}
                Close card…
                <Subject title={card.title} />
              </Button>

              {/* Reordering swaps neighbours within the stage, so the two
                  directions are two dedicated forms like every other intent. */}
              <form action={formAction} className="flex">
                <input type="hidden" name="id" value={card.id} />
                <input type="hidden" name="intent" value="move_up" />
                <SubmitButton
                  variant="ghost"
                  size="sm"
                  className="px-1.5 text-slate-500 hover:text-slate-800"
                  aria-label={`Move “${card.title}” up`}
                >
                  <ArrowUp className="h-4 w-4" aria-hidden="true" />
                </SubmitButton>
              </form>
              <form action={formAction} className="flex">
                <input type="hidden" name="id" value={card.id} />
                <input type="hidden" name="intent" value="move_down" />
                <SubmitButton
                  variant="ghost"
                  size="sm"
                  className="px-1.5 text-slate-500 hover:text-slate-800"
                  aria-label={`Move “${card.title}” down`}
                >
                  <ArrowDown className="h-4 w-4" aria-hidden="true" />
                </SubmitButton>
              </form>
            </div>

            {closing ? (
              <div ref={panelRef} id={panelId} className="space-y-2 rounded-md bg-slate-100/80 p-2.5">
                <Field label="Reason" hint="Optional — why did it land this way?">
                  {(props) => (
                    <Textarea
                      {...props}
                      value={closeReason}
                      onChange={(event) => setCloseReason(event.currentTarget.value)}
                      rows={2}
                      maxLength={500}
                    />
                  )}
                </Field>
                <div className="flex flex-wrap gap-2">
                  {CLOSE_ACTIONS.map((close) => (
                    <form key={close.intent} action={formAction} className="flex">
                      <input type="hidden" name="id" value={card.id} />
                      <input type="hidden" name="intent" value={close.intent} />
                      <input type="hidden" name="close_reason" value={closeReason} />
                      <SubmitButton
                        size="sm"
                        variant={close.outcome === 'won' ? 'primary' : 'secondary'}
                      >
                        {close.label}
                        <Subject title={card.title} />
                      </SubmitButton>
                    </form>
                  ))}
                  {/* The third way out: off the board without counting as a
                      win or a loss — a dead deal, a duplicate, a wrong entry. */}
                  <form action={formAction} className="flex">
                    <input type="hidden" name="id" value={card.id} />
                    <input type="hidden" name="intent" value="archive" />
                    <input type="hidden" name="close_reason" value={closeReason} />
                    <SubmitButton size="sm" variant="secondary">
                      Archive
                      <Subject title={card.title} />
                    </SubmitButton>
                  </form>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setClosing(false)
                      setCloseReason('')
                    }}
                  >
                    Keep open
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </li>
  )
}
