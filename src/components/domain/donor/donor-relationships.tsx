'use client'

import Link from 'next/link'
import { useActionState, useState } from 'react'
import {
  FormError,
  SubmitButton,
  useCloseOnSuccess,
} from '@/components/domain/contact-form-controls'
import { PersonPicker } from '@/components/domain/person-picker'
import { Button } from '@/components/ui/button'
import { Dialog, useDialog } from '@/components/ui/dialog'
import { Avatar, EmptyState } from '@/components/ui/display'
import { Field, Input, Select } from '@/components/ui/form'
import { SectionHeading } from '@/components/ui/tabs'
import type { RelatedPerson } from '@/lib/queries/relationships'
import { RELATIONSHIP_CHOICES } from '@/lib/relationships'
import type { ContactActionState } from '@/lib/validation/contact'

/**
 * Related people, as a short list of names and one word each.
 *
 * The brief was explicit that this must not become a graph visualisation or a
 * relationship-management screen. So it is a list: a face, a name that links
 * to their record, the word that describes the connection, and the sentence
 * someone wrote about it.
 *
 * Both directions come out of one stored row — the label is already resolved
 * for this donor by `getRelatedPeople`, so nothing here reasons about
 * direction.
 */
export function DonorRelationships({
  contactId,
  contactName,
  people,
  canEdit,
  addAction,
  removeAction,
}: {
  contactId: string
  contactName: string
  people: RelatedPerson[]
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
  const [kind, setKind] = useState(RELATIONSHIP_CHOICES[0]!.value)
  useCloseOnSuccess(addState, add.close)

  const groups = Array.from(new Set(RELATIONSHIP_CHOICES.map((choice) => choice.group)))

  return (
    <section className="space-y-4">
      <SectionHeading
        title="Relationships"
        description="Family, friends, advisers and the people who introduced them."
        action={
          canEdit ? (
            <Button ref={add.triggerRef} type="button" variant="secondary" onClick={add.openDialog}>
              Add relationship
            </Button>
          ) : null
        }
      />

      <FormError state={removeState} />

      {people.length === 0 ? (
        <EmptyState
          title="No one linked yet"
          description="Recording a spouse, a family member or whoever introduced you keeps the whole picture in one place."
        />
      ) : (
        <ul className="divide-y divide-slate-200 border-t border-slate-200">
          {people.map((person) => (
            <li key={person.id} className="flex items-center gap-3 py-3">
              <Avatar name={person.contact.name} size="md" />
              <div className="min-w-0 flex-1">
                <Link
                  href={`/contacts/${person.contact.id}`}
                  className="block truncate text-[15px] font-medium text-slate-900 hover:text-brand-800 hover:underline"
                >
                  {person.contact.name}
                </Link>
                <p className="truncate text-sm text-slate-600">
                  {person.label}
                  {person.note ? ` · ${person.note}` : ''}
                </p>
              </div>
              {canEdit ? (
                <form action={removeFormAction} className="shrink-0">
                  <input type="hidden" name="contact_id" value={contactId} />
                  <input type="hidden" name="relationship_id" value={person.id} />
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
        title="Link someone to this person"
        description={`Who should be connected to ${contactName}?`}
        formAction={addFormAction}
        footer={
          <>
            <SubmitButton>Save link</SubmitButton>
            <Button type="button" variant="ghost" onClick={add.close}>
              Cancel
            </Button>
          </>
        }
      >
        <div className="space-y-5">
          <input type="hidden" name="contact_id" value={contactId} />
          <FormError state={addState} />

          <PersonPicker
            name="related_contact_id"
            label="Which person?"
            excludeId={contactId}
            required
            error={addState.fieldErrors?.related_contact_id}
          />

          <Field
            label={`How are they related to ${contactName}?`}
            error={addState.fieldErrors?.kind}
          >
            {(props) => (
              <Select
                {...props}
                name="kind"
                value={kind}
                onChange={(event) => setKind(event.target.value as typeof kind)}
              >
                {groups.map((group) => (
                  <optgroup key={group} label={group}>
                    {RELATIONSHIP_CHOICES.filter((choice) => choice.group === group).map(
                      (choice) => (
                        <option key={choice.value} value={choice.value}>
                          {choice.label}
                        </option>
                      ),
                    )}
                  </optgroup>
                ))}
              </Select>
            )}
          </Field>

          <Field label="Anything worth noting?" hint="Optional." error={addState.fieldErrors?.note}>
            {(props) => (
              <Input {...props} name="note" maxLength={200} placeholder="Met through the Tuesday study" />
            )}
          </Field>
        </div>
      </Dialog>
    </section>
  )
}
