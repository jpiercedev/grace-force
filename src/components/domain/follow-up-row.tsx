'use client'

import Link from 'next/link'
import { useEffect, useId, useRef, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { Button, type ButtonProps } from '@/components/ui/button'
import { FollowUpPriorityBadge } from '@/components/domain/contact-badges'
import { Badge } from '@/components/ui/display'
import { Field, Select, Textarea } from '@/components/ui/form'
import type { FollowUpQueueItem, TeamProfile } from '@/lib/queries/follow-ups'
import { SNOOZE_ACTIONS } from '@/lib/validation/follow-up'
import {
  cn,
  contactDisplayName,
  formatDate,
  formatDateTime,
  formatRelative,
  isOverdue,
  truncate,
} from '@/lib/utils'

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
  /** Owned by the queue, which outlives a row leaving the current segment. */
  formAction: (formData: FormData) => void
  /** Changes when an action succeeds, which closes any open panel. */
  resetSignal: number
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

export function FollowUpRow({
  item,
  team,
  canEdit,
  nowIso,
  formAction,
  resetSignal,
}: FollowUpRowProps) {
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

  useEffect(() => {
    setPanel(null)
  }, [resetSignal])

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
              <FollowUpPriorityBadge priority={item.priority} />
              {overdue ? <Badge tone="red">Overdue</Badge> : null}
            </div>

            <p className="text-sm font-medium text-slate-900">{item.title}</p>
            {item.details ? (
              <p className="text-sm text-slate-600">{truncate(item.details, 160)}</p>
            ) : null}

            {item.status === 'completed' ? (
              <p className="text-sm text-slate-500">
                Completed {formatDateTime(item.completed_at)} ·{' '}
                <span className="whitespace-nowrap">{formatRelative(item.completed_at, now)}</span>
              </p>
            ) : (
              // The badge already says "Overdue"; the date names the deadline
              // without repeating the word or the time of day.
              <p className={cn('text-sm', overdue ? 'font-semibold text-red-700' : 'text-slate-500')}>
                {overdue ? 'Was due ' : 'Due '}
                {formatDate(item.due_at)} ·{' '}
                <span className="whitespace-nowrap">{formatRelative(item.due_at, now)}</span>
              </p>
            )}

            {item.outcome_note ? (
              <p className="text-sm text-slate-600">Outcome: {item.outcome_note}</p>
            ) : null}

            <p className="text-sm text-slate-500">Assigned to {assigneeName}</p>
          </div>

          {actionable ? (
            <div className="flex flex-wrap gap-2 sm:justify-end">
              <Button
                type="button"
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
                  // "+1 day" means nothing on its own, and a hidden "Snooze "
                  // fragment would be concatenated without its trailing space
                  // by the accessible-name algorithm ("Snooze+1 day"). The
                  // whole label is stated instead, visible text included.
                  aria-label={`Snooze ${snooze.label}: ${item.title}`}
                >
                  {snooze.label}
                </SubmitButton>
              ))}
              <Button
                type="button"
                variant="secondary"
                onClick={() => setPanel(panel === 'reassign' ? null : 'reassign')}
                aria-expanded={panel === 'reassign'}
                aria-controls={panel === 'reassign' ? panelId : undefined}
              >
                Reassign
                <Subject title={item.title} />
              </Button>
              {/* Secondary, not ghost: this starts a destructive act, so it
                  needs a visible boundary wherever the row wraps — ghost stays
                  reserved for the panels' back-out buttons. */}
              <Button
                type="button"
                variant="secondary"
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
                  {(props) => <Textarea {...props} name="outcome_note" rows={2} maxLength={2000} />}
                </Field>
                <div className="flex flex-wrap gap-2">
                  <SubmitButton name="intent" value="complete">
                    Mark complete
                    <Subject title={item.title} />
                  </SubmitButton>
                  <Button type="button" variant="ghost" onClick={() => setPanel(null)}>
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
                  <SubmitButton name="intent" value="reassign">
                    Save assignee
                    <Subject title={item.title} />
                  </SubmitButton>
                  <Button type="button" variant="ghost" onClick={() => setPanel(null)}>
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
                  <SubmitButton name="intent" value="cancel" variant="danger">
                    Yes, cancel it
                    <Subject title={item.title} />
                  </SubmitButton>
                  <Button type="button" variant="ghost" onClick={() => setPanel(null)}>
                    Keep it
                  </Button>
                </div>
              </>
            ) : null}
          </div>
        ) : null}
      </form>
    </li>
  )
}
