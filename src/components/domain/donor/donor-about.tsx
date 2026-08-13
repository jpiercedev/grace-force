import Link from 'next/link'
import { Mail, MessageSquare, Phone } from 'lucide-react'
import type { ReactNode } from 'react'
import {
  CONTACT_SOURCE_LABELS,
  ContactStatusBadge,
  LifecycleStageBadge,
} from '@/components/domain/contact-badges'
import type { TeamMember } from '@/lib/queries/contacts'
import { cn, formatDate } from '@/lib/utils'
import type { ContactRow } from '@/types/database'

/**
 * The identity rail of the donor record: who this is and how to reach them
 * the way they want to be reached, always in view while the workspace
 * changes. A server component — reading a person costs no JavaScript.
 *
 * The channel rows are the actionable surface (tel:, sms:, mailto:), with the
 * preference pinned to the row it belongs to and a blocked channel disabled
 * *with its reason in words* — a greyed-out row with no explanation is a
 * puzzle. Rarely-needed facts sit behind "View all details" so the rail stays
 * one glance long.
 */

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="py-1 text-[13px]">
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-0.5 break-words text-slate-800">{children}</dd>
    </div>
  )
}

function Muted({ children }: { children: ReactNode }) {
  // slate-500 is the floor for muted text: slate-400 fails AA at this size.
  return <span className="text-slate-500">{children}</span>
}

/**
 * Email addresses have no spaces, so a narrow column either overflows or
 * breaks mid-word. A zero-width space before the @ gives the browser a clean
 * preferred break. Screen readers ignore the ZWSP.
 */
function breakableEmail(email: string): string {
  return email.replace('@', '\u200b@')
}

function addressLines(contact: ContactRow): string[] {
  const cityLine = [contact.city, contact.region].filter(Boolean).join(', ')
  const lines = [
    contact.address_line1,
    contact.address_line2,
    [cityLine, contact.postal_code].filter(Boolean).join(' '),
  ]
    .map((line) => line?.trim() ?? '')
    .filter((line) => line !== '')
  const country = contact.country?.trim()
  return country && lines.length > 0 ? [...lines, country] : lines
}

function ChannelRow({
  icon: Icon,
  label,
  value,
  href,
  preferred,
  blocked,
  blockedReason,
}: {
  icon: typeof Phone
  label: string
  value: string
  href: string
  preferred: boolean
  blocked: boolean
  blockedReason?: string
}) {
  const body = (
    <>
      <Icon aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0 flex-1 truncate">{breakableEmail(value)}</span>
      {preferred && !blocked ? (
        <span className="shrink-0 rounded bg-brand-100 px-1 py-px text-[10px] font-semibold text-brand-800">
          Preferred
        </span>
      ) : null}
    </>
  )

  if (blocked) {
    return (
      <div className="flex items-center gap-2 py-1 text-[13px] text-slate-500">
        {body}
        <span className="shrink-0 text-[11px] font-medium text-red-700">
          {blockedReason ?? `Do not ${label.toLowerCase()}`}
        </span>
      </div>
    )
  }

  return (
    <a
      href={href}
      className="group flex items-center gap-2 rounded py-1 text-[13px] text-slate-700 hover:text-brand-700"
    >
      {body}
    </a>
  )
}

export function DonorAbout({
  contact,
  owner,
  canEdit,
}: {
  contact: ContactRow
  owner: TeamMember | null
  canEdit: boolean
}) {
  const phone = contact.preferred_phone ?? contact.phone
  const mobile = contact.mobile_phone
  const email = contact.preferred_email ?? contact.email
  const address = addressLines(contact)
  const organization = [contact.job_title, contact.organization_name].filter(Boolean).join(' · ')
  const preferred = contact.preferred_contact_method

  return (
    <section
      aria-label="About this person"
      className="rounded-lg border border-slate-200 bg-white shadow-card"
    >
      <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-3.5 py-2.5">
        <h2 className="text-[13px] font-semibold text-slate-900">About</h2>
        {canEdit ? (
          <Link
            href={`/contacts/${contact.id}/edit`}
            className="text-xs font-medium text-brand-700 hover:underline"
          >
            Edit details
          </Link>
        ) : null}
      </div>

      <div className="px-3.5 py-2.5">
        {/* Channels first: the rail's job is making the next touch easy. */}
        <div className="space-y-0.5">
          {email ? (
            <ChannelRow
              icon={Mail}
              label="email"
              value={email}
              href={`mailto:${email}`}
              preferred={preferred === 'email'}
              blocked={contact.do_not_contact || contact.do_not_email}
              blockedReason={contact.do_not_contact ? 'Do not contact' : 'Do not email'}
            />
          ) : null}
          {phone ? (
            <ChannelRow
              icon={Phone}
              label="call"
              value={phone}
              href={`tel:${phone}`}
              preferred={preferred === 'phone'}
              blocked={contact.do_not_contact || contact.do_not_call}
              blockedReason={contact.do_not_contact ? 'Do not contact' : 'Do not call'}
            />
          ) : null}
          {mobile && mobile !== phone ? (
            <ChannelRow
              icon={MessageSquare}
              label="text"
              value={mobile}
              href={`sms:${mobile}`}
              preferred={preferred === 'text'}
              blocked={contact.do_not_contact || contact.do_not_text}
              blockedReason={contact.do_not_contact ? 'Do not contact' : 'Do not text'}
            />
          ) : null}
          {!email && !phone && !mobile ? (
            <p className="py-1 text-[13px] text-slate-500">No contact details recorded.</p>
          ) : null}
        </div>

        <dl className={cn('mt-1.5 border-t border-slate-100 pt-1.5')}>
          <Row label="Owner">{owner ? owner.name : <Muted>Unassigned</Muted>}</Row>
          <Row label="Stage">
            <span className="mt-0.5 inline-flex flex-wrap gap-1">
              <LifecycleStageBadge stage={contact.lifecycle_stage} />
              {contact.status !== 'active' ? <ContactStatusBadge status={contact.status} /> : null}
            </span>
          </Row>
          {organization ? <Row label="Work">{organization}</Row> : null}
          {address.length > 0 ? (
            <Row label="Address">
              <address className="not-italic">
                {address.map((line) => (
                  <span key={line} className="block">
                    {line}
                  </span>
                ))}
              </address>
            </Row>
          ) : null}
        </dl>

        {/* The rarely-needed facts: present, but not paid for on every visit. */}
        <details className="group mt-1.5 border-t border-slate-100 pt-1.5">
          <summary className="cursor-pointer list-none rounded text-xs font-medium text-brand-700 hover:underline [&::-webkit-details-marker]:hidden">
            <span className="group-open:hidden">View all details</span>
            <span className="hidden group-open:inline">Hide extra details</span>
          </summary>
          <dl className="mt-1">
            {contact.secondary_email ? (
              <Row label="Also">
                <a
                  href={`mailto:${contact.secondary_email}`}
                  className="text-brand-700 hover:underline"
                >
                  {breakableEmail(contact.secondary_email)}
                </a>
              </Row>
            ) : null}
            <Row label="Birthday">
              {contact.birthday ? formatDate(contact.birthday) : <Muted>Not recorded</Muted>}
            </Row>
            <Row label="Source">
              {CONTACT_SOURCE_LABELS[contact.source]}
              {contact.source_detail ? (
                <span className="block text-xs text-slate-500">{contact.source_detail}</span>
              ) : null}
            </Row>
            {contact.tags.length > 0 ? <Row label="Tags">{contact.tags.join(', ')}</Row> : null}
            <Row label="Added">
              <time dateTime={contact.created_at}>{formatDate(contact.created_at)}</time>
            </Row>
            <Row label="Updated">
              <time dateTime={contact.updated_at}>{formatDate(contact.updated_at)}</time>
            </Row>
          </dl>
        </details>
      </div>
    </section>
  )
}
