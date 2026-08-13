'use client'

import { useActionState } from 'react'
import { ContactStatusBadge, LifecycleStageBadge } from '@/components/domain/contact-badges'
import {
  FormError,
  SubmitButton,
  ownerOptions,
  useCloseOnSuccess,
} from '@/components/domain/contact-form-controls'
import { LogInteractionDialog } from '@/components/domain/log-interaction'
import { Button, LinkButton } from '@/components/ui/button'
import { Dialog, useDialog } from '@/components/ui/dialog'
import {
  ActionMenu,
  ActionMenuButton,
  ActionMenuDivider,
  ActionMenuLink,
} from '@/components/ui/menu'
import { Avatar, Badge } from '@/components/ui/display'
import { Field, Select } from '@/components/ui/form'
import type { TeamMember } from '@/lib/queries/contacts'
import type { ContactActionState } from '@/lib/validation/contact'
import type { ContactRow, ProposalStatus } from '@/types/database'

/**
 * The donor header answers, in order: who is this, who holds the
 * relationship, and what am I most likely to do next. How to *reach* them
 * lives in the About rail beside the workspace, where it stays visible
 * while the tabs change.
 *
 * Exactly one primary action — Log interaction — one secondary, and
 * everything else in the overflow menu.
 */
export function DonorHeader({
  contact,
  name,
  owner,
  team,
  proposals,
  canEdit,
  canArchive,
  actions,
}: {
  contact: ContactRow
  name: string
  owner: TeamMember | null
  team: TeamMember[]
  proposals: ReadonlyArray<{ id: string; title: string; status: ProposalStatus }>
  canEdit: boolean
  canArchive: boolean
  actions: {
    logInteraction: (state: ContactActionState, formData: FormData) => Promise<ContactActionState>
    reassign: (state: ContactActionState, formData: FormData) => Promise<ContactActionState>
    archive: (state: ContactActionState, formData: FormData) => Promise<ContactActionState>
  }
}) {
  const reassign = useDialog()
  const archive = useDialog()
  const [reassignState, reassignAction] = useActionState<ContactActionState, FormData>(
    actions.reassign,
    {},
  )
  const [archiveState, archiveAction] = useActionState<ContactActionState, FormData>(
    actions.archive,
    {},
  )
  useCloseOnSuccess(reassignState, reassign.close)

  const owners = ownerOptions(team, contact.owner_id)
  const subtitle = [contact.job_title, contact.organization_name].filter(Boolean).join(' · ')

  return (
    <header className="flex flex-col gap-3 border-b border-slate-200 pb-4 lg:flex-row lg:items-start lg:justify-between">
      <div className="flex min-w-0 items-center gap-3">
        <Avatar name={name} size="xl" className="hidden sm:inline-flex" />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <h1 className="break-words text-xl font-bold leading-tight text-slate-900 sm:text-2xl">
              {name}
            </h1>
            {/* Only the standing that changes how you treat the record. An
                active contact is the normal case and earns no chip. */}
            <LifecycleStageBadge stage={contact.lifecycle_stage} />
            {contact.status !== 'active' ? <ContactStatusBadge status={contact.status} /> : null}
            {contact.do_not_contact ? <Badge tone="red">Do not contact</Badge> : null}
          </div>
          <p className="mt-0.5 text-[13px] text-slate-600">
            {subtitle ? <>{subtitle} · </> : null}
            <span className="text-slate-500">
              {owner ? `Owned by ${owner.name}` : 'Unassigned'}
            </span>
          </p>
        </div>
      </div>

      {canEdit ? (
        <div className="flex flex-wrap items-center gap-2 lg:shrink-0 lg:justify-end">
          <LogInteractionDialog
            contactId={contact.id}
            contactName={name}
            proposals={proposals}
            action={actions.logInteraction}
          />
          <LinkButton href={`/reports/new?contact=${contact.id}`} variant="secondary">
            Call report
          </LinkButton>
          <ActionMenu label={`More actions for ${name}`}>
            <ActionMenuLink href={`/contacts/${contact.id}/edit`}>Edit details</ActionMenuLink>
            <ActionMenuLink href={`/follow-ups/new?contact=${contact.id}`}>
              Add a follow-up
            </ActionMenuLink>
            <ActionMenuLink href={`/proposals/new?contact=${contact.id}`}>
              Start a planned gift
            </ActionMenuLink>
            <ActionMenuDivider />
            <ActionMenuButton onClick={reassign.openDialog}>
              Change who looks after them
            </ActionMenuButton>
            {canArchive ? (
              <ActionMenuButton tone="danger" onClick={archive.openDialog}>
                Archive this person
              </ActionMenuButton>
            ) : null}
          </ActionMenu>
        </div>
      ) : null}

      <Dialog
        controller={reassign}
        title="Who looks after this relationship?"
        formAction={reassignAction}
        footer={
          <>
            <SubmitButton>Save</SubmitButton>
            <Button type="button" variant="ghost" onClick={reassign.close}>
              Cancel
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <input type="hidden" name="contact_id" value={contact.id} />
          <FormError state={reassignState} />
          {/* The `assignment_changed` entry is written by a trigger, not here. */}
          <Field
            label="Assign to"
            hint="The change is recorded on the timeline automatically."
            error={reassignState.fieldErrors?.owner_id}
          >
            {(props) => (
              <Select {...props} name="owner_id" defaultValue={contact.owner_id ?? ''}>
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
        </div>
      </Dialog>

      <Dialog
        controller={archive}
        title={`Archive ${name}?`}
        formAction={archiveAction}
        footer={
          <>
            <SubmitButton variant="danger" pendingLabel="Archiving…">
              Yes, archive
            </SubmitButton>
            <Button type="button" variant="ghost" onClick={archive.close}>
              Keep it
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <input type="hidden" name="contact_id" value={contact.id} />
          <FormError state={archiveState} />
          <p className="text-sm leading-relaxed text-slate-700">
            They disappear from lists and search. Their timeline, gifts, proposals and files are
            kept, and an administrator can restore the record.
          </p>
        </div>
      </Dialog>
    </header>
  )
}
