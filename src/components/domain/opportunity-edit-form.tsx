'use client'

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import type { PipelineActionState } from '@/app/(app)/sales/actions'
import { Button } from '@/components/ui/button'
import { Callout } from '@/components/ui/display'
import { Field, Input, Select, Textarea } from '@/components/ui/form'
import type { OpportunityListItem, TeamProfile } from '@/lib/queries/pipelines'

export interface OpportunityEditFormProps {
  action: (prev: PipelineActionState, formData: FormData) => Promise<PipelineActionState>
  opportunity: OpportunityListItem
  team: TeamProfile[]
  tracksValue: boolean
}

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Saving…' : 'Save changes'}
    </Button>
  )
}

/** Everything about an open opportunity except its person, pipeline and
 *  status — those change on the board, not here. */
export function OpportunityEditForm({
  action,
  opportunity,
  team,
  tracksValue,
}: OpportunityEditFormProps) {
  const [state, formAction] = useActionState<PipelineActionState, FormData>(action, {})
  const fieldErrors = state.fieldErrors ?? {}

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <input type="hidden" name="id" value={opportunity.id} />

      {state.error ? (
        <Callout tone="danger" role="alert">
          {state.error}
        </Callout>
      ) : null}
      {state.notice ? (
        <Callout tone="success" role="status">
          {state.notice}
        </Callout>
      ) : null}

      <Field label="Title" required error={fieldErrors.title}>
        {(props) => (
          <Input
            {...props}
            name="title"
            required
            maxLength={200}
            defaultValue={opportunity.title}
            invalid={!!fieldErrors.title}
          />
        )}
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Organization" hint="Optional." error={fieldErrors.organization_name}>
          {(props) => (
            <Input
              {...props}
              name="organization_name"
              maxLength={200}
              defaultValue={opportunity.organization_name ?? ''}
              invalid={!!fieldErrors.organization_name}
            />
          )}
        </Field>

        <Field label="Owner" error={fieldErrors.owner_id}>
          {(props) => (
            <Select {...props} name="owner_id" defaultValue={opportunity.owner_id ?? ''}>
              <option value="">Unassigned</option>
              {team.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.full_name?.trim() || member.email}
                </option>
              ))}
            </Select>
          )}
        </Field>

        {tracksValue ? (
          <Field
            label="Expected value"
            hint="Dollar amount — enter it like 1,500."
            error={fieldErrors.value_cents}
          >
            {(props) => (
              <Input
                {...props}
                name="value_cents"
                inputMode="decimal"
                defaultValue={
                  opportunity.value_cents !== null
                    ? (opportunity.value_cents / 100).toLocaleString('en-US', {
                        maximumFractionDigits: 2,
                      })
                    : ''
                }
                invalid={!!fieldErrors.value_cents}
              />
            )}
          </Field>
        ) : null}

        <Field label="Expected close" error={fieldErrors.expected_close_on}>
          {(props) => (
            <Input
              {...props}
              name="expected_close_on"
              type="date"
              defaultValue={opportunity.expected_close_on ?? ''}
              invalid={!!fieldErrors.expected_close_on}
            />
          )}
        </Field>
      </div>

      <Field
        label="Next step"
        hint="The one action that moves this forward — shown on the board."
        error={fieldErrors.next_step}
      >
        {(props) => (
          <Input
            {...props}
            name="next_step"
            maxLength={300}
            defaultValue={opportunity.next_step ?? ''}
            placeholder="e.g. Send the proposal draft"
            invalid={!!fieldErrors.next_step}
          />
        )}
      </Field>

      <Field label="Notes" hint="Context for the team." error={fieldErrors.details}>
        {(props) => (
          <Textarea
            {...props}
            name="details"
            rows={4}
            maxLength={4000}
            defaultValue={opportunity.details ?? ''}
            invalid={!!fieldErrors.details}
          />
        )}
      </Field>

      <div className="border-t border-slate-200 pt-4">
        <SubmitButton />
      </div>
    </form>
  )
}
