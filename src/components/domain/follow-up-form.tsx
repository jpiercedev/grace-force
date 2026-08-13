'use client'

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import type { FollowUpActionState } from '@/app/(app)/follow-ups/actions'
import { Button } from '@/components/ui/button'
import { Avatar, Callout } from '@/components/ui/display'
import { Field, Input, Select, Textarea } from '@/components/ui/form'
import type { ContactSummary, TeamProfile } from '@/lib/queries/follow-ups'
import { contactDisplayName } from '@/lib/utils'
import { FOLLOW_UP_PRIORITIES, PRIORITY_LABELS } from '@/lib/validation/follow-up'

export interface FollowUpFormProps {
  action: (prev: FollowUpActionState, formData: FormData) => Promise<FollowUpActionState>
  contact: ContactSummary
  team: TeamProfile[]
  defaultAssigneeId: string
  /**
   * `datetime-local` value for the due field, computed on the server so the
   * first client render matches and the input does not flicker.
   */
  defaultDueAt: string
  /** Relative in-app path to land on afterwards; omitted, the form stays put. */
  redirectTo?: string
  engagementId?: string
  pipelineCardId?: string
}

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Saving…' : 'Schedule follow-up'}
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

export function FollowUpForm({
  action,
  contact,
  team,
  defaultAssigneeId,
  defaultDueAt,
  redirectTo,
  engagementId,
  pipelineCardId,
}: FollowUpFormProps) {
  const [state, formAction] = useActionState<FollowUpActionState, FormData>(action, {})
  const fieldErrors = state.fieldErrors ?? {}
  const displayName = contactDisplayName(contact)

  return (
    <form action={formAction} className="space-y-6" noValidate>
      <input type="hidden" name="contact_id" value={contact.id} />
      {redirectTo ? <input type="hidden" name="redirect_to" value={redirectTo} /> : null}
      {engagementId ? <input type="hidden" name="engagement_id" value={engagementId} /> : null}
      {pipelineCardId ? (
        <input type="hidden" name="pipeline_card_id" value={pipelineCardId} />
      ) : null}

      {state.error ? (
        <Callout tone="danger" role="alert">
          {state.error}
        </Callout>
      ) : null}
      {state.notice ? <Callout tone="success">{state.notice}</Callout> : null}

      {/* The person this commitment is about leads the form, face first. */}
      <div className="flex items-center gap-3 rounded-lg bg-slate-100/70 px-4 py-3">
        <Avatar name={displayName} size="md" />
        <div className="min-w-0">
          <p className="text-xs font-medium text-slate-500">
            Follow-up for
          </p>
          <p className="truncate text-sm font-semibold text-slate-900">
            {displayName}
          </p>
        </div>
      </div>

      <fieldset className="space-y-4">
        <SectionLegend>The task</SectionLegend>

        <Field label="What needs doing" required error={fieldErrors.title}>
          {(props) => (
            <Input
              {...props}
              name="title"
              required
              maxLength={200}
              autoFocus
              placeholder="Call about the spring appeal"
              invalid={!!fieldErrors.title}
            />
          )}
        </Field>

        <Field
          label="Details"
          hint="Optional context for whoever picks this up."
          error={fieldErrors.details}
        >
          {(props) => (
            <Textarea {...props} name="details" rows={3} maxLength={4000} invalid={!!fieldErrors.details} />
          )}
        </Field>
      </fieldset>

      <div className="border-t border-slate-200 pt-5">
        <fieldset className="space-y-4">
          <SectionLegend>Schedule</SectionLegend>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Due" required error={fieldErrors.due_at}>
              {(props) => (
                <Input
                  {...props}
                  name="due_at"
                  type="datetime-local"
                  required
                  defaultValue={defaultDueAt}
                  invalid={!!fieldErrors.due_at}
                />
              )}
            </Field>

            <Field
              label="Remind at"
              hint="Leave blank to be reminded when it falls due."
              error={fieldErrors.remind_at}
            >
              {(props) => (
                <Input
                  {...props}
                  name="remind_at"
                  type="datetime-local"
                  invalid={!!fieldErrors.remind_at}
                />
              )}
            </Field>

            <Field label="Priority" error={fieldErrors.priority}>
              {(props) => (
                <Select {...props} name="priority" defaultValue="normal">
                  {FOLLOW_UP_PRIORITIES.map((priority) => (
                    <option key={priority} value={priority}>
                      {PRIORITY_LABELS[priority]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
        </fieldset>
      </div>

      <div className="border-t border-slate-200 pt-5">
        <fieldset className="space-y-4">
          <SectionLegend>Ownership</SectionLegend>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Assign to" error={fieldErrors.assigned_to}>
              {(props) => (
                <Select {...props} name="assigned_to" defaultValue={defaultAssigneeId}>
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
