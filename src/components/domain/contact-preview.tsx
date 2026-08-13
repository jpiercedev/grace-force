import Link from 'next/link'
import { Mail, Phone, X } from 'lucide-react'
import { logInteraction } from '@/app/(app)/contacts/donor-actions'
import {
  ContactStatusBadge,
  LifecycleStageBadge,
  ACTIVITY_TYPE_LABELS,
} from '@/components/domain/contact-badges'
import {
  CONTACT_METHOD_LABELS,
  InterestBadge,
  ProposalStatusBadge,
} from '@/components/domain/development-badges'
import { LogInteractionDialog } from '@/components/domain/log-interaction'
import { PreviewShell } from '@/components/domain/preview-shell'
import { buttonClasses } from '@/components/ui/button'
import { Avatar, Badge } from '@/components/ui/display'
import {
  contactName,
  getContact,
  getContactFollowUps,
  getContactTimeline,
  teamMemberMap,
  type ContactFollowUp,
  type TimelineActivity,
} from '@/lib/queries/contacts'
import { getContactProposals, primaryProposal, type ProposalSummary } from '@/lib/queries/proposals'
import {
  getContactInterests,
  getRelatedPeople,
  type ContactInterest,
  type RelatedPerson,
} from '@/lib/queries/relationships'
import { cn, formatCurrency, formatDate, formatRelative } from '@/lib/utils'
import type { ContactRow } from '@/types/database'

/**
 * The record preview: a side panel opened from a list (`?preview=<id>`), so a
 * person can be inspected — and acted on — without leaving the list.
 *
 * Everything here is chosen for speed: who they are, how to reach them, what
 * is next, what was last, and the two or three pieces of relationship context
 * that change a phone call. The full record is one click away; this panel
 * must never try to be it.
 */

export interface ContactPreviewData {
  contact: ContactRow
  name: string
  ownerName: string | null
  nextFollowUp: ContactFollowUp | null
  lastInteraction: TimelineActivity | null
  recentActivity: TimelineActivity[]
  interests: ContactInterest[]
  related: RelatedPerson[]
  proposal: ProposalSummary | null
  proposalOptions: Array<{ id: string; title: string; status: ProposalSummary['status'] }>
}

export async function loadContactPreview(
  id: string,
  showGiving: boolean,
): Promise<ContactPreviewData | null> {
  const contact = await getContact(id)
  if (!contact) return null

  const [members, followUps, timeline, interests, related, proposals] = await Promise.all([
    teamMemberMap(),
    getContactFollowUps(contact.id),
    getContactTimeline(contact.id, { limit: 25 }),
    getContactInterests(contact.id),
    getRelatedPeople(contact.id),
    showGiving ? getContactProposals(contact.id) : Promise.resolve([]),
  ])

  return {
    contact,
    name: contactName(contact),
    ownerName: contact.owner_id ? (members.get(contact.owner_id)?.name ?? null) : null,
    nextFollowUp: followUps[0] ?? null,
    // "Last spoke" means a human interaction, not the machinery reporting on
    // itself — a Mailchimp open is not a conversation.
    lastInteraction: timeline.activities.find((activity) => activity.source === 'manual') ?? null,
    recentActivity: timeline.activities.slice(0, 3),
    interests,
    related,
    proposal: primaryProposal(proposals),
    proposalOptions: proposals.map(({ id: proposalId, title, status }) => ({
      id: proposalId,
      title,
      status,
    })),
  }
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-slate-200 px-4 py-3">
      <h3 className="text-[13px] font-semibold text-slate-900">{title}</h3>
      <div className="mt-1.5">{children}</div>
    </section>
  )
}

function PropertyRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 py-0.5 text-[13px]">
      <dt className="w-24 shrink-0 text-slate-500">{label}</dt>
      <dd className="min-w-0 flex-1 text-slate-800">{children}</dd>
    </div>
  )
}

export function ContactPreviewPanel({
  data,
  closeHref,
  canEdit,
}: {
  data: ContactPreviewData
  closeHref: string
  canEdit: boolean
}) {
  const { contact, name } = data
  const subtitle = [contact.job_title, contact.organization_name].filter(Boolean).join(' · ')
  const recordHref = `/contacts/${contact.id}`
  const phone = contact.preferred_phone ?? contact.phone ?? contact.mobile_phone
  const email = contact.preferred_email ?? contact.email
  const address = [
    contact.address_line1,
    contact.address_line2,
    [contact.city, contact.region].filter(Boolean).join(', ') +
      (contact.postal_code ? ` ${contact.postal_code}` : ''),
  ]
    .map((line) => line?.trim())
    .filter(Boolean)

  const canCall = Boolean(phone) && !contact.do_not_contact && !contact.do_not_call
  const canEmail = Boolean(email) && !contact.do_not_contact && !contact.do_not_email

  return (
    <PreviewShell closeHref={closeHref} label={`Preview of ${name}`}>
      {/* Identity */}
      <div className="flex items-start gap-3 px-4 pb-3 pt-4">
        <Avatar name={name} size="lg" className="mt-0.5" />
        <div className="min-w-0 flex-1">
          <Link
            href={recordHref}
            className="block truncate text-[15px] font-semibold text-slate-900 hover:text-brand-700 hover:underline"
          >
            {name}
          </Link>
          {subtitle ? <p className="mt-0.5 truncate text-[13px] text-slate-600">{subtitle}</p> : null}
          <div className="mt-1.5 flex flex-wrap gap-1">
            <LifecycleStageBadge stage={contact.lifecycle_stage} />
            {contact.status !== 'active' ? <ContactStatusBadge status={contact.status} /> : null}
            {contact.do_not_contact ? <Badge tone="red">Do not contact</Badge> : null}
          </div>
        </div>
        <Link
          href={closeHref}
          scroll={false}
          aria-label="Close preview"
          className="-mr-1 -mt-1 shrink-0 rounded-md p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </Link>
      </div>

      {/* Quick actions */}
      <div className="flex flex-wrap items-center gap-1.5 px-4 pb-3.5">
        {canEdit ? (
          <LogInteractionDialog
            contactId={contact.id}
            contactName={name}
            proposals={data.proposalOptions}
            action={logInteraction}
            size="sm"
          />
        ) : null}
        {canEdit ? (
          <Link
            href={`/follow-ups/new?contact=${contact.id}`}
            className={buttonClasses('secondary', 'sm')}
          >
            Follow-up
          </Link>
        ) : null}
        {canCall ? (
          <a href={`tel:${phone}`} className={buttonClasses('secondary', 'sm')}>
            <Phone className="h-3.5 w-3.5" aria-hidden="true" />
            Call
          </a>
        ) : null}
        {canEmail ? (
          <a href={`mailto:${email}`} className={buttonClasses('secondary', 'sm')}>
            <Mail className="h-3.5 w-3.5" aria-hidden="true" />
            Email
          </a>
        ) : null}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-4">
        <Section title="About">
          <dl>
            {email ? (
              <PropertyRow label="Email">
                <a
                  href={canEmail ? `mailto:${email}` : undefined}
                  className={cn('break-all', canEmail && 'text-brand-700 hover:underline')}
                >
                  {email}
                </a>
              </PropertyRow>
            ) : null}
            {phone ? (
              <PropertyRow label="Phone">
                <a href={canCall ? `tel:${phone}` : undefined} className={cn(canCall && 'text-brand-700 hover:underline')}>
                  {phone}
                </a>
              </PropertyRow>
            ) : null}
            <PropertyRow label="Owner">{data.ownerName ?? 'Unassigned'}</PropertyRow>
            {contact.preferred_contact_method ? (
              <PropertyRow label="Prefers">
                {CONTACT_METHOD_LABELS[contact.preferred_contact_method]}
                {contact.best_time_to_contact ? ` · ${contact.best_time_to_contact}` : ''}
              </PropertyRow>
            ) : null}
            {address.length > 0 ? (
              <PropertyRow label="Address">{address.join(', ')}</PropertyRow>
            ) : null}
          </dl>
        </Section>

        {data.nextFollowUp ? (
          <Section title="Next follow-up">
            <p className="text-[13px] text-slate-800">{data.nextFollowUp.title}</p>
            <p className="mt-0.5 text-xs text-slate-500">
              Due {formatDate(data.nextFollowUp.due_at)}
              {data.nextFollowUp.assignee ? ` · ${data.nextFollowUp.assignee.name}` : ''}
            </p>
          </Section>
        ) : null}

        {data.lastInteraction ? (
          <Section title="Last interaction">
            <p className="text-[13px] text-slate-800">
              {ACTIVITY_TYPE_LABELS[data.lastInteraction.type]}
              {data.lastInteraction.subject ? ` — ${data.lastInteraction.subject}` : ''}
            </p>
            <p className="mt-0.5 text-xs text-slate-500">
              {formatRelative(data.lastInteraction.occurred_at)}
              {data.lastInteraction.actor ? ` · ${data.lastInteraction.actor.name}` : ''}
            </p>
          </Section>
        ) : null}

        {data.interests.length > 0 ? (
          <Section title="Interests">
            <div className="flex flex-wrap gap-1">
              {data.interests.map((interest) => (
                <InterestBadge key={interest.id} label={interest.label} />
              ))}
            </div>
          </Section>
        ) : null}

        {data.proposal ? (
          <Section title="Planned gift">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <Link
                href={`/proposals/${data.proposal.id}`}
                className="text-[13px] font-medium text-brand-700 hover:underline"
              >
                {data.proposal.title}
              </Link>
              <ProposalStatusBadge status={data.proposal.status} />
            </div>
            {data.proposal.amountCents !== null ? (
              <p className="mt-0.5 text-xs text-slate-500">
                {formatCurrency(data.proposal.amountCents, data.proposal.currency)}
              </p>
            ) : null}
          </Section>
        ) : null}

        {data.related.length > 0 ? (
          <Section title="Related people">
            <ul className="space-y-1">
              {data.related.slice(0, 4).map((person) => (
                <li key={person.id} className="flex items-baseline justify-between gap-2 text-[13px]">
                  <Link
                    href={`/contacts/${person.contact.id}`}
                    className="min-w-0 truncate font-medium text-brand-700 hover:underline"
                  >
                    {person.contact.name}
                  </Link>
                  <span className="shrink-0 text-xs text-slate-500">{person.label}</span>
                </li>
              ))}
            </ul>
            {data.related.length > 4 ? (
              <Link
                href={recordHref}
                className="mt-1.5 inline-block text-xs font-medium text-brand-700 hover:underline"
              >
                View all {data.related.length}
              </Link>
            ) : null}
          </Section>
        ) : null}

        {data.recentActivity.length > 0 ? (
          <Section title="Recent activity">
            <ul className="space-y-1.5">
              {data.recentActivity.map((activity) => (
                <li key={activity.id} className="text-[13px]">
                  <span className="text-slate-800">
                    {ACTIVITY_TYPE_LABELS[activity.type]}
                    {activity.subject ? ` — ${activity.subject}` : ''}
                  </span>
                  <span className="text-xs text-slate-500"> · {formatRelative(activity.occurred_at)}</span>
                </li>
              ))}
            </ul>
          </Section>
        ) : null}
      </div>

      {/* Footer: the way out to the whole story. */}
      <div className="border-t border-slate-200 px-4 py-3">
        <Link href={recordHref} className={buttonClasses('outline', 'md', 'w-full')}>
          Open full record
        </Link>
      </div>
    </PreviewShell>
  )
}
