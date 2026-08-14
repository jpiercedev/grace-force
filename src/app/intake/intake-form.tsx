'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Callout } from '@/components/ui/display'
import { Field, Input, Select, Textarea } from '@/components/ui/form'
import {
  HONEYPOT_FIELD,
  INTEREST_OPTIONS,
  MESSAGE_MAX_LENGTH,
  UTM_KEYS,
  type LeadIntakeResult,
} from '@/lib/leads/form'

type Status = 'idle' | 'sending' | 'sent'

const NETWORK_ERROR = 'We could not reach the server. Check your connection and try again.'
const UNKNOWN_ERROR = 'Something went wrong at our end. Please try again in a moment.'

/**
 * The public enquiry form.
 *
 * It posts JSON to `/api/leads` rather than using a server action, because the
 * same endpoint is what an embedded form on the main website posts to — one
 * validated front door, not two. Nothing here reads app state: an
 * unauthenticated visitor must not be able to learn anything about the CRM
 * beyond the fact that this form exists.
 */
export function IntakeForm({ formKey }: { formKey: string }) {
  const [status, setStatus] = useState<Status>('idle')
  const [error, setError] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const honeypotId = useId()
  const outcomeRef = useRef<HTMLDivElement>(null)

  // Move focus to the outcome so the result is announced; without this a
  // screen-reader user is left at a submit button with no evident change.
  useEffect(() => {
    if (status === 'sent' || error) outcomeRef.current?.focus()
  }, [status, error])

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (status === 'sending') return

    const form = event.currentTarget
    setStatus('sending')
    setError(null)
    setFieldErrors({})

    const entries = new FormData(form)
    const payload: Record<string, string> = { form_key: formKey }
    for (const [key, value] of entries.entries()) {
      if (typeof value === 'string') payload[key] = value
    }

    // Campaign context belongs to the page, not to anything the visitor typed.
    const params = new URLSearchParams(window.location.search)
    for (const key of UTM_KEYS) {
      const value = params.get(key)
      if (value) payload[key] = value
    }
    payload.page_url = window.location.href

    try {
      const response = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const result = (await response.json().catch(() => null)) as LeadIntakeResult | null

      if (response.ok && result?.ok) {
        form.reset()
        setStatus('sent')
        return
      }

      setStatus('idle')
      if (result && !result.ok) {
        setError(result.error)
        setFieldErrors(result.fieldErrors ?? {})
      } else {
        setError(UNKNOWN_ERROR)
      }
    } catch {
      setStatus('idle')
      setError(NETWORK_ERROR)
    }
  }

  if (status === 'sent') {
    return (
      <div ref={outcomeRef} tabIndex={-1} className="space-y-4">
        <Callout tone="success" title="Thank you — we have your message." role="status">
          Someone from the Grace team will be in touch. There is nothing else you need to
          do.
        </Callout>
        <Button variant="secondary" onClick={() => setStatus('idle')}>
          Send another message
        </Button>
      </div>
    )
  }

  const sending = status === 'sending'

  return (
    <form onSubmit={handleSubmit} className="space-y-5" noValidate>
      {/*
        Rendered only on failure: an always-present empty div would add a
        phantom space-y gap above the first row. The focus effect still finds
        the ref because it runs after the error render commits.
      */}
      {error ? (
        <div ref={outcomeRef} tabIndex={-1}>
          <Callout tone="danger" role="alert">
            {error}
          </Callout>
        </div>
      ) : null}

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="First name" error={fieldErrors.first_name}>
          {(props) => (
            <Input
              {...props}
              name="first_name"
              autoComplete="given-name"
              maxLength={80}
              invalid={!!fieldErrors.first_name}
            />
          )}
        </Field>

        <Field label="Last name" error={fieldErrors.last_name}>
          {(props) => (
            <Input
              {...props}
              name="last_name"
              autoComplete="family-name"
              maxLength={80}
              invalid={!!fieldErrors.last_name}
            />
          )}
        </Field>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field
          label="Email address"
          hint="Either an email or a phone number is enough."
          error={fieldErrors.email}
        >
          {(props) => (
            <Input
              {...props}
              name="email"
              type="email"
              autoComplete="email"
              maxLength={254}
              invalid={!!fieldErrors.email}
            />
          )}
        </Field>

        <Field label="Phone number" error={fieldErrors.phone}>
          {(props) => (
            <Input
              {...props}
              name="phone"
              type="tel"
              autoComplete="tel"
              maxLength={40}
              invalid={!!fieldErrors.phone}
            />
          )}
        </Field>
      </div>

      <Field label="Church or organisation" error={fieldErrors.organization_name}>
        {(props) => (
          <Input
            {...props}
            name="organization_name"
            autoComplete="organization"
            maxLength={160}
            invalid={!!fieldErrors.organization_name}
          />
        )}
      </Field>

      <Field label="What brings you here?" error={fieldErrors.interest}>
        {(props) => (
          <Select {...props} name="interest" defaultValue="">
            <option value="">I would rather just write a note</option>
            {INTEREST_OPTIONS.map((option) => (
              <option key={option.slug} value={option.slug}>
                {option.label}
              </option>
            ))}
          </Select>
        )}
      </Field>

      <Field label="Your message" error={fieldErrors.message}>
        {(props) => (
          <Textarea
            {...props}
            name="message"
            rows={5}
            maxLength={MESSAGE_MAX_LENGTH}
            invalid={!!fieldErrors.message}
          />
        )}
      </Field>

      {/*
        The honeypot. Positioned off-screen rather than hidden with `display:
        none` or `hidden`, because the simplest bots skip anything a browser
        reports as invisible. `aria-hidden` and `tabIndex={-1}` keep it away
        from assistive technology and the tab order.
      */}
      <div aria-hidden="true" className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label htmlFor={honeypotId}>Website</label>
        <input
          id={honeypotId}
          name={HONEYPOT_FIELD}
          type="text"
          tabIndex={-1}
          autoComplete="off"
          defaultValue=""
        />
      </div>

      {/*
        Pending is busy, not unavailable: keep "Sending…" fully readable
        instead of letting the generic disabled fade wash it out. The privacy
        note lives once, in the layout footer.
      */}
      <Button
        type="submit"
        size="lg"
        className="disabled:opacity-100 disabled:bg-brand-500"
        disabled={sending}
      >
        {sending ? 'Sending…' : 'Send message'}
      </Button>
    </form>
  )
}
