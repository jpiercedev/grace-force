'use client'

import {
  CalendarClock,
  Circle,
  Coffee,
  Mail,
  MessageSquare,
  PhoneIncoming,
  PhoneMissed,
  PhoneOutgoing,
  StickyNote,
  Users,
  type LucideIcon,
} from 'lucide-react'
import { useActionState, useEffect, useState } from 'react'
import {
  FormError,
  LocalDateTimeInput,
  SubmitButton,
  TimezoneOffsetField,
  useCloseOnSuccess,
} from '@/components/domain/contact-form-controls'
import { Button, buttonClasses } from '@/components/ui/button'
import { Dialog, useDialog } from '@/components/ui/dialog'
import { Disclosure } from '@/components/ui/disclosure'
import { Field, Input, Select, Textarea } from '@/components/ui/form'
import { INTERACTION_KINDS, OUTCOME_SUGGESTIONS, findInteractionKind } from '@/lib/interactions'
import { cn } from '@/lib/utils'
import type { ContactActionState } from '@/lib/validation/contact'
import type { ProposalStatus } from '@/types/database'

const ICONS: Record<string, LucideIcon> = {
  PhoneIncoming,
  PhoneOutgoing,
  Mail,
  MessageSquare,
  Users,
  Coffee,
  PhoneMissed,
  StickyNote,
  Circle,
}

/**
 * The activity strip above the timeline: one small button per common thing to
 * record, each opening the same dialog already set to the right choice. A
 * follow-up is a different object with its own form, so that one is a link.
 */
const QUICK_ACTIONS: ReadonlyArray<{ label: string; kind: string; icon: string }> = [
  { label: 'Note', kind: 'note', icon: 'StickyNote' },
  { label: 'Call', kind: 'call_out', icon: 'PhoneOutgoing' },
  { label: 'Email', kind: 'email', icon: 'Mail' },
  { label: 'Meeting', kind: 'meeting', icon: 'Users' },
]

/**
 * "Open donor → Log interaction → what happened → a note → save."
 *
 * The brief's target workflow, built literally. Three things do the work:
 *
 * 1. **Plain language, not a taxonomy.** Nine tiles say what happened in the
 *    words a person would use. The `(type, direction)` pair the timeline
 *    stores is derived from the choice — nobody classifies the direction of a
 *    phone call before writing down what was said.
 * 2. **One required field.** The note. Everything else — when, outcome,
 *    related proposal — has a sensible default or is optional.
 * 3. **The follow-up lives here.** "What needs to happen next" is the thought
 *    you have while writing the note, not one you want to navigate for, so
 *    setting a date creates the follow-up as part of the same save.
 */
export function LogInteractionDialog({
  contactId,
  contactName,
  proposals,
  action,
  variant = 'primary',
  size = 'md',
  label = 'Log interaction',
  initialKind,
  icon,
}: {
  contactId: string
  contactName: string
  proposals: ReadonlyArray<{ id: string; title: string; status: ProposalStatus }>
  action: (state: ContactActionState, formData: FormData) => Promise<ContactActionState>
  variant?: 'primary' | 'secondary'
  size?: 'sm' | 'md' | 'lg'
  label?: string
  /** Pre-select a kind (e.g. a "Call" quick action opens onto the call tile). */
  initialKind?: string
  /** Icon name (from this file's map) shown before the trigger label. */
  icon?: string
}) {
  const dialog = useDialog()
  const [state, formAction] = useActionState<ContactActionState, FormData>(action, {})
  const [kindValue, setKindValue] = useState(initialKind ?? INTERACTION_KINDS[0]!.value)
  const [followUp, setFollowUp] = useState(false)
  useCloseOnSuccess(state, dialog.close)

  // A fresh dialog every time: reopening onto the previous answer is how a
  // "call" gets logged as a "meeting".
  useEffect(() => {
    if (dialog.open) {
      setKindValue(initialKind ?? INTERACTION_KINDS[0]!.value)
      setFollowUp(false)
    }
  }, [dialog.open, initialKind])

  const kind = findInteractionKind(kindValue)
  const errors = state.fieldErrors ?? {}
  const TriggerIcon = icon ? ICONS[icon] : undefined

  return (
    <>
      <Button
        ref={dialog.triggerRef}
        type="button"
        variant={variant}
        size={size}
        onClick={dialog.openDialog}
      >
        {TriggerIcon ? (
          <TriggerIcon
            aria-hidden="true"
            className={size === 'sm' ? 'h-3.5 w-3.5' : 'h-4 w-4'}
          />
        ) : null}
        {label}
      </Button>

      <Dialog
        controller={dialog}
        title="Log an interaction"
        description={`Record a conversation with ${contactName}.`}
        wide
        formAction={formAction}
        footer={
          <>
            <SubmitButton size="md">Save</SubmitButton>
            <Button type="button" variant="ghost" size="md" onClick={dialog.close}>
              Cancel
            </Button>
          </>
        }
      >
        <div className="space-y-5">
          <input type="hidden" name="contact_id" value={contactId} />
          <TimezoneOffsetField />
          <FormError state={state} />

          <fieldset>
            <legend className="text-sm font-medium text-slate-700">What happened?</legend>
            {/* Radios rather than a select: nine options is a decision, not a
                list, and tiles make it one glance instead of one dropdown. */}
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {INTERACTION_KINDS.map((option) => {
                const OptionIcon = ICONS[option.icon] ?? Circle
                const selected = option.value === kindValue
                return (
                  <label
                    key={option.value}
                    className={cn(
                      'flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2.5 text-sm transition-colors',
                      selected
                        ? 'border-brand-600 bg-brand-50 font-semibold text-brand-900 ring-1 ring-brand-600'
                        : 'border-slate-200 text-slate-700 hover:bg-slate-50',
                    )}
                  >
                    <input
                      type="radio"
                      name="kind"
                      value={option.value}
                      checked={selected}
                      onChange={() => setKindValue(option.value)}
                      className="sr-only"
                    />
                    <OptionIcon
                      aria-hidden="true"
                      className={cn('h-4 w-4 shrink-0', selected ? 'text-brand-700' : 'text-slate-400')}
                    />
                    {option.label}
                  </label>
                )
              })}
            </div>
            {errors.kind ? (
              <p className="mt-1.5 text-sm font-medium text-red-600">{errors.kind}</p>
            ) : null}
          </fieldset>

          {/* Only email and text genuinely go both ways often enough to be
              worth one more question. */}
          {kind?.asksDirection ? (
            <fieldset className="flex flex-wrap items-center gap-x-5 gap-y-2">
              <legend className="mb-1.5 text-sm font-medium text-slate-700">
                Which way round?
              </legend>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="radio"
                  name="received"
                  value=""
                  defaultChecked
                  className="h-4 w-4 border-slate-400 text-brand-600 focus:ring-brand-500"
                />
                We sent it
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="radio"
                  name="received"
                  value="on"
                  className="h-4 w-4 border-slate-400 text-brand-600 focus:ring-brand-500"
                />
                They sent it
              </label>
            </fieldset>
          ) : null}

          <Field
            label="What was said?"
            hint="One line is plenty. This is what someone reads in six months."
            error={errors.note}
          >
            {(props) => (
              <Textarea {...props} name="note" rows={5} maxLength={4000} invalid={!!errors.note} />
            )}
          </Field>

          <Field
            label="How did it go?"
            hint="Optional."
            error={errors.outcome}
          >
            {(props) => (
              <>
                <Input
                  {...props}
                  name="outcome"
                  list="interaction-outcomes"
                  maxLength={200}
                  placeholder="Left a voicemail"
                  invalid={!!errors.outcome}
                />
                <datalist id="interaction-outcomes">
                  {OUTCOME_SUGGESTIONS.map((suggestion) => (
                    <option key={suggestion} value={suggestion} />
                  ))}
                </datalist>
              </>
            )}
          </Field>

          <div className="rounded-lg border border-slate-200 px-4 py-3.5 sm:px-5">
            <label className="flex items-start gap-2.5">
              <input
                type="checkbox"
                checked={followUp}
                onChange={(event) => setFollowUp(event.target.checked)}
                className="mt-0.5 h-5 w-5 rounded border-slate-400 text-brand-600 focus:ring-brand-500"
              />
              <span>
                <span className="block text-sm font-medium text-slate-900">
                  Something needs to happen next
                </span>
                <span className="block text-sm text-slate-500">
                  Adds a follow-up to your queue.
                </span>
              </span>
            </label>

            {followUp ? (
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <Field label="By when" error={errors.follow_up_on}>
                  {(props) => (
                    <Input
                      {...props}
                      type="date"
                      name="follow_up_on"
                      required
                      invalid={!!errors.follow_up_on}
                    />
                  )}
                </Field>
                <Field label="What, exactly?" error={errors.follow_up_note}>
                  {(props) => (
                    <Input
                      {...props}
                      name="follow_up_note"
                      maxLength={200}
                      placeholder="Send the trust illustration"
                      invalid={!!errors.follow_up_note}
                    />
                  )}
                </Field>
              </div>
            ) : null}
          </div>

          {/* Everything below is correct by default. It is here for the person
              catching up on last week, not the one logging a call now. */}
          <Disclosure label="More detail" summary="Date and time, related proposal">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="When did it happen?"
                hint="Defaults to now."
                error={errors.occurred_at}
              >
                {(props) => (
                  <LocalDateTimeInput
                    {...props}
                    name="occurred_at"
                    invalid={!!errors.occurred_at}
                  />
                )}
              </Field>

              {proposals.length > 0 ? (
                <Field label="About a proposal?" error={errors.proposal_id}>
                  {(props) => (
                    <Select {...props} name="proposal_id" defaultValue="">
                      <option value="">Not about a proposal</option>
                      {proposals.map((proposal) => (
                        <option key={proposal.id} value={proposal.id}>
                          {proposal.title}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              ) : null}
            </div>
          </Disclosure>
        </div>
      </Dialog>
    </>
  )
}

/**
 * Note · Call · Email · Meeting · Follow-up, in one row above the activity
 * stream. Each button opens the full logging dialog with the choice already
 * made — logging a call should feel like a small action, not a form to fill
 * out. The follow-up is its own object with its own page, so it is a link.
 */
export function QuickActivityBar({
  contactId,
  contactName,
  proposals,
  action,
}: {
  contactId: string
  contactName: string
  proposals: ReadonlyArray<{ id: string; title: string; status: ProposalStatus }>
  action: (state: ContactActionState, formData: FormData) => Promise<ContactActionState>
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {QUICK_ACTIONS.map((quick) => (
        <LogInteractionDialog
          key={quick.kind}
          contactId={contactId}
          contactName={contactName}
          proposals={proposals}
          action={action}
          variant="secondary"
          size="sm"
          label={quick.label}
          icon={quick.icon}
          initialKind={quick.kind}
        />
      ))}
      <a href={`/follow-ups/new?contact=${contactId}`} className={buttonClasses('secondary', 'sm')}>
        <CalendarClock aria-hidden="true" className="h-3.5 w-3.5" />
        Follow-up
      </a>
    </div>
  )
}
