'use client'

import { useActionState, useEffect, useRef } from 'react'
import { FOLLOW_UP_PRIORITY_LABELS } from '@/components/domain/contact-badges'
import {
  FormError,
  LocalDateTimeInput,
  SubmitButton,
  TimezoneOffsetField,
  useCloseOnSuccess,
  useDisclosure,
} from '@/components/domain/contact-form-controls'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader } from '@/components/ui/display'
import { Field, Input, Select, Textarea } from '@/components/ui/form'
import type { TeamMember } from '@/lib/queries/contacts'
import type { ContactActionState } from '@/lib/validation/contact'
import type { FollowUpPriority } from '@/types/database'

const PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const satisfies readonly FollowUpPriority[]

/**
 * Scheduling the next touch without leaving the contact.
 *
 * The follow-up is created open, so `completed_at` stays null and the
 * `follow_ups_completion_consistency` constraint holds. The timeline entry is
 * written by a trigger.
 */
export function ContactFollowUpForm({
  contactId,
  team,
  defaultAssigneeId,
  action,
}: {
  contactId: string
  team: TeamMember[]
  defaultAssigneeId: string
  action: (state: ContactActionState, formData: FormData) => Promise<ContactActionState>
}) {
  const [state, formAction] = useActionState<ContactActionState, FormData>(action, {})
  const disclosure = useDisclosure({ hash: 'add-follow-up' })
  useCloseOnSuccess(state, disclosure.close)
  const errors = state.fieldErrors ?? {}
  const assignees = team.filter(
    (member) => (member.is_active && member.role !== 'viewer') || member.id === defaultAssigneeId,
  )

  // Collapsed, this card was a dead bar duplicating the header's "Add
  // follow-up" button, so it hides entirely until the disclosure opens. That
  // means the browser cannot scroll to the anchor itself (no box while
  // hidden) and `close()` cannot hand focus to the in-card trigger — both are
  // done here instead, against the header quick action.
  const wasOpen = useRef(false)
  useEffect(() => {
    if (disclosure.open && !wasOpen.current && window.location.hash === '#add-follow-up') {
      document.getElementById('add-follow-up')?.scrollIntoView()
    }
    if (!disclosure.open && wasOpen.current) {
      document.querySelector<HTMLAnchorElement>('a[href="#add-follow-up"]')?.focus()
    }
    wasOpen.current = disclosure.open
  }, [disclosure.open])

  return (
    // The `hidden` attribute (not the class) so the column's space-y rhythm
    // skips the card while it is closed.
    <Card id="add-follow-up" hidden={!disclosure.open}>
      <CardHeader
        title="Add a follow-up"
        description="Put the next step in someone's queue."
        action={
          <Button
            ref={disclosure.triggerRef}
            type="button"
            variant={disclosure.open ? 'ghost' : 'secondary'}
            size="sm"
            onClick={disclosure.toggle}
            aria-expanded={disclosure.open}
            aria-controls={disclosure.open ? 'add-follow-up-panel' : undefined}
          >
            {disclosure.open ? 'Cancel' : 'Add follow-up'}
          </Button>
        }
      />
      {disclosure.open ? (
        <CardBody>
          <form id="add-follow-up-panel" action={formAction} className="space-y-4" noValidate>
            <input type="hidden" name="contact_id" value={contactId} />
            <TimezoneOffsetField />

            <FormError state={state} />

            <Field label="What needs doing" required error={errors.title}>
              {(props) => (
                <Input
                  {...props}
                  name="title"
                  required
                  maxLength={160}
                  autoFocus
                  placeholder="Call about the spring appeal"
                  invalid={!!errors.title}
                />
              )}
            </Field>

            <Field label="Details" error={errors.details}>
              {(props) => (
                <Textarea
                  {...props}
                  name="details"
                  rows={3}
                  maxLength={2000}
                  invalid={!!errors.details}
                />
              )}
            </Field>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Due" required error={errors.due_at}>
                {(props) => (
                  <LocalDateTimeInput
                    {...props}
                    name="due_at"
                    required
                    daysAhead={1}
                    hour={9}
                    invalid={!!errors.due_at}
                  />
                )}
              </Field>

              <Field label="Priority" error={errors.priority}>
                {(props) => (
                  <Select {...props} name="priority" defaultValue="normal">
                    {PRIORITIES.map((priority) => (
                      <option key={priority} value={priority}>
                        {FOLLOW_UP_PRIORITY_LABELS[priority]}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>

              <Field label="Assign to" error={errors.assigned_to} className="sm:col-span-2">
                {(props) => (
                  <Select {...props} name="assigned_to" defaultValue={defaultAssigneeId}>
                    {assignees.map((member) => (
                      <option key={member.id} value={member.id}>
                        {member.name}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>

            <div className="flex flex-wrap gap-2">
              <SubmitButton size="sm">Schedule it</SubmitButton>
              <Button type="button" variant="ghost" size="sm" onClick={disclosure.close}>
                Discard
              </Button>
            </div>
          </form>
        </CardBody>
      ) : null}
    </Card>
  )
}
