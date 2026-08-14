'use client'

import { useActionState, useState } from 'react'
import { useFormStatus } from 'react-dom'
import type { PipelineActionState } from '@/app/(app)/sales/actions'
import { Button } from '@/components/ui/button'
import { Avatar, Callout } from '@/components/ui/display'
import { Field, Input, Select, Textarea } from '@/components/ui/form'
import type { ContactSummary, TeamProfile } from '@/lib/queries/pipelines'
import { contactDisplayName } from '@/lib/utils'

export interface PipelineChoice {
  id: string
  name: string
  tracks_value: boolean
  has_stages: boolean
}

export interface PipelineAddFormProps {
  action: (prev: PipelineActionState, formData: FormData) => Promise<PipelineActionState>
  /** Fixed pipeline (board's add page)… */
  pipelineId?: string
  pipelineName?: string
  tracksValue?: boolean
  /** …or a picker (creating from a person or the Sales overview). */
  pipelines?: PipelineChoice[]
  contact: ContactSummary
  team: TeamProfile[]
  defaultOwnerId: string
  /** Land back on the person instead of the board after creating. */
  returnToContact?: boolean
}

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Creating…' : 'Create opportunity'}
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
  tracksValue,
  pipelines,
  contact,
  team,
  defaultOwnerId,
  returnToContact = false,
}: PipelineAddFormProps) {
  const [state, formAction] = useActionState<PipelineActionState, FormData>(action, {})
  const [selectedPipeline, setSelectedPipeline] = useState(
    pipelines?.find((pipeline) => pipeline.has_stages)?.id ?? '',
  )
  const fieldErrors = state.fieldErrors ?? {}
  const displayName = contactDisplayName(contact)

  // With a picker, value tracking follows whichever pipeline is chosen.
  const chosen = pipelines?.find((pipeline) => pipeline.id === selectedPipeline)
  const showValue = pipelines ? (chosen?.tracks_value ?? false) : (tracksValue ?? false)

  return (
    <form action={formAction} className="space-y-6" noValidate>
      {pipelines ? null : <input type="hidden" name="pipeline_id" value={pipelineId} />}
      <input type="hidden" name="contact_id" value={contact.id} />
      {returnToContact ? <input type="hidden" name="return_to" value="contact" /> : null}

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
            {pipelineName ? `New opportunity in ${pipelineName}` : 'New opportunity'}
          </p>
          <p className="truncate text-sm font-semibold text-slate-900">
            {displayName}
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            The opportunity starts in the pipeline’s first stage.
          </p>
        </div>
      </div>

      <fieldset className="space-y-4">
        <SectionLegend>The opportunity</SectionLegend>

        {pipelines ? (
          <Field label="Pipeline" required error={fieldErrors.pipeline_id}>
            {(props) => (
              <Select
                {...props}
                name="pipeline_id"
                required
                value={selectedPipeline}
                onChange={(event) => setSelectedPipeline(event.currentTarget.value)}
              >
                {pipelines.map((pipeline) => (
                  <option key={pipeline.id} value={pipeline.id} disabled={!pipeline.has_stages}>
                    {pipeline.name}
                    {pipeline.has_stages ? '' : ' (no stages yet)'}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        ) : null}

        <Field label="Title" required error={fieldErrors.title}>
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

        <Field
          label="Organization"
          hint="Optional — when the deal is with a company or church rather than the person alone."
          error={fieldErrors.organization_name}
        >
          {(props) => (
            <Input
              {...props}
              name="organization_name"
              maxLength={200}
              defaultValue={contact.organization_name ?? ''}
              invalid={!!fieldErrors.organization_name}
            />
          )}
        </Field>

        <Field label="Notes" hint="Optional context for the team." error={fieldErrors.details}>
          {(props) => (
            <Textarea {...props} name="details" rows={3} maxLength={4000} invalid={!!fieldErrors.details} />
          )}
        </Field>
      </fieldset>

      <div className="border-t border-slate-200 pt-5">
        <fieldset className="space-y-4">
          <SectionLegend>Forecast</SectionLegend>

          <div className="grid gap-4 sm:grid-cols-2">
            {showValue ? (
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
          <SectionLegend>Ownership and next action</SectionLegend>

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
                  placeholder="e.g. Send the proposal draft"
                  invalid={!!fieldErrors.next_step}
                />
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
