'use client'

import { useActionState } from 'react'
import { useFormStatus } from 'react-dom'
import { changePassword, type ChangePasswordState } from './actions'
import { Button } from '@/components/ui/button'
import { Callout } from '@/components/ui/display'
import { Field, Input } from '@/components/ui/form'

function SubmitButton() {
  const { pending } = useFormStatus()
  return (
    // Pending is busy, not unavailable: keep the label readable instead of
    // letting the generic disabled fade wash it out.
    <Button
      type="submit"
      size="lg"
      className="w-full disabled:opacity-100 disabled:bg-brand-500"
      disabled={pending}
    >
      {pending ? 'Saving…' : 'Set new password'}
    </Button>
  )
}

export function ChangePasswordForm() {
  const [state, formAction] = useActionState<ChangePasswordState, FormData>(changePassword, {})

  return (
    <form action={formAction} className="space-y-5" noValidate>
      {state.error ? (
        <Callout tone="danger" role="alert">
          {state.error}
        </Callout>
      ) : null}

      {/* Off-screen, but present: password managers match a credential to an
          account, and without the username there is nothing for them to
          update. `autoComplete="username"` is the documented hint. */}
      <input type="hidden" name="username" autoComplete="username" />

      <Field label="New password" hint="At least 8 characters." required>
        {(props) => (
          <Input
            {...props}
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={8}
            required
            autoFocus
            invalid={!!state.error}
          />
        )}
      </Field>

      <Field label="Confirm new password" required>
        {(props) => (
          <Input
            {...props}
            name="confirm"
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
