import Link from 'next/link'
import {
  ContactStatusBadge,
  EngagementTypeBadge,
  LifecycleStageBadge,
} from '@/components/domain/contact-badges'
import { Avatar } from '@/components/ui/display'
import type { ContactListItem } from '@/lib/queries/contacts'
import { formatRelative } from '@/lib/utils'

/**
 * One dataset, two presentations: a table where there is room for columns and
 * a stacked list below `md`, because a six-column table on a 360px screen is
 * either unreadable or a horizontal scroll through the whole page.
 */
export function ContactTable({ contacts }: { contacts: ContactListItem[] }) {
  return (
    <>
      <div className="hidden overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm md:block">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <caption className="sr-only">Contacts</caption>
          <thead className="bg-slate-50">
            <tr>
              <Th>Name</Th>
              <Th>Email and phone</Th>
              <Th>Organisation</Th>
              <Th>Engagements</Th>
              <Th>Owner</Th>
              <Th>Last activity</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {contacts.map((contact) => (
              <tr key={contact.id} className="align-top hover:bg-slate-50/70">
                <td className="px-3 py-3">
                  <Link
                    href={`/contacts/${contact.id}`}
                    className="font-medium text-brand-700 hover:underline"
                  >
                    {contact.name}
                  </Link>
                  <div className="mt-1 flex flex-wrap gap-1">
                    <LifecycleStageBadge stage={contact.lifecycle_stage} />
                    {contact.status !== 'active' ? (
                      <ContactStatusBadge status={contact.status} />
                    ) : null}
                  </div>
                </td>
                <td className="px-3 py-3 text-slate-600">
                  <ContactChannels contact={contact} />
                </td>
                <td className="px-3 py-3 text-slate-600">
                  {contact.organization_name ? (
                    <>
                      <div className="text-slate-900">{contact.organization_name}</div>
                      {contact.job_title ? (
                        <div className="text-xs text-slate-500">{contact.job_title}</div>
                      ) : null}
                    </>
                  ) : (
                    <Dash />
                  )}
                </td>
                <td className="px-3 py-3">
                  <EngagementBadges contact={contact} />
                </td>
                <td className="px-3 py-3">
                  {contact.owner ? (
                    <span className="flex items-center gap-2 text-slate-700">
                      <Avatar name={contact.owner.name} size="sm" />
                      <span className="truncate">{contact.owner.name}</span>
                    </span>
                  ) : (
                    <span className="text-slate-400">Unassigned</span>
                  )}
                </td>
                <td className="whitespace-nowrap px-3 py-3 text-slate-600">
                  {contact.last_activity_at ? (
                    <time dateTime={contact.last_activity_at}>
                      {formatRelative(contact.last_activity_at)}
                    </time>
                  ) : (
                    <span className="text-slate-400">No activity</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="divide-y divide-slate-200 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm md:hidden">
        {contacts.map((contact) => (
          <li key={contact.id} className="p-4">
            <Link
              href={`/contacts/${contact.id}`}
              className="text-sm font-semibold text-brand-700 hover:underline"
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
              {contact.status !== 'active' ? <ContactStatusBadge status={contact.status} /> : null}
              <EngagementBadges contact={contact} />
            </div>
            <div className="mt-2 text-sm text-slate-600">
              <ContactChannels contact={contact} />
            </div>
            <p className="mt-2 text-xs text-slate-500">
              {contact.owner ? contact.owner.name : 'Unassigned'}
              {' · '}
              {contact.last_activity_at
                ? formatRelative(contact.last_activity_at)
                : 'No activity yet'}
            </p>
          </li>
        ))}
      </ul>
    </>
  )
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th
      scope="col"
      className="whitespace-nowrap px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500"
    >
      {children}
    </th>
  )
}

function Dash() {
  return <span className="text-slate-400">—</span>
}

function ContactChannels({ contact }: { contact: ContactListItem }) {
  const phone = contact.phone ?? contact.mobile_phone
  if (!contact.email && !phone) return <Dash />
  return (
    <div className="space-y-0.5">
      {contact.email ? (
        <a href={`mailto:${contact.email}`} className="block truncate hover:underline">
          {contact.email}
        </a>
      ) : null}
      {phone ? (
        <a href={`tel:${phone}`} className="block whitespace-nowrap hover:underline">
          {phone}
        </a>
      ) : null}
    </div>
  )
}

function EngagementBadges({ contact }: { contact: ContactListItem }) {
  if (contact.engagements.length === 0) {
    return <span className="text-xs text-slate-400">None</span>
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
