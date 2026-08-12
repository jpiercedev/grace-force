'use client'

import Link from 'next/link'
import { useActionState } from 'react'
import {
  CONTACT_SOURCE_LABELS,
  CONTACT_STATUS_LABELS,
  LIFECYCLE_STAGE_LABELS,
} from '@/components/domain/contact-badges'
import { FormError, SubmitButton, ownerOptions } from '@/components/domain/contact-form-controls'
import { buttonClasses } from '@/components/ui/button'
import { Disclosure } from '@/components/ui/disclosure'
import { Checkbox, Field, Input, Select, Textarea } from '@/components/ui/form'
import type { TeamMember } from '@/lib/queries/contacts'
import {
  CONTACT_SOURCES,
  CONTACT_STATUSES,
  LIFECYCLE_STAGES,
  type ContactActionState,
} from '@/lib/validation/contact'
import type { ContactRow } from '@/types/database'

/**
 * Adding a person.
 *
 * This form used to present twenty-five fields across eight sections, most of
 * which nobody knows at the moment they meet someone. The brief's instruction
 * was to "reward gradual data enrichment rather than demanding complete data
 * entry before a record can exist", so the visible form is now six things:
 * name, email, phone, who looks after them, where they are in the
 * relationship, and how we met.
 *
 * Everything else is behind a disclosure, and every disclosure that already
 * holds data opens itself — collapsing a filled-in address would read as data
 * loss to the person editing it.
 *
 * Collapsed fields still post. `hidden` does not exclude a control from form
 * submission, which is what lets the sections stay closed without silently
 * clearing what is inside them.
 */
export function ContactForm({
  action,
  contact,
  team,
  defaultOwnerId,
  cancelHref,
  submitLabel,
}: {
  action: (state: ContactActionState, formData: FormData) => Promise<ContactActionState>
  contact?: ContactRow | null
  team: TeamMember[]
  defaultOwnerId?: string | null
  cancelHref: string
  submitLabel: string
}) {
  const [state, formAction] = useActionState<ContactActionState, FormData>(action, {})
  const errors = state.fieldErrors ?? {}
  const ownerId = contact?.owner_id ?? defaultOwnerId ?? ''
  const owners = ownerOptions(team, contact?.owner_id ?? null)

  const hasAddress = !!(
    contact?.address_line1 ??
    contact?.address_line2 ??
    contact?.city ??
    contact?.region ??
    contact?.postal_code
  )
  const hasOrganisation = !!(contact?.organization_name ?? contact?.job_title)
  const hasExtras = !!(
    contact?.preferred_name ??
    contact?.secondary_email ??
    contact?.mobile_phone ??
    contact?.birthday ??
    contact?.source_detail ??
    (contact?.tags.length ?? 0) > 0
  )
  const hasRules = !!(contact?.do_not_contact || contact?.do_not_email)

  // A field failing validation inside a closed section would be invisible.
  const anyError = (...names: string[]) => names.some((name) => !!errors[name])

  return (
    <form action={formAction} className="space-y-5" noValidate>
      {contact ? <input type="hidden" name="id" value={contact.id} /> : null}

      <FormError state={state} />

      <div className="space-y-5 rounded-xl bg-white p-5 shadow-card sm:p-6">
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="First name" error={errors.first_name}>
            {(props) => (
              <Input
                {...props}
                name="first_name"
                autoComplete="given-name"
                defaultValue={contact?.first_name ?? ''}
                invalid={!!errors.first_name}
                autoFocus={!contact}
              />
            )}
          </Field>
          <Field label="Last name" error={errors.last_name}>
            {(props) => (
              <Input
                {...props}
                name="last_name"
                autoComplete="family-name"
                defaultValue={contact?.last_name ?? ''}
                invalid={!!errors.last_name}
              />
            )}
          </Field>

          <Field label="Email" error={errors.email}>
            {(props) => (
              <Input
                {...props}
                name="email"
                type="email"
                autoComplete="email"
                defaultValue={contact?.email ?? ''}
                invalid={!!errors.email}
              />
            )}
          </Field>
          <Field label="Phone" error={errors.phone}>
            {(props) => (
              <Input
                {...props}
                name="phone"
                type="tel"
                autoComplete="tel"
                defaultValue={contact?.phone ?? ''}
                invalid={!!errors.phone}
              />
            )}
          </Field>

          <Field
            label="Who looks after them?"
            hint="The staff member who holds this relationship."
          >
            {(props) => (
              <Select {...props} name="owner_id" defaultValue={ownerId}>
                <option value="">Unassigned</option>
                {owners.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                    {member.is_active ? '' : ' (deactivated)'}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field
            label="Where are we with them?"
            hint="This can change as the relationship grows."
            error={errors.lifecycle_stage}
          >
            {(props) => (
              <Select
                {...props}
                name="lifecycle_stage"
                defaultValue={contact?.lifecycle_stage ?? 'prospect'}
              >
                {LIFECYCLE_STAGES.map((stage) => (
                  <option key={stage} value={stage}>
                    {LIFECYCLE_STAGE_LABELS[stage]}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field
            label="How did we meet them?"
            error={errors.source}
            className="sm:col-span-2 sm:max-w-xs"
          >
            {(props) => (
              <Select {...props} name="source" defaultValue={contact?.source ?? 'manual'}>
                {CONTACT_SOURCES.map((source) => (
                  <option key={source} value={source}>
                    {CONTACT_SOURCE_LABELS[source]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>

        <p className="text-sm leading-relaxed text-slate-600">
          That is enough to create the record. Everything below can wait until you know it.
        </p>
      </div>

      <Disclosure
        label="Relationship summary"
        summary="A few sentences about how we know them"
        defaultOpen={!!contact?.notes || anyError('notes')}
      >
        <Field
          label="Summary"
          hint="The context the whole team should carry into the next conversation."
          error={errors.notes}
        >
          {(props) => (
            <Textarea
              {...props}
              name="notes"
              rows={5}
              defaultValue={contact?.notes ?? ''}
              invalid={!!errors.notes}
            />
          )}
        </Field>
      </Disclosure>

      <Disclosure
        label="Address"
        summary="For mailings, visits and year-end letters"
        defaultOpen={hasAddress || anyError('address_line1', 'city', 'region', 'postal_code', 'country')}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Address line 1" error={errors.address_line1} className="sm:col-span-2">
            {(props) => (
              <Input
                {...props}
                name="address_line1"
                autoComplete="address-line1"
                defaultValue={contact?.address_line1 ?? ''}
                invalid={!!errors.address_line1}
              />
            )}
          </Field>
          <Field label="Address line 2" error={errors.address_line2} className="sm:col-span-2">
            {(props) => (
              <Input
                {...props}
                name="address_line2"
                autoComplete="address-line2"
                defaultValue={contact?.address_line2 ?? ''}
                invalid={!!errors.address_line2}
              />
            )}
          </Field>
          <Field label="City" error={errors.city}>
            {(props) => (
              <Input
                {...props}
                name="city"
                autoComplete="address-level2"
                defaultValue={contact?.city ?? ''}
                invalid={!!errors.city}
              />
            )}
          </Field>
          <Field label="State or region" error={errors.region}>
            {(props) => (
              <Input
                {...props}
                name="region"
                autoComplete="address-level1"
                defaultValue={contact?.region ?? ''}
                invalid={!!errors.region}
              />
            )}
          </Field>
          <Field label="Postal code" error={errors.postal_code}>
            {(props) => (
              <Input
                {...props}
                name="postal_code"
                autoComplete="postal-code"
                defaultValue={contact?.postal_code ?? ''}
                invalid={!!errors.postal_code}
              />
            )}
          </Field>
          <Field label="Country" error={errors.country}>
            {(props) => (
              <Input
                {...props}
                name="country"
                autoComplete="country-name"
                defaultValue={contact?.country ?? 'US'}
                invalid={!!errors.country}
              />
            )}
          </Field>
        </div>
      </Disclosure>

      <Disclosure
        label="Work"
        summary="Occupation and employer"
        defaultOpen={hasOrganisation || anyError('organization_name', 'job_title')}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Occupation or job title"
            hint="“Retired physician” is as useful as a formal title."
            error={errors.job_title}
          >
            {(props) => (
              <Input
                {...props}
                name="job_title"
                autoComplete="organization-title"
                defaultValue={contact?.job_title ?? ''}
                invalid={!!errors.job_title}
              />
            )}
          </Field>
          <Field label="Organisation or employer" error={errors.organization_name}>
            {(props) => (
              <Input
                {...props}
                name="organization_name"
                autoComplete="organization"
                defaultValue={contact?.organization_name ?? ''}
                invalid={!!errors.organization_name}
              />
            )}
          </Field>
        </div>
      </Disclosure>

      <Disclosure
        label="Other details"
        summary="Preferred name, second email, mobile, birthday, tags"
        defaultOpen={
          hasExtras ||
          anyError('preferred_name', 'secondary_email', 'mobile_phone', 'birthday', 'tags', 'source_detail', 'status')
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Preferred name"
            hint="What they actually go by, if it differs."
            error={errors.preferred_name}
          >
            {(props) => (
              <Input
                {...props}
                name="preferred_name"
                defaultValue={contact?.preferred_name ?? ''}
                invalid={!!errors.preferred_name}
              />
            )}
          </Field>
          <Field label="Birthday" error={errors.birthday}>
            {(props) => (
              <Input
                {...props}
                name="birthday"
                type="date"
                defaultValue={contact?.birthday ?? ''}
                invalid={!!errors.birthday}
              />
            )}
          </Field>
          <Field label="Second email" error={errors.secondary_email}>
            {(props) => (
              <Input
                {...props}
                name="secondary_email"
                type="email"
                defaultValue={contact?.secondary_email ?? ''}
                invalid={!!errors.secondary_email}
              />
            )}
          </Field>
          <Field label="Mobile phone" error={errors.mobile_phone}>
            {(props) => (
              <Input
                {...props}
                name="mobile_phone"
                type="tel"
                defaultValue={contact?.mobile_phone ?? ''}
                invalid={!!errors.mobile_phone}
              />
            )}
          </Field>
          <Field
            label="How we met — the detail"
            hint="Which event, who referred them, which form."
            error={errors.source_detail}
          >
            {(props) => (
              <Input
                {...props}
                name="source_detail"
                defaultValue={contact?.source_detail ?? ''}
                invalid={!!errors.source_detail}
              />
            )}
          </Field>
          <Field label="Record status" error={errors.status}>
            {(props) => (
              <Select {...props} name="status" defaultValue={contact?.status ?? 'active'}>
                {CONTACT_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {CONTACT_STATUS_LABELS[status]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field
            label="Tags"
            hint="Separate with commas. For labels, not for what they care about — that lives on their record."
            error={errors.tags}
            className="sm:col-span-2"
          >
            {(props) => (
              <Input
                {...props}
                name="tags"
                defaultValue={contact?.tags.join(', ') ?? ''}
                invalid={!!errors.tags}
              />
            )}
          </Field>
        </div>
      </Disclosure>

      <Disclosure
        label="Please do not contact"
        summary="Hard limits they have asked for"
        defaultOpen={hasRules}
      >
        <div className="space-y-3">
          <Checkbox
            name="do_not_contact"
            label="Do not contact at all"
            hint="They have asked not to be approached."
            defaultChecked={contact?.do_not_contact ?? false}
          />
          <Checkbox
            name="do_not_email"
            label="Do not email"
            hint="Excluded from Mailchimp audiences and email sends."
            defaultChecked={contact?.do_not_email ?? false}
          />
          <p className="text-sm text-slate-600">
            Preferred contact method, best time to reach them, and the rest of their preferences
            live on their record under Overview.
          </p>
        </div>
      </Disclosure>

      <div className="flex flex-wrap items-center gap-3 pt-1">
        <SubmitButton size="lg" pendingLabel="Saving…">
          {submitLabel}
        </SubmitButton>
        <Link href={cancelHref} className={buttonClasses('ghost', 'lg')}>
          Cancel
        </Link>
      </div>
    </form>
  )
}
