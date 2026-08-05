'use client'

import { useActionState, useEffect, useId, useRef, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { Button } from '@/components/ui/button'
import { Badge, Callout, badgeTone } from '@/components/ui/display'
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/form'
import { pluralize } from '@/lib/utils'
import type { EngagementTypeRow } from '@/types/database'
import {
  COLOR_LABELS,
  ENGAGEMENT_COLORS,
  WIRED_SLUGS,
  type EngagementColor,
  type EngagementTypeActionState,
} from './catalogue'
import { updateEngagementType } from './actions'

export interface TypeRowProps {
  type: EngagementTypeRow
  /** Engagements that are not ended — what deactivating this would affect. */
  liveEngagements: number
}

function SaveButton({ label }: { label: string }) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? 'Saving…' : 'Save changes'}
      <span className="sr-only">: {label}</span>
    </Button>
  )
}

/**
 * One catalogue entry, with its own result region.
 *
 * Rows stay put after a save, so each keeps its own action state: a field error
 * belongs beside the field that caused it, not in a banner shared with every
 * other row.
 */
export function TypeRow({ type, liveEngagements }: TypeRowProps) {
  const [state, formAction] = useActionState<EngagementTypeActionState, FormData>(
    updateEngagementType,
    {},
  )
  const [open, setOpen] = useState(false)
  const [color, setColor] = useState<EngagementColor>(
    (ENGAGEMENT_COLORS as readonly string[]).includes(type.color)
      ? (type.color as EngagementColor)
      : 'slate',
  )
  const panelRef = useRef<HTMLDivElement>(null)
  const panelId = useId()
  const wiredNote = WIRED_SLUGS[type.slug]

  useEffect(() => {
    if (!open) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open])

  useEffect(() => {
    if (open) panelRef.current?.querySelector<HTMLElement>('input, select, textarea')?.focus()
  }, [open])

  // A saved row has re-rendered with the stored values, so the panel has
  // nothing left to show.
  useEffect(() => {
    if (state.notice) setOpen(false)
  }, [state])

  return (
    <li className="px-4 py-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={badgeTone(type.color)}>{type.label}</Badge>
            <code className="font-mono text-xs text-slate-500">{type.slug}</code>
            {type.is_active ? null : <Badge tone="amber">Inactive</Badge>}
          </div>

          {type.description ? (
            <p className="text-sm text-slate-600">{type.description}</p>
          ) : (
            <p className="text-sm italic text-slate-400">No description.</p>
          )}

          <p className="text-xs text-slate-500">
            Position {type.sort_order} ·{' '}
            {liveEngagements === 0
              ? 'No live engagements'
              : pluralize(liveEngagements, 'live engagement')}
          </p>

          {wiredNote ? <p className="text-xs text-slate-500">{wiredNote}.</p> : null}
        </div>

        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          className="self-start"
        >
          {open ? 'Close' : 'Edit'}
          <span className="sr-only">: {type.label}</span>
        </Button>
      </div>

      {state.error ? (
        <Callout tone="danger" role="alert" className="mt-3">
          {state.error}
        </Callout>
      ) : null}

      {state.notice ? (
        <Callout tone="success" role="status" className="mt-3">
          {state.notice}
        </Callout>
      ) : null}

      {open ? (
        <form action={formAction}>
          <input type="hidden" name="id" value={type.id} />
          <div
            ref={panelRef}
            id={panelId}
            className="mt-3 space-y-4 rounded-md border border-slate-200 bg-slate-50 p-3"
          >
            <Field label="Label" error={state.fieldErrors?.label} required className="max-w-md">
              {(props) => (
                <Input
                  {...props}
                  name="label"
                  defaultValue={type.label}
                  maxLength={80}
                  invalid={!!state.fieldErrors?.label}
                  required
                />
              )}
            </Field>

            <div className="max-w-md space-y-1.5">
              <p className="block text-sm font-medium text-slate-700">Slug</p>
              <p className="rounded-md bg-white px-3 py-2 font-mono text-sm text-slate-500 ring-1 ring-inset ring-slate-200">
                {type.slug}
              </p>
              <p className="text-xs text-slate-500">
                Fixed once created. The public lead form posts this value and the Mailchimp sync
                looks types up by it, so changing it would quietly break both.
              </p>
            </div>

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
                  defaultValue={type.description ?? ''}
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
                <Badge tone={color}>{type.label}</Badge>
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
                    defaultValue={type.sort_order}
                    invalid={!!state.fieldErrors?.sort_order}
                  />
                )}
              </Field>
            </div>

            <Checkbox
              name="is_active"
              label="Offered for new engagements"
              hint="Turning this off hides the type from pickers and stops lead intake starting it. Engagements that already exist keep it."
              defaultChecked={type.is_active}
            />

            {wiredNote && type.is_active ? (
              <Callout tone="warning">
                The public lead form offers this type. Deactivating it means an enquiry naming{' '}
                <code className="font-mono text-xs">{type.slug}</code> is still captured, but no
                engagement is started when the lead is converted.
              </Callout>
            ) : null}

            <div className="flex flex-wrap gap-2">
              <SaveButton label={type.label} />
              <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
                Discard
                <span className="sr-only">: {type.label}</span>
              </Button>
            </div>
          </div>
        </form>
      ) : null}
    </li>
  )
}
