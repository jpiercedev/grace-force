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
import { Checkbox, Field, Fieldset, Input, Select, Textarea } from '@/components/ui/form'
import type { TeamMember } from '@/lib/queries/contacts'
import {
  CONTACT_SOURCES,
  CONTACT_STATUSES,
  LIFECYCLE_STAGES,
  type ContactActionState,
} from '@/lib/validation/contact'
import type { ContactRow } from '@/types/database'

/**
 * Section legends speak in the serif display voice — this form is about a
 * person, and the chapter headings should say so. Styled from here via
 * arbitrary variants because the `Fieldset` primitive stays shared.
 */
const SECTION =
  '[&>legend]:font-display [&>legend]:text-lg [&>legend]:font-semibold [&>legend]:tracking-tight'

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

  return (
    <form action={formAction} className="space-y-6" noValidate>
      {contact ? <input type="hidden" name="id" value={contact.id} /> : null}

      <FormError state={state} />

      <Fieldset legend="Name" description="Who they are, and what they actually go by." className={SECTION}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="First name" error={errors.first_name}>
            {(props) => (
              <Input
                {...props}
                name="first_name"
                autoComplete="given-name"
                defaultValue={contact?.first_name ?? ''}
                invalid={!!errors.first_name}
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
        </div>
      </Fieldset>

      {/* Hairlines between the eight sections keep the long form scannable;
          they sit on <hr>s because a border on the fieldset itself would pull
          the legend down onto the border line. */}
      <hr className="border-slate-200" />

      <Fieldset
        legend="How to reach them"
        description="Channels for staying in touch. Email and phone appear on the contact card."
        className={SECTION}
      >
        <div className="grid gap-4 sm:grid-cols-2">
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
          <Field label="Secondary email" error={errors.secondary_email}>
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
        </div>
      </Fieldset>

      <hr className="border-slate-200" />

      <Fieldset
        legend="Address"
        description="For mailings, visits and year-end letters."
        className={SECTION}
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
      </Fieldset>

      <hr className="border-slate-200" />

      <Fieldset
        legend="Organisation"
        description="Their workplace or ministry affiliation, if it matters to the relationship."
        className={SECTION}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Organisation" error={errors.organization_name}>
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
          <Field label="Job title" error={errors.job_title}>
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
        </div>
      </Fieldset>

      <hr className="border-slate-200" />

      <Fieldset
        legend="Relationship"
        description="Engagements — donor, volunteer, prayer partner — are added on the contact record itself."
        className={SECTION}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Lifecycle stage" error={errors.lifecycle_stage}>
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
          <Field label="Owner" hint="The staff member responsible for this relationship.">
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
          <Field label="Source" error={errors.source}>
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
          <Field
            label="Source detail"
            hint="Which event, who referred them, which form."
            error={errors.source_detail}
            className="sm:col-span-2"
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
          <Field
            label="Tags"
            hint="Separate with commas, e.g. spanish-speaking, board member."
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
      </Fieldset>

      <hr className="border-slate-200" />

      <Fieldset
        legend="Communication preferences"
        description="Hard limits they have asked for. These override every list and campaign."
        className={SECTION}
      >
        <div className="space-y-3">
          <Checkbox
            name="do_not_contact"
            label="Do not contact"
            hint="They have asked not to be approached at all."
            defaultChecked={contact?.do_not_contact ?? false}
          />
          <Checkbox
            name="do_not_email"
            label="Do not email"
            hint="Excluded from Mailchimp audiences and email sends."
            defaultChecked={contact?.do_not_email ?? false}
          />
        </div>
      </Fieldset>

      <hr className="border-slate-200" />

      <Fieldset
        legend="Notes"
        description="Context the whole team should carry into the next conversation."
        className={SECTION}
      >
        <Field label="Internal notes" error={errors.notes}>
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
      </Fieldset>

      <div className="flex flex-wrap items-center gap-3 border-t border-slate-200 pt-5">
        <SubmitButton pendingLabel="Saving…">{submitLabel}</SubmitButton>
        <Link href={cancelHref} className={buttonClasses('secondary', 'md')}>
          Cancel
        </Link>
      </div>
    </form>
  )
}
