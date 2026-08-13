'use client'

import { Mail, Phone } from 'lucide-react'
import { useActionState } from 'react'
import {
  ContactStatusBadge,
  LifecycleStageBadge,
} from '@/components/domain/contact-badges'
import {
  FormError,
  SubmitButton,
  ownerOptions,
  useCloseOnSuccess,
  useDisclosure,
} from '@/components/domain/contact-form-controls'
import { Button, LinkButton, buttonClasses } from '@/components/ui/button'
import { Avatar, Badge, Card } from '@/components/ui/display'
import { Field, Select } from '@/components/ui/form'
import type { TeamMember } from '@/lib/queries/contacts'
import type { ContactActionState } from '@/lib/validation/contact'
import type { ContactRow } from '@/types/database'

/**
 * The identity band: one composed zone that says who this is — face, bold
 * name, standing, how to reach them, who owns the relationship — with the
 * four things staff most often want to do next on its shoulder.
 *
 * The quick actions are plain in-page anchors rather than buttons, so they work
 * before hydration and can be linked to from elsewhere. Each panel they point
 * at opens itself when the hash arrives — see `useDisclosure`.
 */
export function ContactHeader({
  contact,
  name,
  owner,
  team,
  canEdit,
  canArchive,
  reassignAction,
  archiveAction,
}: {
  contact: ContactRow
  name: string
  owner: TeamMember | null
  team: TeamMember[]
  canEdit: boolean
  canArchive: boolean
  reassignAction: (state: ContactActionState, formData: FormData) => Promise<ContactActionState>
  archiveAction: (state: ContactActionState, formData: FormData) => Promise<ContactActionState>
}) {
  const reassign = useDisclosure()
  const archive = useDisclosure()
  const [reassignState, reassignFormAction] = useActionState<ContactActionState, FormData>(
    reassignAction,
    {},
  )
  const [archiveState, archiveFormAction] = useActionState<ContactActionState, FormData>(
    archiveAction,
    {},
  )
  useCloseOnSuccess(reassignState, reassign.close)

  const owners = ownerOptions(team, contact.owner_id)
  const subtitle = [contact.organization_name, contact.job_title].filter(Boolean).join(' · ')
  const phone = contact.phone ?? contact.mobile_phone

  return (
    <header>
      <Card>
        <div className="px-5 pb-5 pt-6 sm:px-6">
          <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex min-w-0 items-start gap-4 sm:gap-5">
              <Avatar name={name} size="xl" className="mt-1" />
              <div className="min-w-0">
                <p className="text-xs font-medium text-slate-500">
                  Contact
                </p>
                <h1 className="mt-0.5 break-words text-xl font-bold leading-tight text-slate-900 sm:text-2xl">
                  {name}
                </h1>
                {subtitle ? <p className="mt-1 text-[15px] text-slate-600">{subtitle}</p> : null}

                <div className="mt-3 flex flex-wrap items-center gap-1.5">
                  <LifecycleStageBadge stage={contact.lifecycle_stage} />
                  {/* An active record is the normal case; showing it next to the
                      lifecycle badge produced a duplicate "Active Active" pair.
                      Only the exceptional statuses earn a badge — same rule as
                      the contact table. */}
                  {contact.status !== 'active' ? (
                    <ContactStatusBadge status={contact.status} />
                  ) : null}
                  {contact.do_not_contact ? <Badge tone="red">Do not contact</Badge> : null}
                  {contact.do_not_email ? <Badge tone="amber">Do not email</Badge> : null}
                  {contact.tags.map((tag) => (
                    <Badge key={tag} tone="zinc">
                      {tag}
                    </Badge>
                  ))}
                </div>

                {contact.email || phone ? (
                  <div className="mt-3.5 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm">
                    {contact.email ? (
                      <a
                        href={`mailto:${contact.email}`}
                        title={contact.email}
                        className="inline-flex min-w-0 items-center gap-1.5 text-slate-600 hover:text-brand-700 hover:underline"
                      >
                        <Mail aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                        <span className="truncate">{contact.email}</span>
                      </a>
                    ) : null}
                    {phone ? (
                      <a
                        href={`tel:${phone}`}
                        className="inline-flex items-center gap-1.5 whitespace-nowrap text-slate-600 hover:text-brand-700 hover:underline"
                      >
                        <Phone aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-slate-400" />
                        {phone}
                      </a>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>

            {canEdit ? (
              <div className="flex flex-wrap items-center gap-2 lg:shrink-0 lg:justify-end">
                <a href="#log-activity" className={buttonClasses('primary', 'md')}>
                  Log activity
                </a>
                <a href="#add-follow-up" className={buttonClasses('secondary', 'md')}>
                  Add follow-up
                </a>
                <a href="#add-engagement" className={buttonClasses('secondary', 'md')}>
                  Add engagement
                </a>
                <LinkButton href={`/contacts/${contact.id}/edit`} variant="ghost">
                  Edit
                </LinkButton>
              </div>
            ) : null}
          </div>
        </div>

        {/* The stewardship strip: who holds this relationship, and the two
            administrative moves that change the record itself. */}
        <div className="space-y-3 rounded-b-xl border-t border-slate-200 bg-slate-100/50 px-5 py-3 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2.5">
              {owner ? <Avatar name={owner.name} size="sm" /> : null}
              <div className="min-w-0">
                <p className="text-xs font-medium text-slate-500">
                  Owner
                </p>
                <p className="truncate text-sm font-medium text-slate-800">
                  {owner ? owner.name : 'Unassigned'}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {canEdit ? (
                <Button
                  ref={reassign.triggerRef}
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={reassign.toggle}
                  aria-expanded={reassign.open}
                  aria-controls={reassign.open ? 'reassign-owner-panel' : undefined}
                >
                  {reassign.open ? 'Cancel' : 'Reassign'}
                </Button>
              ) : null}
              {canArchive ? (
                <Button
                  ref={archive.triggerRef}
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={archive.toggle}
                  aria-expanded={archive.open}
                  aria-controls={archive.open ? 'archive-contact-panel' : undefined}
                >
                  Archive
                </Button>
              ) : null}
            </div>
          </div>

          {reassign.open ? (
            <form
              id="reassign-owner-panel"
              action={reassignFormAction}
              className="space-y-3 rounded-lg bg-white p-4 ring-1 ring-slate-200/70"
              noValidate
            >
              <input type="hidden" name="contact_id" value={contact.id} />
              <FormError state={reassignState} />
              {/* The `assignment_changed` entry is written by a trigger, not here. */}
              <Field
                label="Assign to"
                hint="The change is recorded on the timeline automatically."
                error={reassignState.fieldErrors?.owner_id}
              >
                {(props) => (
                  <Select {...props} name="owner_id" defaultValue={contact.owner_id ?? ''} autoFocus>
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
              <div className="flex flex-wrap gap-2">
                <SubmitButton size="sm">Save owner</SubmitButton>
                <Button type="button" variant="ghost" size="sm" onClick={reassign.close}>
                  Discard
                </Button>
              </div>
            </form>
          ) : null}

          {archive.open ? (
            <form
              id="archive-contact-panel"
              action={archiveFormAction}
              className="space-y-3 rounded-lg bg-red-50 p-4 ring-1 ring-red-200"
              noValidate
            >
              <input type="hidden" name="contact_id" value={contact.id} />
              <FormError state={archiveState} />
              <p className="text-sm text-red-900">
                Archive {name}? They disappear from lists and search. Their timeline, gifts and
                history are kept, and an administrator can restore the record.
              </p>
              <div className="flex flex-wrap gap-2">
                <SubmitButton variant="danger" size="sm" pendingLabel="Archiving…">
                  Yes, archive
                </SubmitButton>
                <Button type="button" variant="ghost" size="sm" onClick={archive.close}>
                  Keep it
                </Button>
              </div>
            </form>
          ) : null}
        </div>
      </Card>
    </header>
  )
}
