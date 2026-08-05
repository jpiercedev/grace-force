'use client'

import Link from 'next/link'
import { useActionState, useEffect, useId, useRef, useState } from 'react'
import { useFormStatus } from 'react-dom'
import type { FollowUpActionState } from '@/app/(app)/follow-ups/actions'
import { Button, type ButtonProps } from '@/components/ui/button'
import { Badge, Callout } from '@/components/ui/display'
import { Field, Select, Textarea } from '@/components/ui/form'
import type { FollowUpQueueItem, TeamProfile } from '@/lib/queries/follow-ups'
import {
  PRIORITY_LABELS,
  PRIORITY_TONES,
  SNOOZE_ACTIONS,
} from '@/lib/validation/follow-up'
import { cn, contactDisplayName, formatDateTime, formatRelative, isOverdue, truncate } from '@/lib/utils'

type Panel = 'complete' | 'reassign' | 'cancel' | null

export interface FollowUpRowProps {
  item: FollowUpQueueItem
  team: TeamProfile[]
  canEdit: boolean
  /**
   * The instant the page was rendered. Passing it in keeps "overdue" and the
   * relative label identical on the server and on hydration.
   */
  nowIso: string
  action: (prev: FollowUpActionState, formData: FormData) => Promise<FollowUpActionState>
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
 * Folds the follow-up's title into a button's accessible name. A queue of
 * fifteen rows otherwise presents fifteen buttons all called "Complete", which
 * is unusable from a screen reader's element list.
 */
function Subject({ title }: { title: string }) {
  return <span className="sr-only">: {title}</span>
}

export function FollowUpRow({ item, team, canEdit, nowIso, action }: FollowUpRowProps) {
  const [state, formAction] = useActionState<FollowUpActionState, FormData>(action, {})
  const [panel, setPanel] = useState<Panel>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const panelId = useId()

  // Anything that opens closes on Escape.
  useEffect(() => {
    if (!panel) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setPanel(null)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [panel])

  // Move focus into the panel so a keyboard user is not left behind the button.
  useEffect(() => {
    if (!panel) return
    panelRef.current?.querySelector<HTMLElement>('textarea, select, button')?.focus()
  }, [panel])

  // A successful action leaves nothing to confirm.
  useEffect(() => {
    if (state.notice) setPanel(null)
  }, [state.notice])

  const now = new Date(nowIso)
  const overdue = item.status === 'open' && isOverdue(item.due_at, now)
  const contactName = item.contact ? contactDisplayName(item.contact) : 'Unknown contact'
  const assigneeName = item.assignee
    ? (item.assignee.full_name?.trim() || item.assignee.email)
    : 'Unassigned'
  const actionable = canEdit && item.status === 'open'

  return (
    <li className="px-4 py-3.5">
      <form action={formAction} className="space-y-3">
        <input type="hidden" name="id" value={item.id} />

        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href={`/contacts/${item.contact_id}`}
                className="text-sm font-semibold text-brand-700 underline-offset-2 hover:underline"
              >
                {contactName}
              </Link>
              <Badge tone={PRIORITY_TONES[item.priority]}>{PRIORITY_LABELS[item.priority]}</Badge>
              {overdue ? <Badge tone="red">Overdue</Badge> : null}
            </div>

            <p className="text-sm font-medium text-slate-900">{item.title}</p>
            {item.details ? (
              <p className="text-sm text-slate-600">{truncate(item.details, 160)}</p>
            ) : null}

            {item.status === 'completed' ? (
              <p className="text-xs text-slate-500">
                Completed {formatDateTime(item.completed_at)} ·{' '}
                {formatRelative(item.completed_at, now)}
              </p>
            ) : (
              <p className={cn('text-xs', overdue ? 'font-semibold text-red-700' : 'text-slate-500')}>
                {overdue ? 'Overdue — was due ' : 'Due '}
                {formatDateTime(item.due_at)} · {formatRelative(item.due_at, now)}
              </p>
            )}

            {item.outcome_note ? (
              <p className="text-xs text-slate-600">Outcome: {item.outcome_note}</p>
            ) : null}

            <p className="text-xs text-slate-500">Assigned to {assigneeName}</p>
          </div>

          {actionable ? (
            <div className="flex flex-wrap gap-2 sm:justify-end">
              <Button
                type="button"
                size="sm"
                onClick={() => setPanel(panel === 'complete' ? null : 'complete')}
                aria-expanded={panel === 'complete'}
                aria-controls={panel === 'complete' ? panelId : undefined}
              >
                Complete
                <Subject title={item.title} />
              </Button>
              {SNOOZE_ACTIONS.map((snooze) => (
                <SubmitButton
                  key={snooze.intent}
                  name="intent"
                  value={snooze.intent}
                  variant="secondary"
                  size="sm"
                >
                  <span className="sr-only">Snooze </span>
                  {snooze.label}
                  <Subject title={item.title} />
                </SubmitButton>
              ))}
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setPanel(panel === 'reassign' ? null : 'reassign')}
                aria-expanded={panel === 'reassign'}
                aria-controls={panel === 'reassign' ? panelId : undefined}
              >
                Reassign
                <Subject title={item.title} />
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setPanel(panel === 'cancel' ? null : 'cancel')}
                aria-expanded={panel === 'cancel'}
                aria-controls={panel === 'cancel' ? panelId : undefined}
              >
                Cancel
                <Subject title={item.title} />
              </Button>
            </div>
          ) : null}
        </div>

        {panel ? (
          <div
            ref={panelRef}
            id={panelId}
            className="space-y-3 rounded-md border border-slate-200 bg-slate-50 p-3"
          >
            {panel === 'complete' ? (
              <>
                <Field label="Outcome note" hint="Optional — what came of it?">
                  {(props) => (
                    <Textarea {...props} name="outcome_note" rows={2} maxLength={2000} />
                  )}
                </Field>
                <div className="flex flex-wrap gap-2">
                  <SubmitButton name="intent" value="complete" size="sm">
                    Mark complete
                    <Subject title={item.title} />
                  </SubmitButton>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setPanel(null)}>
                    Not yet
                  </Button>
                </div>
              </>
            ) : null}

            {panel === 'reassign' ? (
              <>
                <Field label="Assign to">
                  {(props) => (
                    <Select {...props} name="assigned_to" defaultValue={item.assigned_to ?? ''}>
                      <option value="">Unassigned</option>
                      {team.map((member) => (
                        <option key={member.id} value={member.id}>
                          {member.full_name?.trim() || member.email}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <div className="flex flex-wrap gap-2">
                  <SubmitButton name="intent" value="reassign" size="sm">
                    Save assignee
                    <Subject title={item.title} />
                  </SubmitButton>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setPanel(null)}>
                    Discard
                  </Button>
                </div>
              </>
            ) : null}

            {panel === 'cancel' ? (
              <>
                <p className="text-sm text-slate-700">
                  Cancel this follow-up? It leaves the queue but stays on the contact&rsquo;s
                  history.
                </p>
                <div className="flex flex-wrap gap-2">
                  <SubmitButton name="intent" value="cancel" variant="danger" size="sm">
                    Yes, cancel it
                    <Subject title={item.title} />
                  </SubmitButton>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setPanel(null)}>
                    Keep it
                  </Button>
                </div>
              </>
            ) : null}
          </div>
        ) : null}

        {state.error ? (
          <Callout tone="danger" role="alert">
            {state.error}
          </Callout>
        ) : null}
        {/* Reassigning leaves the row in place, so the confirmation has
            somewhere to live; completing removes it and takes this with it. */}
        {state.notice ? <Callout tone="success">{state.notice}</Callout> : null}
      </form>
    </li>
  )
}
