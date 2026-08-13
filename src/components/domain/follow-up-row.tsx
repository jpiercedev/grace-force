'use client'

import Link from 'next/link'
import { useEffect, useId, useRef, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { Button, type ButtonProps } from '@/components/ui/button'
import { FollowUpPriorityBadge } from '@/components/domain/contact-badges'
import { Avatar, Badge } from '@/components/ui/display'
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

/** Shared look for the quiet secondaries inside the tonal action group. */
const GROUP_BUTTON =
  'rounded-none px-2.5 text-slate-600 hover:bg-slate-200 hover:text-slate-900'

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
  const completed = item.status === 'completed'
  const contactName = item.contact ? contactDisplayName(item.contact) : 'Unknown contact'
  const assigneeName = item.assignee
    ? (item.assignee.full_name?.trim() || item.assignee.email)
    : 'Unassigned'
  const actionable = canEdit && item.status === 'open'

  return (
    <li className="px-4 py-4 sm:px-5">
      <form action={formAction} className="space-y-3">
        <input type="hidden" name="id" value={item.id} />

        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
          {/* The person anchors the row; the task is the loudest line in it. */}
          <div className="flex min-w-0 flex-1 gap-3">
            <Avatar
              name={contactName}
              size="md"
              className={cn('mt-0.5', completed && 'opacity-60 saturate-50')}
            />
            <div className="min-w-0 flex-1 space-y-1">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <Link
                  href={`/contacts/${item.contact_id}`}
                  className={cn(
                    'text-sm font-semibold underline-offset-2 hover:text-brand-700 hover:underline',
                    completed ? 'text-slate-600' : 'text-slate-900',
                  )}
                >
                  {contactName}
                </Link>
                {item.status === 'open' ? <FollowUpPriorityBadge priority={item.priority} /> : null}
                {overdue ? <Badge tone="red">Overdue</Badge> : null}
              </div>

              <p
                className={cn(
                  'text-[15px] leading-snug',
                  completed ? 'text-slate-600' : 'font-medium text-slate-900',
                )}
              >
                {item.title}
              </p>

              {item.details ? (
                <p className="text-sm leading-relaxed text-slate-500">
                  {truncate(item.details, 160)}
                </p>
              ) : null}

              {completed ? (
                <p className="text-sm text-slate-500">
                  Completed {formatDateTime(item.completed_at)} ·{' '}
                  <span className="whitespace-nowrap">
                    {formatRelative(item.completed_at, now)}
                  </span>
                  <span> · Assigned to {assigneeName}</span>
                </p>
              ) : (
                // The badge already says "Overdue"; the date names the deadline
                // without repeating the word or the time of day. The assignee
                // rides the same line but stays quiet even when the date turns
                // red — urgency belongs to the deadline, not the person.
                <p className={cn('text-sm', overdue ? 'font-medium text-red-700' : 'text-slate-500')}>
                  {overdue ? 'Was due ' : 'Due '}
                  {formatDate(item.due_at)} ·{' '}
                  <span className="whitespace-nowrap">{formatRelative(item.due_at, now)}</span>
                  <span className={cn(overdue && 'font-normal text-slate-500')}>
                    {' '}
                    · Assigned to {assigneeName}
                  </span>
                </p>
              )}

              {item.outcome_note ? (
                <p className="border-l-2 border-slate-300/70 pl-3 text-sm italic leading-relaxed text-slate-600">
                  {item.outcome_note}
                </p>
              ) : null}
            </div>
          </div>

          {actionable ? (
            // One honest primary; everything else shares a single tonal strip
            // so five buttons read as one control, not a row of shouting.
            <div className="flex flex-wrap items-center gap-2 sm:shrink-0 sm:justify-end">
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
              <div className="flex max-w-full flex-wrap items-stretch divide-x divide-slate-200/80 overflow-hidden rounded-lg bg-slate-100">
                {SNOOZE_ACTIONS.map((snooze) => (
                  <SubmitButton
                    key={snooze.intent}
                    name="intent"
                    value={snooze.intent}
                    variant="ghost"
                    size="sm"
                    className={GROUP_BUTTON}
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
                  variant="ghost"
                  size="sm"
                  className={GROUP_BUTTON}
                  onClick={() => setPanel(panel === 'reassign' ? null : 'reassign')}
                  aria-expanded={panel === 'reassign'}
                  aria-controls={panel === 'reassign' ? panelId : undefined}
                >
                  Reassign
                  <Subject title={item.title} />
                </Button>
                {/* Cancel starts a destructive act, so it keeps the group's
                    visible tonal boundary rather than floating as bare ghost
                    text — the confirm panel does the actual guarding. */}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className={GROUP_BUTTON}
                  onClick={() => setPanel(panel === 'cancel' ? null : 'cancel')}
                  aria-expanded={panel === 'cancel'}
                  aria-controls={panel === 'cancel' ? panelId : undefined}
                >
                  Cancel
                  <Subject title={item.title} />
                </Button>
              </div>
            </div>
          ) : null}
        </div>

        {panel ? (
          <div
            ref={panelRef}
            id={panelId}
            className="space-y-3 rounded-lg border border-slate-200 bg-slate-100/60 p-4 sm:ml-11"
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
