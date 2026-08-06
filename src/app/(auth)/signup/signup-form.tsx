'use client'

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import { signUp, type AuthFormState } from '../actions'
import { Button } from '@/components/ui/button'
import { Callout } from '@/components/ui/display'
import { Field, Input } from '@/components/ui/form'

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    // Pending is busy, not unavailable: keep "Creating account…" fully
    // readable instead of letting the generic disabled fade wash it out.
    <Button
      type="submit"
      size="lg"
      className="w-full disabled:opacity-100 disabled:bg-brand-500"
      disabled={pending}
    >
      {pending ? 'Creating account…' : 'Create account'}
    </Button>
  )
}

export function SignupForm() {
  const [state, formAction] = useActionState<AuthFormState, FormData>(signUp, {})

  return (
    <form action={formAction} className="space-y-5" noValidate>
      {state.error ? (
        <Callout tone="danger" role="alert">
          {state.error}
        </Callout>
      ) : null}

      <Field label="Full name" required>
        {(props) => (
          <Input
            {...props}
            name="fullName"
            autoComplete="name"
            required
            autoFocus
            placeholder="e.g. Jane Carter"
            invalid={!!state.error}
          />
        )}
      </Field>

      <Field label="Email address" required>
        {(props) => (
          <Input
            {...props}
            name="email"
            type="email"
            autoComplete="email"
            required
            placeholder="e.g. jane@graceforce.org"
            invalid={!!state.error}
          />
        )}
      </Field>

      <Field label="Password" hint="At least 8 characters." required>
        {(props) => (
          <Input
            {...props}
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
            invalid={!!state.error}
          />
        )}
      </Field>

      <SubmitButton />
    </form>
  )
}
