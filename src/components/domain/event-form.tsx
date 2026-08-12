'use client'

import { useActionState } from 'react'
import {
  FormError,
  SubmitButton,
  ownerOptions,
} from '@/components/domain/contact-form-controls'
import { EVENT_KINDS, EVENT_KIND_LABELS } from '@/components/domain/development-badges'
import { LinkButton } from '@/components/ui/button'
import { Field, Input, Select, Textarea } from '@/components/ui/form'
import type { TeamMember } from '@/lib/queries/contacts'
import type { ContactActionState } from '@/lib/validation/contact'
import type { EventRow } from '@/types/database'

/**
 * Six fields, two of them optional-looking because they are.
 *
 * Date and time are separate controls rather than one `datetime-local`: most
 * of these are recorded after the fact, and "the banquet, some time that
 * evening" is a real answer that a combined control cannot express.
 */
export function EventForm({
  event,
  team,
  defaultOwnerId,
  today,
  action,
  submitLabel,
  cancelHref,
}: {
  event?: EventRow
  team: TeamMember[]
  defaultOwnerId: string
  today: string
  action: (state: ContactActionState, formData: FormData) => Promise<ContactActionState>
  submitLabel: string
  cancelHref: string
}) {
  const [state, formAction] = useActionState<ContactActionState, FormData>(action, {})
  const errors = state.fieldErrors ?? {}
  const owners = ownerOptions(team, event?.owner_id ?? defaultOwnerId)

  return (
    <form action={formAction} className="space-y-6" noValidate>
      {event ? <input type="hidden" name="event_id" value={event.id} /> : null}
      <FormError state={state} />

      <div className="space-y-5 rounded-xl bg-white p-5 shadow-card sm:p-6">
        <Field label="What is it called?" error={errors.name} required>
          {(props) => (
            <Input
              {...props}
              name="name"
              defaultValue={event?.name ?? ''}
              maxLength={160}
              placeholder="Legacy dinner"
              invalid={!!errors.name}
              autoFocus={!event}
            />
          )}
        </Field>

        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Date" error={errors.event_date} required>
            {(props) => (
              <Input
                {...props}
                type="date"
                name="event_date"
                defaultValue={event?.event_date ?? today}
                invalid={!!errors.event_date}
              />
            )}
          </Field>

          <Field label="Time" hint="Leave blank if it does not matter." error={errors.start_time}>
            {(props) => (
              <Input
                {...props}
                type="time"
                name="start_time"
                defaultValue={event?.start_time?.slice(0, 5) ?? ''}
                invalid={!!errors.start_time}
              />
            )}
          </Field>

          <Field label="Type" error={errors.kind}>
            {(props) => (
              <Select {...props} name="kind" defaultValue={event?.kind ?? 'gathering'}>
                {EVENT_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {EVENT_KIND_LABELS[kind]}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field label="Where?" error={errors.location}>
            {(props) => (
              <Input
                {...props}
                name="location"
                defaultValue={event?.location ?? ''}
                maxLength={200}
                placeholder="The Life Centre"
                invalid={!!errors.location}
              />
            )}
          </Field>
        </div>

        <Field label="Who is organising it?" error={errors.owner_id}>
          {(props) => (
            <Select {...props} name="owner_id" defaultValue={event?.owner_id ?? defaultOwnerId}>
              <option value="">Unassigned</option>
              {owners.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field label="Description" hint="Optional." error={errors.description}>
          {(props) => (
            <Textarea
              {...props}
              name="description"
              rows={4}
              maxLength={2000}
              defaultValue={event?.description ?? ''}
            />
          )}
        </Field>
      </div>

      <div className="flex flex-wrap gap-2">
        <SubmitButton size="lg">{submitLabel}</SubmitButton>
        <LinkButton href={cancelHref} variant="ghost" size="lg">
          Cancel
        </LinkButton>
      </div>
    </form>
  )
}
