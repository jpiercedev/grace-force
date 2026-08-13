'use client'

import { useActionState, useEffect, useId, useRef, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { Button } from '@/components/ui/button'
import { Badge, Callout, CardBody } from '@/components/ui/display'
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/form'
import {
  COLOR_LABELS,
  ENGAGEMENT_COLORS,
  slugify,
  type EngagementColor,
  type EngagementTypeActionState,
} from './catalogue'
import { createEngagementType } from './actions'

function CreateButton() {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Adding…' : 'Add engagement type'}
    </Button>
  )
}

/**
 * The create form.
 *
 * Kept behind a disclosure because adding a type is rare next to editing one,
 * and the slug field needs a paragraph of explanation that would otherwise sit
 * on the page permanently. Closed and reopened, the form is remounted, so a
 * successful submission does not leave the previous entry behind.
 */
export function NewEngagementType() {
  const [state, formAction] = useActionState<EngagementTypeActionState, FormData>(
    createEngagementType,
    {},
  )
  const [open, setOpen] = useState(false)
  const [label, setLabel] = useState('')
  const [slug, setSlug] = useState('')
  const [slugEdited, setSlugEdited] = useState(false)
  const [color, setColor] = useState<EngagementColor>('slate')
  const formRef = useRef<HTMLDivElement>(null)
  const formId = useId()

  useEffect(() => {
    if (!open) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open])

  useEffect(() => {
    if (open) formRef.current?.querySelector<HTMLElement>('input')?.focus()
  }, [open])

  useEffect(() => {
    if (!state.notice) return
    setOpen(false)
    setLabel('')
    setSlug('')
    setSlugEdited(false)
    setColor('slate')
  }, [state])

  // The slug follows the label until someone types their own, at which point it
  // is theirs — a slug is permanent, so it must never be rewritten underneath.
  function onLabelChange(value: string) {
    setLabel(value)
    if (!slugEdited) setSlug(slugify(value))
  }

  return (
    <CardBody className="space-y-3">
      {state.notice ? (
        <Callout tone="success" role="status">
          {state.notice}
        </Callout>
      ) : null}

      {state.error ? (
        <Callout tone="danger" role="alert">
          {state.error}
        </Callout>
      ) : null}

      {/* "Close" while open, matching the roster and catalogue toggles — the
          in-panel ghost button is the one labelled Cancel. */}
      <Button
        type="button"
        variant={open ? 'ghost' : 'secondary'}
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls={open ? formId : undefined}
      >
        {open ? 'Close' : 'Add an engagement type'}
      </Button>

      {open ? (
        <form action={formAction}>
          <div
            ref={formRef}
            id={formId}
            className="space-y-4 rounded-lg border border-slate-200 bg-slate-100/60 p-4 sm:p-5"
          >
            <Field label="Label" error={state.fieldErrors?.label} required className="max-w-md">
              {(props) => (
                <Input
                  {...props}
                  name="label"
                  value={label}
                  onChange={(event) => onLabelChange(event.target.value)}
                  maxLength={80}
                  invalid={!!state.fieldErrors?.label}
                  required
                />
              )}
            </Field>

            <Field
              label="Slug"
              hint="Lower-case letters, numbers and underscores. Permanent once saved: the public lead form posts this value and the Mailchimp sync looks types up by it."
              error={state.fieldErrors?.slug}
              required
              className="max-w-md"
            >
              {(props) => (
                <Input
                  {...props}
                  name="slug"
                  value={slug}
                  onChange={(event) => {
                    setSlugEdited(true)
                    setSlug(event.target.value)
                  }}
                  maxLength={40}
                  className="font-mono"
                  invalid={!!state.fieldErrors?.slug}
                  required
                />
              )}
            </Field>

            <Field
              label="Description"
              hint="Shown to staff when they choose an engagement type."
              error={state.fieldErrors?.description}
              className="max-w-xl"
            >
              {(props) => (
                <Textarea
                  {...props}
                  name="description"
                  maxLength={500}
                  rows={2}
                  invalid={!!state.fieldErrors?.description}
                />
              )}
            </Field>

            <div className="flex flex-wrap items-end gap-3">
              <Field label="Colour" error={state.fieldErrors?.color} className="min-w-[12rem]">
                {(props) => (
                  <Select
                    {...props}
                    name="color"
                    value={color}
                    onChange={(event) => setColor(event.target.value as EngagementColor)}
                    invalid={!!state.fieldErrors?.color}
                  >
                    {ENGAGEMENT_COLORS.map((option) => (
                      <option key={option} value={option}>
                        {COLOR_LABELS[option]}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>

              <p className="pb-2">
                <Badge tone={color}>{label.trim() || 'Preview'}</Badge>
              </p>

              <Field
                label="Position"
                hint="Lower sorts first."
                error={state.fieldErrors?.sort_order}
                className="w-28"
              >
                {(props) => (
                  <Input
                    {...props}
                    name="sort_order"
                    type="number"
                    min={0}
                    max={9999}
                    step={1}
                    defaultValue={100}
                    invalid={!!state.fieldErrors?.sort_order}
                  />
                )}
              </Field>
            </div>

            <Checkbox
              name="is_active"
              label="Offered for new engagements"
              hint="Turn this off to prepare a type before anyone can choose it."
              defaultChecked
            />

            <div className="flex flex-wrap gap-2">
              <CreateButton />
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
            </div>
          </div>
        </form>
      ) : null}
    </CardBody>
  )
}
