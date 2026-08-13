'use client'

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import type { PipelineActionState } from '@/app/(app)/pipelines/actions'
import { Button } from '@/components/ui/button'
import { Avatar, Callout } from '@/components/ui/display'
import { Field, Input, Select, Textarea } from '@/components/ui/form'
import type { ContactSummary, TeamProfile } from '@/lib/queries/pipelines'
import { contactDisplayName } from '@/lib/utils'

export interface PipelineAddFormProps {
  action: (prev: PipelineActionState, formData: FormData) => Promise<PipelineActionState>
  pipelineId: string
  pipelineName: string
  contact: ContactSummary
  team: TeamProfile[]
  tracksValue: boolean
  defaultOwnerId: string
}

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Adding…' : 'Add to pipeline'}
    </Button>
  )
}

/** Editorial section eyebrow — the form reads in labelled passages, not one long column. */
function SectionLegend({ children }: { children: string }) {
  return (
    <legend className="text-xs font-medium text-slate-500">
      {children}
    </legend>
  )
}

export function PipelineAddForm({
  action,
  pipelineId,
  pipelineName,
  contact,
  team,
  tracksValue,
  defaultOwnerId,
}: PipelineAddFormProps) {
  const [state, formAction] = useActionState<PipelineActionState, FormData>(action, {})
  const fieldErrors = state.fieldErrors ?? {}
  const displayName = contactDisplayName(contact)

  return (
    <form action={formAction} className="space-y-6" noValidate>
      <input type="hidden" name="pipeline_id" value={pipelineId} />
      <input type="hidden" name="contact_id" value={contact.id} />

      {state.error ? (
        <Callout tone="danger" role="alert">
          {state.error}
        </Callout>
      ) : null}

      {/* The person being added leads the form, face first. */}
      <div className="flex items-center gap-3 rounded-lg bg-slate-100/70 px-4 py-3">
        <Avatar name={displayName} size="md" />
        <div className="min-w-0">
          <p className="text-xs font-medium text-slate-500">
            Adding to {pipelineName}
          </p>
          <p className="truncate text-sm font-semibold text-slate-900">
            {displayName}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">The card starts in the first stage.</p>
        </div>
      </div>

      <fieldset className="space-y-4">
        <SectionLegend>The card</SectionLegend>

        <Field label="Card title" required error={fieldErrors.title}>
          {(props) => (
            <Input
              {...props}
              name="title"
              required
              maxLength={200}
              defaultValue={displayName}
              invalid={!!fieldErrors.title}
            />
          )}
        </Field>

        <Field label="Details" hint="Optional context for the team." error={fieldErrors.details}>
          {(props) => (
            <Textarea {...props} name="details" rows={3} maxLength={4000} invalid={!!fieldErrors.details} />
          )}
        </Field>
      </fieldset>

      <div className="border-t border-slate-200 pt-5">
        <fieldset className="space-y-4">
          <SectionLegend>Forecast</SectionLegend>

          <div className="grid gap-4 sm:grid-cols-2">
            {tracksValue ? (
              <Field
                label="Expected value"
                hint="Dollar amount — enter it like 1,500 or $1,500.50."
                error={fieldErrors.value_cents}
              >
                {(props) => (
                  <Input
                    {...props}
                    name="value_cents"
                    inputMode="decimal"
                    placeholder="5,000"
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
                  invalid={!!fieldErrors.expected_close_on}
                />
              )}
            </Field>
          </div>
        </fieldset>
      </div>

      <div className="border-t border-slate-200 pt-5">
        <fieldset className="space-y-4">
          <SectionLegend>Ownership</SectionLegend>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Owner" error={fieldErrors.owner_id}>
              {(props) => (
                <Select {...props} name="owner_id" defaultValue={defaultOwnerId}>
                  <option value="">Unassigned</option>
                  {team.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.full_name?.trim() || member.email}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
        </fieldset>
      </div>

      <div className="border-t border-slate-200 pt-5">
        <SubmitButton />
      </div>
    </form>
  )
}
