'use client'

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import { signIn, type AuthFormState } from '../actions'
import { Button } from '@/components/ui/button'
import { Callout } from '@/components/ui/display'
import { Field, Input } from '@/components/ui/form'

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" size="lg" className="w-full" disabled={pending}>
      {pending ? 'Signing in…' : 'Sign in'}
    </Button>
  )
}

export function LoginForm({ next }: { next?: string }) {
  const [state, formAction] = useActionState<AuthFormState, FormData>(signIn, {})

  return (
    <form action={formAction} className="space-y-5" noValidate>
      {next ? <input type="hidden" name="next" value={next} /> : null}

      {state.error ? (
        <Callout tone="danger" role="alert">
          {state.error}
        </Callout>
      ) : null}

      <Field label="Email address" required>
        {(props) => (
          <Input
            {...props}
            name="email"
            type="email"
            autoComplete="email"
            required
            autoFocus
            placeholder="you@graceforce.org"
            invalid={!!state.error}
          />
        )}
      </Field>

      <Field label="Password" required>
        {(props) => (
          <Input
            {...props}
            name="password"
            type="password"
            autoComplete="current-password"
            required
            invalid={!!state.error}
          />
        )}
      </Field>

      <SubmitButton />
    </form>
  )
}
