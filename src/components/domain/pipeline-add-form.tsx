'use client'

import { useActionState, useState } from 'react'
import { useFormStatus } from 'react-dom'
import type { PipelineActionState } from '@/app/(app)/pipelines/actions'
import { Button } from '@/components/ui/button'
import { Avatar, Callout } from '@/components/ui/display'
import { Field, Input, Select, Textarea } from '@/components/ui/form'
import type { ContactSummary, TeamProfile } from '@/lib/queries/pipelines'
import { contactDisplayName } from '@/lib/utils'

/** What the form needs to know about a pipeline it could create the card in. */
export interface PipelineFormChoice {
  id: string
  name: string
  tracks_value: boolean
  stages: { id: string; name: string }[]
}

export interface PipelineAddFormProps {
  action: (prev: PipelineActionState, formData: FormData) => Promise<PipelineActionState>
  /** One entry pins the pipeline; several render a choice. Never empty. */
  pipelines: PipelineFormChoice[]
  defaultPipelineId?: string
  contact: ContactSummary
  team: TeamProfile[]
  defaultOwnerId: string
  submitLabel?: string
}

function SubmitButton({ label }: { label: string }) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Saving…' : label}
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
  pipelines,
  defaultPipelineId,
  contact,
  team,
  defaultOwnerId,
  submitLabel = 'Add to pipeline',
}: PipelineAddFormProps) {
  const [state, formAction] = useActionState<PipelineActionState, FormData>(action, {})
  // The stage list and the value field follow the chosen pipeline, so the
  // choice is client state rather than an uncontrolled select.
  const [pipelineId, setPipelineId] = useState(() =>
    defaultPipelineId && pipelines.some((option) => option.id === defaultPipelineId)
      ? defaultPipelineId
      : (pipelines[0]?.id ?? ''),
  )
  const fieldErrors = state.fieldErrors ?? {}
  const displayName = contactDisplayName(contact)

  const pipeline = pipelines.find((option) => option.id === pipelineId) ?? pipelines[0]
  if (!pipeline) return null

  return (
    <form action={formAction} className="space-y-6" noValidate>
      {pipelines.length === 1 ? (
        <input type="hidden" name="pipeline_id" value={pipeline.id} />
      ) : null}
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
            Adding to {pipeline.name}
          </p>
          <p className="truncate text-sm font-semibold text-slate-900">
            {displayName}
          </p>
        </div>
      </div>

      <fieldset className="space-y-4">
        <SectionLegend>The opportunity</SectionLegend>

        {pipelines.length > 1 ? (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Pipeline" error={fieldErrors.pipeline_id}>
              {(props) => (
                <Select
                  {...props}
                  name="pipeline_id"
                  value={pipelineId}
                  onChange={(event) => setPipelineId(event.currentTarget.value)}
                >
                  {pipelines.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            <StageField pipeline={pipeline} error={fieldErrors.stage_id} />
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <StageField pipeline={pipeline} error={fieldErrors.stage_id} />
          </div>
        )}

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
          hint="Optional — who the opportunity is with, when it isn't just the person."
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

        <Field
          label="Next step"
          hint="The one concrete thing that moves this forward."
          error={fieldErrors.next_step}
        >
          {(props) => (
            <Input
              {...props}
              name="next_step"
              maxLength={300}
              invalid={!!fieldErrors.next_step}
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
            {pipeline.tracks_value ? (
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
        <SubmitButton label={submitLabel} />
      </div>
    </form>
  )
}

/**
 * Keyed by pipeline so switching pipelines re-seats the default on the new
 * first stage instead of holding a stale selection from the previous list.
 */
function StageField({
  pipeline,
  error,
}: {
  pipeline: PipelineFormChoice
  error?: string
}) {
  if (pipeline.stages.length === 0) {
    return (
      <p className="self-end text-sm text-slate-500">
        This pipeline has no stages yet, so nothing can be added to it.
      </p>
    )
  }
  return (
    <Field key={pipeline.id} label="Stage" error={error}>
      {(props) => (
        <Select {...props} name="stage_id" defaultValue={pipeline.stages[0]?.id}>
          {pipeline.stages.map((stage) => (
            <option key={stage.id} value={stage.id}>
              {stage.name}
            </option>
          ))}
        </Select>
      )}
    </Field>
  )
}
