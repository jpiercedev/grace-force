'use client'

import { useActionState, useState } from 'react'
import { ENGAGEMENT_STATUS_LABELS } from '@/components/domain/contact-badges'
import {
  FormError,
  SubmitButton,
  ownerOptions,
  useCloseOnSuccess,
} from '@/components/domain/contact-form-controls'
import { Button } from '@/components/ui/button'
import { Field, Input, Select, Textarea } from '@/components/ui/form'
import type { ContactEngagement, TeamMember } from '@/lib/queries/contacts'
import { ENGAGEMENT_STATUSES, type ContactActionState } from '@/lib/validation/contact'
import type { EngagementStatus, EngagementTypeRow } from '@/types/database'

/**
 * Add or edit one engagement.
 *
 * `engagements_ended_consistency` pairs status and end date: ended demands a
 * date, every other status forbids one. The end-date field therefore appears
 * only while `ended` is selected, so the form cannot express the combination
 * the database would reject.
 */
export function EngagementForm({
  action,
  contactId,
  engagement,
  engagementTypes,
  team,
  today,
  submitLabel,
  onDone,
}: {
  action: (state: ContactActionState, formData: FormData) => Promise<ContactActionState>
  contactId: string
  engagement?: ContactEngagement
  engagementTypes: EngagementTypeRow[]
  team: TeamMember[]
  /** Today's date as YYYY-MM-DD, from the server, so hydration matches. */
  today: string
  submitLabel: string
  onDone: () => void
}) {
  const [state, formAction] = useActionState<ContactActionState, FormData>(action, {})
  const [status, setStatus] = useState<EngagementStatus>(engagement?.status ?? 'active')
  useCloseOnSuccess(state, onDone)
  const errors = state.fieldErrors ?? {}

  // A retired type stays selectable on a record that already uses it, so
  // editing an unrelated field cannot silently change what the engagement is.
  const types = engagementTypes.filter(
    (type) => type.is_active || type.id === engagement?.type?.id,
  )
  const owners = ownerOptions(team, engagement?.owner?.id ?? null)

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <input type="hidden" name="contact_id" value={contactId} />
      {engagement ? <input type="hidden" name="engagement_id" value={engagement.id} /> : null}

      <FormError state={state} />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Engagement type" required error={errors.engagement_type_id}>
          {(props) => (
            <Select
              {...props}
              name="engagement_type_id"
              required
              defaultValue={engagement?.type?.id ?? ''}
              invalid={!!errors.engagement_type_id}
            >
              <option value="">Choose a type</option>
              {types.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.label}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field label="Status" error={errors.status}>
          {(props) => (
            <Select
              {...props}
              name="status"
              value={status}
              onChange={(event) => setStatus(event.currentTarget.value as EngagementStatus)}
            >
              {ENGAGEMENT_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {ENGAGEMENT_STATUS_LABELS[value]}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field
          label="Role detail"
          hint="How they serve, e.g. Worship team, Monthly partner."
          error={errors.role_detail}
        >
          {(props) => (
            <Input
              {...props}
              name="role_detail"
              maxLength={120}
              defaultValue={engagement?.role_detail ?? ''}
              invalid={!!errors.role_detail}
            />
          )}
        </Field>

        <Field label="Owner" hint="Who looks after this relationship.">
          {(props) => (
            <Select {...props} name="owner_id" defaultValue={engagement?.owner?.id ?? ''}>
              <option value="">Unassigned</option>
              {owners.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                  {member.is_active ? '' : ' (deactivated)'}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field label="Started on" required error={errors.started_on}>
          {(props) => (
            <Input
              {...props}
              name="started_on"
              type="date"
              required
              defaultValue={engagement?.started_on ?? today}
              invalid={!!errors.started_on}
            />
          )}
        </Field>

        {status === 'ended' ? (
          <Field
            label="Ended on"
            required
            hint="An ended engagement has to record when it ended."
            error={errors.ended_on}
          >
            {(props) => (
              <Input
                {...props}
                name="ended_on"
                type="date"
                required
                defaultValue={engagement?.ended_on ?? today}
                invalid={!!errors.ended_on}
              />
            )}
          </Field>
        ) : null}

        <Field label="Notes" error={errors.notes} className="sm:col-span-2">
          {(props) => (
            <Textarea
              {...props}
              name="notes"
              rows={3}
              maxLength={2000}
              defaultValue={engagement?.notes ?? ''}
              invalid={!!errors.notes}
            />
          )}
        </Field>
      </div>

      <div className="flex flex-wrap gap-2 border-t border-slate-200/70 pt-4">
        <SubmitButton size="sm">{submitLabel}</SubmitButton>
        <Button type="button" variant="ghost" size="sm" onClick={onDone}>
          Discard
        </Button>
      </div>
    </form>
  )
}
