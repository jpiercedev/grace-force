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
import { PersonPicker } from '@/components/domain/person-picker'
import { Button } from '@/components/ui/button'
import { Dialog, useDialog } from '@/components/ui/dialog'
import { Avatar, EmptyState } from '@/components/ui/display'
import { Field, Select, Textarea } from '@/components/ui/form'
import { SectionHeading } from '@/components/ui/tabs'
import { pluralize } from '@/lib/utils'
import type { EventAttendeeEntry } from '@/lib/queries/events'
import type { ContactActionState } from '@/lib/validation/contact'

/**
 * Who was there.
 *
 * Adding a person and recording that they came are the same action, because
 * they happen at the same moment — staff open this screen *after* the event,
 * from a sign-in sheet. Splitting invite from attendance would double the work
 * for the common case to serve a case this product does not have.
 */
export function EventAttendees({
  eventId,
  eventName,
  attendees,
  canEdit,
  saveAction,
  removeAction,
}: {
  eventId: string
  eventName: string
  attendees: EventAttendeeEntry[]
  canEdit: boolean
  saveAction: (state: ContactActionState, formData: FormData) => Promise<ContactActionState>
  removeAction: (state: ContactActionState, formData: FormData) => Promise<ContactActionState>
}) {
  const add = useDialog()
  const [addState, addFormAction] = useActionState<ContactActionState, FormData>(saveAction, {})
  const [removeState, removeFormAction] = useActionState<ContactActionState, FormData>(
    removeAction,
    {},
  )
  useCloseOnSuccess(addState, add.close)

  const came = attendees.filter((entry) => entry.status === 'attended').length

  return (
    <section className="space-y-4">
      <SectionHeading
        title="Who was there"
        description={
          attendees.length === 0
            ? undefined
            : `${pluralize(attendees.length, 'person', 'people')} · ${came} came`
        }
        action={
          canEdit ? (
            <Button ref={add.triggerRef} type="button" variant="primary" onClick={add.openDialog}>
              Add someone
            </Button>
          ) : null
        }
      />

      <FormError state={removeState} />

      {attendees.length === 0 ? (
        <EmptyState
          title="Nobody recorded yet"
          description="Add the people who came. Each one gets this event on their own record, so the next conversation starts from what happened here."
          action={
            canEdit ? (
              <Button type="button" onClick={add.openDialog}>
                Add the first person
              </Button>
            ) : null
          }
        />
      ) : (
        <ul className="divide-y divide-slate-200 border-t border-slate-200">
          {attendees.map((entry) => (
            <li key={entry.id} className="flex items-start gap-3 py-3">
              <Avatar name={entry.contact.name} size="md" />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Link
                    href={`/contacts/${entry.contact.id}`}
                    className="text-[15px] font-medium text-slate-900 hover:text-brand-800 hover:underline"
                  >
                    {entry.contact.name}
                  </Link>
                  <AttendanceBadge status={entry.status} />
                </div>
                {entry.note ? (
                  <p className="mt-0.5 whitespace-pre-wrap text-sm leading-relaxed text-slate-600">
                    {entry.note}
                  </p>
                ) : null}
              </div>
              {canEdit ? (
                <form action={removeFormAction} className="shrink-0">
                  <input type="hidden" name="event_id" value={eventId} />
                  <input type="hidden" name="attendee_id" value={entry.id} />
                  <SubmitButton variant="ghost" size="sm" pendingLabel="Removing…">
                    Remove
                  </SubmitButton>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <Dialog
        controller={add}
        title="Add someone to this event"
        description={eventName}
        formAction={addFormAction}
        footer={
          <>
            <SubmitButton>Save</SubmitButton>
            <Button type="button" variant="ghost" onClick={add.close}>
              Cancel
            </Button>
          </>
        }
      >
        <div className="space-y-5">
          <input type="hidden" name="event_id" value={eventId} />
          <FormError state={addState} />

          <PersonPicker
            name="contact_id"
            label="Who?"
            required
            error={addState.fieldErrors?.contact_id}
          />

          <Field label="Did they come?" error={addState.fieldErrors?.status}>
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
            {(props) => <Textarea {...props} name="note" rows={3} maxLength={500} />}
          </Field>
        </div>
      </Dialog>
    </section>
  )
}
