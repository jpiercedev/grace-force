'use client'

import { ChevronDown, ChevronRight } from 'lucide-react'
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
          <Link
            href={`/contacts/${card.contact_id}`}
            className={cn(
              'min-w-0 truncate text-sm font-semibold underline-offset-2 hover:text-brand-700 hover:underline',
              settled ? 'text-slate-600' : 'text-slate-900',
            )}
          >
            {contactName}
          </Link>
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
          {card.organization_name ? (
            <div className="flex gap-1">
              <dt>Organization</dt>
              <dd className="min-w-0 truncate font-medium text-slate-600">
                {card.organization_name}
              </dd>
            </div>
          ) : null}
          {card.expected_close_on ? (
            <div className="flex gap-1">
              <dt>Expected close</dt>
              <dd className="font-medium text-slate-600">{formatDate(card.expected_close_on)}</dd>
            </div>
          ) : null}
          {card.next_step ? (
            <div className="flex gap-1">
              <dt className="shrink-0">Next step</dt>
              <dd className="min-w-0 truncate font-medium text-slate-700" title={card.next_step}>
                {card.next_step}
              </dd>
            </div>
          ) : null}
        </dl>

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

            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full justify-start px-1.5 text-slate-500 hover:text-slate-800"
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
              Close or archive…
              <Subject title={card.title} />
            </Button>

            {closing ? (
              <div ref={panelRef} id={panelId} className="space-y-2 rounded-md bg-slate-100/80 p-2.5">
                <Field
                  label="Reason"
                  hint="Optional — why did it land this way? Archiving sets it aside without an outcome."
                >
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
                        variant={
                          close.outcome === 'won'
                            ? 'primary'
                            : close.outcome === 'archived'
                              ? 'ghost'
                              : 'secondary'
                        }
                      >
                        {close.label}
                        <Subject title={card.title} />
                      </SubmitButton>
                    </form>
                  ))}
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
