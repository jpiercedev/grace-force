import Link from 'next/link'
import {
  ContactStatusBadge,
  EngagementTypeBadge,
  LifecycleStageBadge,
} from '@/components/domain/contact-badges'
import { Avatar } from '@/components/ui/display'
import type { ContactListItem } from '@/lib/queries/contacts'
import { cn, formatRelative } from '@/lib/utils'

/**
 * One dataset, two presentations: a table where there is room for columns and
 * a stacked list below `md`, because a six-column table on a 360px screen is
 * either unreadable or a horizontal scroll through the whole page.
 *
 * Rows lead with a face: the avatar and the semibold ink name anchor each row,
 * with the operational facts (channels, owner, recency) kept a register quieter.
 */
export function ContactTable({ contacts }: { contacts: ContactListItem[] }) {
  return (
    <>
      <div className="hidden overflow-x-auto rounded-xl border border-slate-200/70 bg-white shadow-card md:block">
        <table className="min-w-full text-sm">
          <caption className="sr-only">Contacts</caption>
          <thead>
            <tr className="border-b border-slate-200">
              <Th>Name</Th>
              <Th>Email and phone</Th>
              {/* Organisation and Last activity are the first to go when the
                  table is narrow — both stay reachable on the contact page. */}
              <Th className="hidden lg:table-cell">Organisation</Th>
              <Th>Engagements</Th>
              <Th>Owner</Th>
              <Th className="hidden lg:table-cell">Last activity</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200/70">
            {contacts.map((contact) => (
              <tr
                key={contact.id}
                className="align-top transition-colors duration-150 hover:bg-slate-100/60"
              >
                <td className="px-3 py-4 pl-4">
                  <div className="flex items-start gap-3">
                    <Avatar name={contact.name} size="md" className="mt-0.5" />
                    {/* min-w keeps ordinary two-word names on one line; the
                        genuinely long ones still wrap instead of scrolling. */}
                    <div className="min-w-[10rem]">
                      <Link
                        href={`/contacts/${contact.id}`}
                        className="font-semibold text-slate-900 hover:text-brand-700 hover:underline"
                      >
                        {contact.name}
                      </Link>
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        <LifecycleStageBadge stage={contact.lifecycle_stage} />
                        {contact.status !== 'active' ? (
                          <ContactStatusBadge status={contact.status} />
                        ) : null}
                      </div>
                    </div>
                  </div>
                </td>
                <td className="px-3 py-4 text-slate-500">
                  <ContactChannels contact={contact} inTable />
                </td>
                <td className="hidden px-3 py-4 lg:table-cell">
                  {contact.organization_name ? (
                    // Capped so a long organisation name wraps at a readable
                    // measure instead of stretching into a many-line sliver.
                    <div className="max-w-[30ch]">
                      <div className="text-slate-700">{contact.organization_name}</div>
                      {contact.job_title ? (
                        <div className="text-xs text-slate-500">{contact.job_title}</div>
                      ) : null}
                    </div>
                  ) : (
                    <Dash />
                  )}
                </td>
                <td className="px-3 py-4">
                  <EngagementBadges contact={contact} />
                </td>
                <td className="px-3 py-4">
                  {contact.owner ? (
                    <span className="flex items-center gap-2 text-slate-600">
                      {/* At md the four visible columns are already snug; the
                          owner keeps their face from lg up. */}
                      <Avatar name={contact.owner.name} size="sm" className="hidden lg:inline-flex" />
                      <span className="max-w-[9rem] truncate xl:max-w-[13rem]" title={contact.owner.name}>
                        {contact.owner.name}
                      </span>
                    </span>
                  ) : (
                    <span className="text-slate-500">Unassigned</span>
                  )}
                </td>
                <td className="hidden whitespace-nowrap px-3 py-4 pr-4 text-slate-500 lg:table-cell">
                  {contact.last_activity_at ? (
                    <time dateTime={contact.last_activity_at}>
                      {formatRelative(contact.last_activity_at)}
                    </time>
                  ) : (
                    <span>No activity</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="divide-y divide-slate-200/70 overflow-hidden rounded-xl border border-slate-200/70 bg-white shadow-card md:hidden">
        {contacts.map((contact) => (
          <li key={contact.id} className="p-4 transition-colors duration-150 hover:bg-slate-100/60">
            <div className="flex items-start gap-3">
              <Avatar name={contact.name} size="md" className="mt-0.5" />
              <div className="min-w-0 flex-1">
                <Link
                  href={`/contacts/${contact.id}`}
                  className="text-sm font-semibold text-slate-900 hover:text-brand-700 hover:underline"
                >
                  {contact.name}
                </Link>
                {contact.organization_name ? (
                  <p className="mt-0.5 text-sm text-slate-600">
                    {contact.organization_name}
                    {contact.job_title ? ` · ${contact.job_title}` : ''}
                  </p>
                ) : null}
                <div className="mt-2 flex flex-wrap gap-1">
                  <LifecycleStageBadge stage={contact.lifecycle_stage} />
                  {contact.status !== 'active' ? (
                    <ContactStatusBadge status={contact.status} />
                  ) : null}
                  {/* No "None" here: without the table's column header the word has
                      no referent, and absent badges already say it. */}
                  {contact.engagements.length > 0 ? <EngagementBadges contact={contact} /> : null}
                </div>
                <div className="mt-2 text-sm text-slate-500">
                  <ContactChannels contact={contact} />
                </div>
                <p className="mt-2 text-xs text-slate-500">
                  {contact.owner ? contact.owner.name : 'Unassigned'}
                  {' · '}
                  {contact.last_activity_at
                    ? formatRelative(contact.last_activity_at)
                    : 'No activity yet'}
                </p>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </>
  )
}

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <th
      scope="col"
      className={cn(
        'whitespace-nowrap px-3 py-3 text-left first:pl-4 last:pr-4 text-[11px] font-semibold uppercase tracking-wider text-slate-500',
        className,
      )}
    >
      {children}
    </th>
  )
}

function Dash() {
  return <span className="text-slate-500">—</span>
}

function ContactChannels({ contact, inTable }: { contact: ContactListItem; inTable?: boolean }) {
  const phone = contact.phone ?? contact.mobile_phone
  if (!contact.email && !phone) return <Dash />
  return (
    <div className="space-y-0.5">
      {contact.email ? (
        <a
          href={`mailto:${contact.email}`}
          // In the auto-layout table `truncate` only engages with an explicit
          // width bound — otherwise a long address widens the whole table and
          // pushes the trailing columns off-screen. The mobile card constrains
          // the block itself, so it needs no cap.
          className={cn(
            'block truncate hover:text-brand-700 hover:underline',
            inTable && 'max-w-[24ch]',
          )}
          title={contact.email}
        >
          {contact.email}
        </a>
      ) : null}
      {phone ? (
        <a
          href={`tel:${phone}`}
          className="block whitespace-nowrap hover:text-brand-700 hover:underline"
        >
          {phone}
        </a>
      ) : null}
    </div>
  )
}

function EngagementBadges({ contact }: { contact: ContactListItem }) {
  if (contact.engagements.length === 0) {
    return <span className="text-xs text-slate-500">None</span>
  }
  return (
    <div className="flex flex-wrap gap-1">
      {contact.engagements.map((engagement) => (
        <EngagementTypeBadge
          key={engagement.id}
          label={engagement.label}
          color={engagement.color}
          status={engagement.status}
        />
      ))}
    </div>
  )
}
