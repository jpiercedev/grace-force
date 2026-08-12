'use client'

import { useActionState } from 'react'
import {
  FormError,
  SubmitButton,
  useCloseOnSuccess,
} from '@/components/domain/contact-form-controls'
import { Button } from '@/components/ui/button'
import { Dialog, useDialog } from '@/components/ui/dialog'
import { Field, Select, Textarea } from '@/components/ui/form'
import { SectionHeading } from '@/components/ui/tabs'
import type { ContactInterest } from '@/lib/queries/relationships'
import type { ContactActionState } from '@/lib/validation/contact'
import type { InterestAreaRow } from '@/types/database'

/**
 * What they care about — and, crucially, *why*.
 *
 * The brief: "This information should feel relational, not like tagging
 * someone in a marketing database. Avoid showing dozens of tags." So this is
 * not a chip cloud. Each interest is a line: the area in the brand voice, and
 * underneath it the sentence someone wrote after the conversation where it
 * came up. That note is what makes it a relationship rather than a label.
 */
export function DonorInterests({
  contactId,
  interests,
  areas,
  canEdit,
  addAction,
  removeAction,
}: {
  contactId: string
  interests: ContactInterest[]
  areas: InterestAreaRow[]
  canEdit: boolean
  addAction: (state: ContactActionState, formData: FormData) => Promise<ContactActionState>
  removeAction: (state: ContactActionState, formData: FormData) => Promise<ContactActionState>
}) {
  const add = useDialog()
  const [addState, addFormAction] = useActionState<ContactActionState, FormData>(addAction, {})
  const [removeState, removeFormAction] = useActionState<ContactActionState, FormData>(
    removeAction,
    {},
  )
  useCloseOnSuccess(addState, add.close)

  const taken = new Set(interests.map((interest) => interest.areaId))
  const available = areas.filter((area) => !taken.has(area.id))

  return (
    <section className="space-y-4">
      <SectionHeading
        title="Interests &amp; goals"
        description="What they have told us matters to them."
        action={
          canEdit && available.length > 0 ? (
            <Button ref={add.triggerRef} type="button" variant="secondary" size="sm" onClick={add.openDialog}>
              Add interest
            </Button>
          ) : null
        }
      />

      <FormError state={removeState} />

      {interests.length === 0 ? (
        <p className="text-sm leading-relaxed text-slate-600">
          Nothing recorded yet. Next time they mention what they care about, note it here — it is
          what makes the next conversation the right one.
        </p>
      ) : (
        <ul className="divide-y divide-slate-200 border-t border-slate-200">
          {interests.map((interest) => (
            <li key={interest.id} className="flex items-start gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="text-[15px] font-medium text-slate-900">{interest.label}</p>
                {interest.note ? (
                  <p className="mt-0.5 whitespace-pre-wrap text-sm leading-relaxed text-slate-600">
                    {interest.note}
                  </p>
                ) : null}
              </div>
              {canEdit ? (
                <form action={removeFormAction} className="shrink-0">
                  <input type="hidden" name="contact_id" value={contactId} />
                  <input type="hidden" name="interest_id" value={interest.id} />
                  <SubmitButton variant="ghost" size="sm" pendingLabel="Removing…">
                    Remove
                  </SubmitButton>
                </form>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <Dialog
        controller={add}
        title="What do they care about?"
        formAction={addFormAction}
        footer={
          <>
            <SubmitButton>Save</SubmitButton>
            <Button type="button" variant="ghost" onClick={add.close}>
              Cancel
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <input type="hidden" name="contact_id" value={contactId} />
          <FormError state={addState} />

          <Field label="Interest" error={addState.fieldErrors?.interest_area_id}>
            {(props) => (
              <Select {...props} name="interest_area_id" defaultValue={available[0]?.id ?? ''}>
                {available.map((area) => (
                  <option key={area.id} value={area.id}>
                    {area.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field
            label="In their words"
            hint="What did they actually say? This is the part worth reading later."
            error={addState.fieldErrors?.note}
          >
            {(props) => (
              <Textarea
                {...props}
                name="note"
                rows={4}
                maxLength={500}
                placeholder="Wants the Life Centre finished before her grandchildren are grown."
              />
            )}
          </Field>
        </div>
      </Dialog>
    </section>
  )
}
