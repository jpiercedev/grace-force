'use client'

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
import { Avatar, Badge, Card, CardBody, PageHeader } from '@/components/ui/display'
import { Field, Select } from '@/components/ui/form'
import type { TeamMember } from '@/lib/queries/contacts'
import type { ContactActionState } from '@/lib/validation/contact'
import type { ContactRow } from '@/types/database'

/**
 * The contact detail header: who this is, who owns them, and the four things
 * staff most often want to do next.
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

  return (
    <div className="space-y-4">
      <PageHeader
        title={name}
        description={
          <span className="block space-y-2">
            {subtitle ? <span className="block">{subtitle}</span> : null}
            <span className="flex flex-wrap gap-1.5">
              <LifecycleStageBadge stage={contact.lifecycle_stage} />
              <ContactStatusBadge status={contact.status} />
              {contact.do_not_contact ? <Badge tone="red">Do not contact</Badge> : null}
              {contact.do_not_email ? <Badge tone="amber">Do not email</Badge> : null}
              {contact.tags.map((tag) => (
                <Badge key={tag} tone="zinc">
                  {tag}
                </Badge>
              ))}
            </span>
          </span>
        }
        action={
          canEdit ? (
            <>
              <a href="#log-activity" className={buttonClasses('primary', 'md')}>
                Log activity
              </a>
              <a href="#add-follow-up" className={buttonClasses('secondary', 'md')}>
                Add follow-up
              </a>
              <a href="#add-engagement" className={buttonClasses('secondary', 'md')}>
                Add engagement
              </a>
              <LinkButton href={`/contacts/${contact.id}/edit`} variant="secondary">
                Edit
              </LinkButton>
            </>
          ) : null
        }
      />

      <Card>
        <CardBody className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2.5">
              {owner ? <Avatar name={owner.name} size="sm" /> : null}
              <div className="min-w-0">
                <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Owner</p>
                <p className="truncate text-sm text-slate-900">
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
              className="space-y-3 rounded-md border border-slate-200 bg-slate-50 p-3"
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
              className="space-y-3 rounded-md border border-red-200 bg-red-50 p-3"
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
        </CardBody>
      </Card>
    </div>
  )
}
