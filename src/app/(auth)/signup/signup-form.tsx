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
    <Button type="submit" size="lg" className="w-full" disabled={pending}>
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
          <Input {...props} name="fullName" autoComplete="name" required autoFocus placeholder="Jane Carter" />
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
            placeholder="you@graceforce.org"
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
          />
        )}
      </Field>

      <SubmitButton />
    </form>
  )
}
