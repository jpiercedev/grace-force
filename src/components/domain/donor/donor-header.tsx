'use client'

import { Mail, MessageSquare, Phone } from 'lucide-react'
import { useActionState } from 'react'
import { ContactStatusBadge, LifecycleStageBadge } from '@/components/domain/contact-badges'
import {
  FormError,
  SubmitButton,
  ownerOptions,
  useCloseOnSuccess,
} from '@/components/domain/contact-form-controls'
import { CONTACT_METHOD_LABELS } from '@/components/domain/development-badges'
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
import { cn } from '@/lib/utils'
import type { ContactActionState } from '@/lib/validation/contact'
import type { ContactRow, ProposalStatus } from '@/types/database'

/**
 * The donor header answers, in order: who is this, how do I reach them the way
 * they want to be reached, who holds the relationship, and what am I most
 * likely to do next.
 *
 * The previous header put four buttons at equal weight and five badges in a
 * row. Here there is exactly one primary action — Log interaction — one
 * secondary, and everything else in the overflow menu. The badge row is down
 * to the ones that change how you behave.
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
  const preferred = contact.preferred_contact_method

  return (
    <header className="space-y-4">
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          <Avatar name={name} size="xl" className="hidden sm:inline-flex" />
          <div className="min-w-0">
            <h1 className="break-words font-display text-[1.75rem] font-semibold leading-tight tracking-tight text-slate-900 sm:text-[2rem]">
              {name}
            </h1>
            {subtitle ? <p className="mt-1 text-[15px] text-slate-600">{subtitle}</p> : null}

            <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
              <span className="inline-flex items-center gap-1.5 text-slate-600">
                {owner ? <Avatar name={owner.name} size="sm" /> : null}
                {owner ? owner.name : 'Unassigned'}
              </span>
              <span aria-hidden="true" className="text-slate-300">
                ·
              </span>
              {/* Only the standing that changes how you treat the record. An
                  active contact is the normal case and earns no chip. */}
              <LifecycleStageBadge stage={contact.lifecycle_stage} />
              {contact.status !== 'active' ? <ContactStatusBadge status={contact.status} /> : null}
              {contact.do_not_contact ? <Badge tone="red">Do not contact</Badge> : null}
            </div>
          </div>
        </div>

        {canEdit ? (
          <div className="flex flex-wrap items-center gap-2 lg:shrink-0 lg:justify-end">
            <LogInteractionDialog
              contactId={contact.id}
              contactName={name}
              proposals={proposals}
              action={actions.logInteraction}
              size="lg"
            />
            <LinkButton
              href={`/reports/new?contact=${contact.id}`}
              variant="secondary"
              size="lg"
            >
              Call report
            </LinkButton>
            <ActionMenu label={`More actions for ${name}`}>
              <ActionMenuLink href={`/contacts/${contact.id}/edit`}>Edit details</ActionMenuLink>
              <ActionMenuLink href={`/follow-ups/new?contact=${contact.id}`}>
                Add a follow-up
              </ActionMenuLink>
              <ActionMenuLink href={`/proposals/new?contact=${contact.id}`}>
                Start a proposal
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
      </div>

      <ContactMethods contact={contact} preferred={preferred} />

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
          <p className="text-[15px] leading-relaxed text-slate-700">
            They disappear from lists and search. Their timeline, gifts, proposals and files are
            kept, and an administrator can restore the record.
          </p>
        </div>
      </Dialog>
    </header>
  )
}

/**
 * How to reach them, as things you can press.
 *
 * The preferences requirement said "these should be visible where staff
 * actually communicate with the donor" — so they are not a settings panel,
 * they are the buttons themselves. A blocked channel is disabled and says why
 * in words, because a greyed-out button with no reason is a puzzle.
 */
function ContactMethods({
  contact,
  preferred,
}: {
  contact: ContactRow
  preferred: ContactRow['preferred_contact_method']
}) {
  const phone = contact.preferred_phone ?? contact.phone ?? contact.mobile_phone
  const mobile = contact.mobile_phone ?? contact.phone
  const email = contact.preferred_email ?? contact.email

  const blocked: string[] = []
  if (contact.do_not_contact) blocked.push('Do not contact at all')
  else {
    if (contact.do_not_call) blocked.push('Do not call')
    if (contact.do_not_email) blocked.push('Do not email')
    if (contact.do_not_text) blocked.push('Do not text')
    if (contact.do_not_mail) blocked.push('Do not send post')
  }

  const methods = [
    {
      key: 'phone' as const,
      label: 'Call',
      value: phone,
      href: phone ? `tel:${phone}` : null,
      icon: Phone,
      blocked: contact.do_not_contact || contact.do_not_call,
    },
    {
      key: 'text' as const,
      label: 'Text',
      value: mobile,
      href: mobile ? `sms:${mobile}` : null,
      icon: MessageSquare,
      blocked: contact.do_not_contact || contact.do_not_text,
    },
    {
      key: 'email' as const,
      label: 'Email',
      value: email,
      href: email ? `mailto:${email}` : null,
      icon: Mail,
      blocked: contact.do_not_contact || contact.do_not_email,
    },
  ].filter((method) => method.value)

  if (methods.length === 0 && blocked.length === 0 && !contact.best_time_to_contact) return null

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-y border-slate-200 py-3">
      {methods.map((method) => {
        const MethodIcon = method.icon
        const isPreferred = preferred === method.key
        const content = (
          <>
            <MethodIcon aria-hidden="true" className="h-4 w-4 shrink-0" />
            <span className="truncate">{method.value}</span>
            {isPreferred ? (
              <span className="shrink-0 rounded-full bg-brand-100 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-brand-800">
                Preferred
              </span>
            ) : null}
          </>
        )

        if (method.blocked) {
          return (
            <span
              key={method.key}
              className="inline-flex max-w-full items-center gap-2 rounded-lg bg-slate-100 px-3 py-2 text-sm text-slate-500 line-through decoration-slate-400"
            >
              {content}
            </span>
          )
        }

        return (
          <a
            key={method.key}
            href={method.href ?? undefined}
            className={cn(
              'inline-flex max-w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
              isPreferred
                ? 'bg-brand-50 text-brand-800 hover:bg-brand-100'
                : 'bg-slate-100 text-slate-700 hover:bg-slate-200 hover:text-slate-900',
            )}
          >
            {content}
          </a>
        )
      })}

      {contact.best_time_to_contact ? (
        <span className="text-sm text-slate-600">Best time: {contact.best_time_to_contact}</span>
      ) : null}

      {blocked.length > 0 ? (
        <span className="text-sm font-medium text-red-700">{blocked.join(' · ')}</span>
      ) : null}

      {preferred && methods.every((method) => method.key !== preferred) ? (
        <span className="text-sm text-slate-600">
          Prefers {CONTACT_METHOD_LABELS[preferred].toLowerCase()}
        </span>
      ) : null}
    </div>
  )
}
