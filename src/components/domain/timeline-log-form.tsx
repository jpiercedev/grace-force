'use client'

import { useActionState } from 'react'
import {
  ACTIVITY_DIRECTION_LABELS,
  ACTIVITY_TYPE_LABELS,
  MANUAL_ACTIVITY_TYPES,
} from '@/components/domain/contact-badges'
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
import type { ContactActionState } from '@/lib/validation/contact'

const DIRECTIONS = ['internal', 'outbound', 'inbound'] as const

/**
 * Hand-logging a call, note or visit.
 *
 * The entry is written with `source='manual'` and no `dedupe_key`, so two
 * genuinely similar notes both land instead of the second being swallowed by
 * the uniqueness index.
 */
export function TimelineLogForm({
  contactId,
  action,
}: {
  contactId: string
  action: (state: ContactActionState, formData: FormData) => Promise<ContactActionState>
}) {
  const [state, formAction] = useActionState<ContactActionState, FormData>(action, {})
  const disclosure = useDisclosure({ hash: 'log-activity' })
  useCloseOnSuccess(state, disclosure.close)
  const errors = state.fieldErrors ?? {}

  return (
    <Card id="log-activity">
      <CardHeader
        title="Log activity"
        description="Record a conversation, a visit or a note."
        action={
          <Button
            ref={disclosure.triggerRef}
            type="button"
            variant={disclosure.open ? 'ghost' : 'secondary'}
            size="sm"
            onClick={disclosure.toggle}
            aria-expanded={disclosure.open}
            aria-controls="log-activity-panel"
          >
            {disclosure.open ? 'Cancel' : 'Log activity'}
          </Button>
        }
      />
      {disclosure.open ? (
        <CardBody>
          <form id="log-activity-panel" action={formAction} className="space-y-4" noValidate>
            <input type="hidden" name="contact_id" value={contactId} />
            <TimezoneOffsetField />

            <FormError state={state} />

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Type" error={errors.type}>
                {(props) => (
                  <Select {...props} name="type" defaultValue="note" autoFocus>
                    {MANUAL_ACTIVITY_TYPES.map((type) => (
                      <option key={type} value={type}>
                        {ACTIVITY_TYPE_LABELS[type]}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>

              <Field label="Direction" error={errors.direction}>
                {(props) => (
                  <Select {...props} name="direction" defaultValue="internal">
                    {DIRECTIONS.map((direction) => (
                      <option key={direction} value={direction}>
                        {ACTIVITY_DIRECTION_LABELS[direction]}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>

              <Field
                label="Summary"
                hint="A one-line headline for the timeline."
                error={errors.subject}
                className="sm:col-span-2"
              >
                {(props) => (
                  <Input
                    {...props}
                    name="subject"
                    maxLength={200}
                    placeholder="Called about the spring appeal"
                    invalid={!!errors.subject}
                  />
                )}
              </Field>

              <Field label="Detail" error={errors.body} className="sm:col-span-2">
                {(props) => (
                  <Textarea
                    {...props}
                    name="body"
                    rows={4}
                    maxLength={4000}
                    invalid={!!errors.body}
                  />
                )}
              </Field>

              <Field
                label="When it happened"
                hint="Defaults to now. Backdate it if you are catching up."
                error={errors.occurred_at}
              >
                {(props) => (
                  <LocalDateTimeInput
                    {...props}
                    name="occurred_at"
                    invalid={!!errors.occurred_at}
                  />
                )}
              </Field>
            </div>

            <div className="flex flex-wrap gap-2">
              <SubmitButton size="sm">Save to timeline</SubmitButton>
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
