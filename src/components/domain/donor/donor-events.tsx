'use client'

import Link from 'next/link'
import { useActionState } from 'react'
import {
  FormError,
  SubmitButton,
  useCloseOnSuccess,
} from '@/components/domain/contact-form-controls'
import {
  AttendanceBadge,
  EVENT_ATTENDANCES,
  EVENT_ATTENDANCE_LABELS,
} from '@/components/domain/development-badges'
import { Button } from '@/components/ui/button'
import { Dialog, useDialog } from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/display'
import { Field, Select, Textarea } from '@/components/ui/form'
import { SectionHeading } from '@/components/ui/tabs'
import type { ContactEventEntry } from '@/lib/queries/events'
import { formatDate } from '@/lib/utils'
import type { ContactActionState } from '@/lib/validation/contact'
import type { EventRow } from '@/types/database'

/**
 * Where this person has been.
 *
 * Event attendance exists on a donor record for one reason — context for the
 * next conversation — so this shows exactly the four things the brief asked
 * for: the event, its date, where it was, and the note about what happened
 * there.
 */
export function DonorEvents({
  contactId,
  entries,
  events,
  canEdit,
  action,
  compact = false,
  limit,
  viewAllHref,
}: {
  contactId: string
  entries: ContactEventEntry[]
  events: Array<Pick<EventRow, 'id' | 'name' | 'event_date'>>
  canEdit: boolean
  action: (state: ContactActionState, formData: FormData) => Promise<ContactActionState>
  /** Rail presentation: no heading (the rail section carries it), tight rows. */
  compact?: boolean
  /** Show only the first N entries, with a "View all" link when more exist. */
  limit?: number
  viewAllHref?: string
}) {
  const add = useDialog()
  const [state, formAction] = useActionState<ContactActionState, FormData>(action, {})
  useCloseOnSuccess(state, add.close)

  const shown = limit ? entries.slice(0, limit) : entries

  return (
    <section className={compact ? 'space-y-2' : 'space-y-4'}>
      {compact ? null : (
        <SectionHeading
          title="Events"
          description="Gatherings they were invited to or came to."
          action={
            canEdit && events.length > 0 ? (
              <Button ref={add.triggerRef} type="button" variant="secondary" onClick={add.openDialog}>
                Record attendance
              </Button>
            ) : null
          }
        />
      )}

      {entries.length === 0 ? (
        compact ? (
          <p className="text-[13px] leading-relaxed text-slate-500">
            {events.length > 0
              ? 'No events recorded for this person yet.'
              : 'No events exist yet — create one first.'}
          </p>
        ) : (
          <EmptyState
            title="No events recorded"
            description={
              events.length > 0
                ? 'Once they come to something, record it here — knowing who was in the room is half of the next conversation.'
                : 'Create an event first, then record who came.'
            }
            action={
              events.length === 0 ? (
                <Link
                  href="/events/new"
                  className="text-sm font-medium text-brand-700 hover:underline"
                >
                  Add an event
                </Link>
              ) : null
            }
          />
        )
      ) : (
        <ul className={compact ? 'space-y-2' : 'divide-y divide-slate-200 border-t border-slate-200'}>
          {shown.map((entry) => (
            <li key={entry.id} className={compact ? '' : 'py-3.5'}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                <Link
                  href={`/events/${entry.event.id}`}
                  className={
                    compact
                      ? 'min-w-0 truncate text-[13px] font-medium text-brand-700 hover:underline'
                      : 'text-[15px] font-medium text-slate-900 hover:text-brand-700 hover:underline'
                  }
                >
                  {entry.event.name}
                </Link>
                <AttendanceBadge status={entry.status} />
              </div>
              <p className={compact ? 'mt-0.5 text-xs text-slate-500' : 'mt-0.5 text-sm text-slate-600'}>
                {formatDate(entry.event.event_date)}
                {entry.event.location ? ` · ${entry.event.location}` : ''}
              </p>
              {entry.note && !compact ? (
                <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
                  {entry.note}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      {compact ? (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {canEdit && events.length > 0 ? (
            <Button
              ref={add.triggerRef}
              type="button"
              variant="ghost"
              size="sm"
              className="-ml-2 text-brand-700"
              onClick={add.openDialog}
            >
              + Record attendance
            </Button>
          ) : null}
          {viewAllHref && limit && entries.length > limit ? (
            <Link href={viewAllHref} className="text-xs font-medium text-brand-700 hover:underline">
              View all {entries.length}
            </Link>
          ) : null}
        </div>
      ) : null}

      <Dialog
        controller={add}
        title="Record attendance"
        formAction={formAction}
        footer={
          <>
            <SubmitButton>Save</SubmitButton>
            <Button type="button" variant="ghost" onClick={add.close}>
              Cancel
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <input type="hidden" name="contact_id" value={contactId} />
          <FormError state={state} />

          <Field label="Which event?" error={state.fieldErrors?.event_id}>
            {(props) => (
              <Select {...props} name="event_id" defaultValue={events[0]?.id ?? ''}>
                {events.map((event) => (
                  <option key={event.id} value={event.id}>
                    {event.name} — {formatDate(event.event_date)}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field label="Did they come?" error={state.fieldErrors?.status}>
            {(props) => (
              <Select {...props} name="status" defaultValue="attended">
                {EVENT_ATTENDANCES.map((status) => (
                  <option key={status} value={status}>
                    {EVENT_ATTENDANCE_LABELS[status]}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field label="Anything worth remembering?" hint="Optional.">
            {(props) => (
              <Textarea
                {...props}
                name="note"
                rows={3}
                maxLength={500}
                placeholder="Sat with the Hendersons; asked about the land."
              />
            )}
          </Field>
        </div>
      </Dialog>
    </section>
  )
}
