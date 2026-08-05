'use client'

import Link from 'next/link'
import { useEffect, useId, useRef, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { Button, type ButtonProps } from '@/components/ui/button'
import { Field, Select, Textarea } from '@/components/ui/form'
import type { BoardCard } from '@/lib/queries/pipelines'
import { contactDisplayName, formatCurrency, formatDate } from '@/lib/utils'
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
export function PipelineCard({ card, stages, tracksValue, canEdit, formAction }: PipelineCardProps) {
  const [closing, setClosing] = useState(false)
  const stageSelectId = useId()
  const panelId = useId()
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!closing) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setClosing(false)
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

  return (
    <li>
      <form
        action={formAction}
        className="space-y-2 rounded-lg border border-slate-200 bg-white p-3 shadow-sm"
      >
        <input type="hidden" name="id" value={card.id} />

        <Link
          href={`/contacts/${card.contact_id}`}
          className="block text-sm font-semibold text-brand-700 underline-offset-2 hover:underline"
        >
          {contactName}
        </Link>

        <p className="text-sm text-slate-900">{card.title}</p>

        {tracksValue ? (
          <p className="text-sm font-semibold tabular-nums text-slate-900">
            {formatCurrency(card.value_cents, card.currency)}
          </p>
        ) : null}

        <dl className="space-y-0.5 text-xs text-slate-500">
          <div className="flex gap-1">
            <dt>Owner:</dt>
            <dd className="min-w-0 truncate text-slate-700">{ownerName}</dd>
          </div>
          {card.expected_close_on ? (
            <div className="flex gap-1">
              <dt>Expected close:</dt>
              <dd className="text-slate-700">{formatDate(card.expected_close_on)}</dd>
            </div>
          ) : null}
        </dl>

        {canEdit ? (
          <>
            <div className="flex items-end gap-2 pt-1">
              <label htmlFor={stageSelectId} className="sr-only">
                Move “{card.title}” to a different stage
              </label>
              <Select
                id={stageSelectId}
                name="stage_id"
                defaultValue={card.stage_id}
                className="py-1.5 text-xs"
              >
                {stages.map((stage) => (
                  <option key={stage.id} value={stage.id}>
                    {stage.name}
                  </option>
                ))}
              </Select>
              <SubmitButton name="intent" value="move" variant="secondary" size="sm">
                Move
                <Subject title={card.title} />
              </SubmitButton>
            </div>

            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="w-full justify-start px-1"
              aria-expanded={closing}
              aria-controls={closing ? panelId : undefined}
              onClick={() => setClosing((open) => !open)}
            >
              Close card…
              <Subject title={card.title} />
            </Button>

            {closing ? (
              <div ref={panelRef} id={panelId} className="space-y-2 rounded-md bg-slate-50 p-2">
                <Field label="Reason" hint="Optional — why did it land this way?">
                  {(props) => (
                    <Textarea
                      {...props}
                      name="close_reason"
                      rows={2}
                      maxLength={500}
                      className="text-xs"
                    />
                  )}
                </Field>
                <div className="flex flex-wrap gap-2">
                  {CLOSE_ACTIONS.map((close) => (
                    <SubmitButton
                      key={close.intent}
                      name="intent"
                      value={close.intent}
                      size="sm"
                      variant={close.outcome === 'won' ? 'primary' : 'secondary'}
                    >
                      {close.label}
                      <Subject title={card.title} />
                    </SubmitButton>
                  ))}
                  <Button type="button" variant="ghost" size="sm" onClick={() => setClosing(false)}>
                    Keep open
                  </Button>
                </div>
              </div>
            ) : null}
          </>
        ) : null}
      </form>
    </li>
  )
}
