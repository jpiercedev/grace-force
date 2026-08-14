'use client'

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import type { PipelineEditorState } from '@/app/(app)/sales/pipelines/actions'
import { Button } from '@/components/ui/button'
import { Callout } from '@/components/ui/display'
import { Checkbox, Field, Input, Textarea } from '@/components/ui/form'

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Creating…' : 'Create pipeline'}
    </Button>
  )
}

/** Success redirects to the new pipeline's editor, so only failure renders here. */
export function PipelineCreateForm({
  action,
}: {
  action: (prev: PipelineEditorState, formData: FormData) => Promise<PipelineEditorState>
}) {
  const [state, formAction] = useActionState<PipelineEditorState, FormData>(action, {})
  const fieldErrors = state.fieldErrors ?? {}

  return (
    <form action={formAction} className="space-y-4" noValidate>
      {state.error ? (
        <Callout tone="danger" role="alert">
          {state.error}
        </Callout>
      ) : null}

      <Field label="Name" required error={fieldErrors.name}>
        {(props) => (
          <Input
            {...props}
            name="name"
            required
            maxLength={80}
            placeholder="e.g. Grant applications"
            invalid={!!fieldErrors.name}
          />
        )}
      </Field>

      <Field
        label="Description"
        hint="Optional — what kind of work moves through it."
        error={fieldErrors.description}
      >
        {(props) => (
          <Textarea
            {...props}
            name="description"
            rows={2}
            maxLength={500}
            invalid={!!fieldErrors.description}
          />
        )}
      </Field>

      <Checkbox
        name="tracks_value"
        label="Track a money value on its opportunities"
        hint="Leave off for relationship work with no dollar figure attached."
      />

      <SubmitButton />
    </form>
  )
}
