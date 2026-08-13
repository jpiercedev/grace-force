'use client'

import { useActionState } from 'react'
import {
  FormError,
  SubmitButton,
  useCloseOnSuccess,
} from '@/components/domain/contact-form-controls'
import {
  CAPABILITY_CONFIDENCE_LABELS,
  CAPABILITY_CONFIDENCES,
  CAPABILITY_LEVELS,
  CAPABILITY_LEVEL_LABELS,
  CONTACT_METHODS,
  CONTACT_METHOD_LABELS,
} from '@/components/domain/development-badges'
import { Button } from '@/components/ui/button'
import { Dialog, useDialog } from '@/components/ui/dialog'
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/form'
import { SectionHeading } from '@/components/ui/tabs'
import { formatCurrency, formatDate } from '@/lib/utils'
import type { ContactActionState } from '@/lib/validation/contact'
import type { ContactCapabilityRow, ContactRow } from '@/types/database'

/**
 * Two quiet panels on the Overview tab: how they want to be contacted, and
 * what they might be capable of giving.
 *
 * Both are read-mostly. They are rendered as sentences rather than forms, and
 * the form only appears when someone chooses to change something — which is
 * what keeps the overview readable instead of looking like a settings screen.
 */

function Line({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[6rem_minmax(0,1fr)] gap-2.5 py-1.5">
      <dt className="pt-px text-xs text-slate-500">{label}</dt>
      <dd className="break-words text-[13px] text-slate-800">{value}</dd>
    </div>
  )
}

export function DonorPreferences({
  contact,
  canEdit,
  action,
}: {
  contact: ContactRow
  canEdit: boolean
  action: (state: ContactActionState, formData: FormData) => Promise<ContactActionState>
}) {
  const edit = useDialog()
  const [state, formAction] = useActionState<ContactActionState, FormData>(action, {})
  useCloseOnSuccess(state, edit.close)

  const rules = [
    contact.do_not_contact && 'Do not contact',
    contact.do_not_call && 'Do not call',
    contact.do_not_email && 'Do not email',
    contact.do_not_text && 'Do not text',
    contact.do_not_mail && 'Do not send post',
  ].filter(Boolean) as string[]

  return (
    <section className="space-y-3">
      <SectionHeading
        title="How to reach them"
        action={
          canEdit ? (
            <Button ref={edit.triggerRef} type="button" variant="ghost" size="sm" onClick={edit.openDialog}>
              Change
            </Button>
          ) : null
        }
      />

      <dl className="divide-y divide-slate-100 border-t border-slate-200">
        <Line
          label="Prefers"
          value={
            contact.preferred_contact_method ? (
              CONTACT_METHOD_LABELS[contact.preferred_contact_method]
            ) : (
              <span className="text-slate-500">No preference recorded</span>
            )
          }
        />
        {contact.preferred_phone ? <Line label="Phone" value={contact.preferred_phone} /> : null}
        {contact.preferred_email ? <Line label="Email" value={contact.preferred_email} /> : null}
        {contact.best_time_to_contact ? (
          <Line label="Best time" value={contact.best_time_to_contact} />
        ) : null}
        {rules.length > 0 ? (
          <Line
            label="Rules"
            value={<span className="font-medium text-red-700">{rules.join(' · ')}</span>}
          />
        ) : null}
        {contact.contact_preference_notes ? (
          <Line
            label="Notes"
            value={
              <span className="whitespace-pre-wrap leading-relaxed">
                {contact.contact_preference_notes}
              </span>
            }
          />
        ) : null}
      </dl>

      <Dialog
        controller={edit}
        title="How to reach them"
        description="These show next to the call, text and email buttons at the top of the record."
        formAction={formAction}
        wide
        footer={
          <>
            <SubmitButton>Save</SubmitButton>
            <Button type="button" variant="ghost" onClick={edit.close}>
              Cancel
            </Button>
          </>
        }
      >
        <div className="space-y-5">
          <input type="hidden" name="contact_id" value={contact.id} />
          <FormError state={state} />

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Preferred way to reach them">
              {(props) => (
                <Select
                  {...props}
                  name="preferred_contact_method"
                  defaultValue={contact.preferred_contact_method ?? ''}
                >
                  <option value="">No preference</option>
                  {CONTACT_METHODS.map((method) => (
                    <option key={method} value={method}>
                      {CONTACT_METHOD_LABELS[method]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            <Field label="Best time to contact" hint="Plain words are fine.">
              {(props) => (
                <Input
                  {...props}
                  name="best_time_to_contact"
                  defaultValue={contact.best_time_to_contact ?? ''}
                  maxLength={120}
                  placeholder="Weekday mornings"
                />
              )}
            </Field>

            <Field label="Preferred phone" hint="Include any instructions.">
              {(props) => (
                <Input
                  {...props}
                  name="preferred_phone"
                  defaultValue={contact.preferred_phone ?? ''}
                  maxLength={80}
                  placeholder={contact.mobile_phone ?? contact.phone ?? 'Mobile, after 10am'}
                />
              )}
            </Field>

            <Field label="Preferred email">
              {(props) => (
                <Input
                  {...props}
                  name="preferred_email"
                  type="email"
                  defaultValue={contact.preferred_email ?? ''}
                  maxLength={254}
                  placeholder={contact.email ?? 'name@example.org'}
                />
              )}
            </Field>
          </div>

          <fieldset className="space-y-3 rounded-xl bg-slate-50 p-4">
            <legend className="text-sm font-semibold text-slate-900">Please do not…</legend>
            <Checkbox
              name="do_not_contact"
              defaultChecked={contact.do_not_contact}
              label="Contact them at all"
              hint="Blocks every channel and shows a warning on the record."
            />
            <Checkbox name="do_not_call" defaultChecked={contact.do_not_call} label="Call" />
            <Checkbox name="do_not_text" defaultChecked={contact.do_not_text} label="Text" />
            <Checkbox name="do_not_email" defaultChecked={contact.do_not_email} label="Email" />
            <Checkbox name="do_not_mail" defaultChecked={contact.do_not_mail} label="Send post" />
          </fieldset>

          <Field label="Anything else worth knowing?">
            {(props) => (
              <Textarea
                {...props}
                name="contact_preference_notes"
                rows={3}
                maxLength={1000}
                defaultValue={contact.contact_preference_notes ?? ''}
                placeholder="Ask for Ginny — the office line goes to reception."
              />
            )}
          </Field>
        </div>
      </Dialog>
    </section>
  )
}

/**
 * Capability, treated with the restraint the brief asked for: "Do not make
 * sensitive information visually loud."
 *
 * No large figure, no colour, no chart. A level, a range in small type, when
 * it was last looked at and where the number came from — because an estimate
 * whose provenance and age are invisible is worse than no estimate.
 *
 * Rendered only for viewers who hold the giving capability; RLS refuses the
 * row regardless, so absence here matches absence there.
 */
export function DonorCapability({
  contactId,
  capability,
  canEdit,
  action,
}: {
  contactId: string
  capability: ContactCapabilityRow | null
  canEdit: boolean
  action: (state: ContactActionState, formData: FormData) => Promise<ContactActionState>
}) {
  const edit = useDialog()
  const [state, formAction] = useActionState<ContactActionState, FormData>(action, {})
  useCloseOnSuccess(state, edit.close)

  const assessed = capability !== null && capability.level !== 'unrated'

  return (
    <section className="space-y-3">
      <SectionHeading
        title="Giving capability"
        action={
          canEdit ? (
            <Button ref={edit.triggerRef} type="button" variant="ghost" size="sm" onClick={edit.openDialog}>
              {assessed ? 'Update' : 'Record'}
            </Button>
          ) : null
        }
      />

      {!assessed ? (
        <p className="text-sm leading-relaxed text-slate-600">
          Not assessed. This is a strategy note for planning conversations — not a judgement about
          anyone.
        </p>
      ) : (
        <dl className="divide-y divide-slate-100 border-t border-slate-200">
          <Line label="Level" value={CAPABILITY_LEVEL_LABELS[capability!.level]} />
          {capability!.range_low_cents !== null || capability!.range_high_cents !== null ? (
            <Line
              label="Range"
              value={
                <span className="tabular-nums">
                  {formatCurrency(capability!.range_low_cents ?? 0)}
                  {capability!.range_high_cents !== null
                    ? ` – ${formatCurrency(capability!.range_high_cents)}`
                    : ' and above'}
                </span>
              }
            />
          ) : null}
          {capability!.confidence ? (
            <Line
              label="Confidence"
              value={CAPABILITY_CONFIDENCE_LABELS[capability!.confidence]}
            />
          ) : null}
          {capability!.source ? <Line label="Based on" value={capability!.source} /> : null}
          {capability!.reviewed_on ? (
            <Line label="Reviewed" value={formatDate(capability!.reviewed_on)} />
          ) : null}
          {capability!.notes ? (
            <Line
              label="Notes"
              value={<span className="whitespace-pre-wrap leading-relaxed">{capability!.notes}</span>}
            />
          ) : null}
        </dl>
      )}

      <Dialog
        controller={edit}
        title="Giving capability"
        description="An estimate that helps plan a conversation. It is not financial underwriting, and it is only visible to people who can see giving."
        formAction={formAction}
        wide
        footer={
          <>
            <SubmitButton>Save</SubmitButton>
            <Button type="button" variant="ghost" onClick={edit.close}>
              Cancel
            </Button>
          </>
        }
      >
        <div className="space-y-5">
          <input type="hidden" name="contact_id" value={contactId} />
          <FormError state={state} />

          <Field label="Level" error={state.fieldErrors?.level}>
            {(props) => (
              <Select {...props} name="level" defaultValue={capability?.level ?? 'unrated'}>
                {CAPABILITY_LEVELS.map((level) => (
                  <option key={level} value={level}>
                    {CAPABILITY_LEVEL_LABELS[level]}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Range from" hint="Optional." error={state.fieldErrors?.range_low_cents}>
              {(props) => (
                <Input
                  {...props}
                  name="range_low_cents"
                  inputMode="decimal"
                  defaultValue={
                    capability?.range_low_cents != null
                      ? (capability.range_low_cents / 100).toString()
                      : ''
                  }
                  placeholder="10,000"
                />
              )}
            </Field>
            <Field label="Range to" error={state.fieldErrors?.range_high_cents}>
              {(props) => (
                <Input
                  {...props}
                  name="range_high_cents"
                  inputMode="decimal"
                  defaultValue={
                    capability?.range_high_cents != null
                      ? (capability.range_high_cents / 100).toString()
                      : ''
                  }
                  placeholder="50,000"
                />
              )}
            </Field>

            <Field label="How confident are we?">
              {(props) => (
                <Select {...props} name="confidence" defaultValue={capability?.confidence ?? ''}>
                  <option value="">Not stated</option>
                  {CAPABILITY_CONFIDENCES.map((confidence) => (
                    <option key={confidence} value={confidence}>
                      {CAPABILITY_CONFIDENCE_LABELS[confidence]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            <Field label="Last reviewed" hint="Defaults to today." error={state.fieldErrors?.reviewed_on}>
              {(props) => (
                <Input
                  {...props}
                  type="date"
                  name="reviewed_on"
                  defaultValue={capability?.reviewed_on ?? ''}
                />
              )}
            </Field>
          </div>

          <Field label="Where does this come from?" hint="So the next person knows how much to trust it.">
            {(props) => (
              <Input
                {...props}
                name="source"
                maxLength={200}
                defaultValue={capability?.source ?? ''}
                placeholder="She mentioned the sale of the farm"
              />
            )}
          </Field>

          <Field label="Notes">
            {(props) => (
              <Textarea
                {...props}
                name="notes"
                rows={3}
                maxLength={2000}
                defaultValue={capability?.notes ?? ''}
              />
            )}
          </Field>
        </div>
      </Dialog>
    </section>
  )
}
