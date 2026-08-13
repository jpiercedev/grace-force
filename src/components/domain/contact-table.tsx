import Link from 'next/link'
import { ArrowDown, ArrowUp, PanelRight } from 'lucide-react'
import {
  ContactStatusBadge,
  EngagementTypeBadge,
  LifecycleStageBadge,
} from '@/components/domain/contact-badges'
import { Avatar } from '@/components/ui/display'
import {
  contactListSearchParams,
  type ContactListFilters,
  type ContactListItem,
  type ContactSort,
} from '@/lib/queries/contacts'
import { cn, formatRelative } from '@/lib/utils'

/**
 * The People index: a working database view. Compact rows, a face and a
 * record link per row, sortable columns where sorting means something, and a
 * preview affordance so a donor can be inspected without leaving the list.
 *
 * One dataset, two presentations: a table where there is room for columns and
 * a stacked list below `md`, because a six-column table on a 360px screen is
 * either unreadable or a horizontal scroll through the whole page.
 */

function withParam(filters: ContactListFilters, page: number, key: string, value: string): string {
  const params = contactListSearchParams(filters)
  if (page > 1) params.set('page', String(page))
  params.set(key, value)
  const query = params.toString()
  return query ? `/contacts?${query}` : '/contacts'
}

export function previewHref(filters: ContactListFilters, page: number, contactId: string): string {
  return withParam(filters, page, 'preview', contactId)
}

export function ContactTable({
  contacts,
  filters,
  page,
}: {
  contacts: ContactListItem[]
  filters: ContactListFilters
  page: number
}) {
  return (
    <>
      <div className="hidden overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-card md:block">
        <table className="min-w-full text-sm">
          <caption className="sr-only">Contacts</caption>
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50">
              <SortableTh filters={filters} sort="name" className="pl-4">
                Name
              </SortableTh>
              <Th>Contact information</Th>
              <Th>Stage</Th>
              {/* Engagements and Last activity are the first to go when the
                  table is narrow — both stay reachable on the contact page. */}
              <Th className="hidden lg:table-cell">Engagements</Th>
              <Th>Owner</Th>
              <SortableTh filters={filters} sort="recent" className="hidden lg:table-cell">
                Last activity
              </SortableTh>
              <Th className="pr-3">
                <span className="sr-only">Preview</span>
              </Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {contacts.map((contact) => (
              <tr key={contact.id} className="group transition-colors duration-150 hover:bg-slate-50">
                <td className="px-3 py-2 pl-4">
                  <div className="flex items-center gap-2.5">
                    <Avatar name={contact.name} size="sm" />
                    <div className="min-w-[10rem]">
                      <Link
                        href={`/contacts/${contact.id}`}
                        className="font-semibold text-brand-700 hover:underline"
                      >
                        {contact.name}
                      </Link>
                      {contact.organization_name || contact.job_title ? (
                        <div className="max-w-[26ch] truncate text-xs text-slate-500">
                          {[contact.job_title, contact.organization_name].filter(Boolean).join(' · ')}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </td>
                <td className="px-3 py-2 text-[13px] text-slate-600">
                  <ContactChannels contact={contact} inTable />
                </td>
                <td className="px-3 py-2">
                  <div className="flex flex-wrap gap-1">
                    <LifecycleStageBadge stage={contact.lifecycle_stage} />
                    {contact.status !== 'active' ? (
                      <ContactStatusBadge status={contact.status} />
                    ) : null}
                  </div>
                </td>
                <td className="hidden px-3 py-2 lg:table-cell">
                  <EngagementBadges contact={contact} />
                </td>
                <td className="px-3 py-2 text-[13px]">
                  {contact.owner ? (
                    <span
                      className="block max-w-[9rem] truncate text-slate-600 xl:max-w-[13rem]"
                      title={contact.owner.name}
                    >
                      {contact.owner.name}
                    </span>
                  ) : (
                    <span className="text-slate-500">Unassigned</span>
                  )}
                </td>
                <td className="hidden whitespace-nowrap px-3 py-2 text-[13px] text-slate-500 lg:table-cell">
                  {contact.last_activity_at ? (
                    <time dateTime={contact.last_activity_at}>
                      {formatRelative(contact.last_activity_at)}
                    </time>
                  ) : (
                    <span>No activity</span>
                  )}
                </td>
                <td className="w-10 px-2 py-2 pr-3 text-right">
                  <Link
                    href={previewHref(filters, page, contact.id)}
                    scroll={false}
                    aria-label={`Preview ${contact.name}`}
                    title="Preview"
                    className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-brand-700 group-hover:text-slate-500"
                  >
                    <PanelRight className="h-4 w-4" aria-hidden="true" />
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ul className="divide-y divide-slate-200 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-card md:hidden">
        {contacts.map((contact) => (
          <li key={contact.id} className="relative p-3 transition-colors duration-150 hover:bg-slate-50">
            <div className="flex items-start gap-2.5">
              <Avatar name={contact.name} size="sm" className="mt-0.5" />
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <Link
                    href={`/contacts/${contact.id}`}
                    className="text-sm font-semibold text-brand-700 hover:underline"
                  >
                    {contact.name}
                  </Link>
                  <Link
                    href={previewHref(filters, page, contact.id)}
                    scroll={false}
                    aria-label={`Preview ${contact.name}`}
                    className="-mr-1 -mt-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-brand-700"
                  >
                    <PanelRight className="h-4 w-4" aria-hidden="true" />
                  </Link>
                </div>
                {contact.organization_name || contact.job_title ? (
                  <p className="mt-0.5 text-[13px] text-slate-600">
                    {[contact.job_title, contact.organization_name].filter(Boolean).join(' · ')}
                  </p>
                ) : null}
                <div className="mt-1.5 flex flex-wrap gap-1">
                  <LifecycleStageBadge stage={contact.lifecycle_stage} />
                  {contact.status !== 'active' ? (
                    <ContactStatusBadge status={contact.status} />
                  ) : null}
                  {/* No "None" here: without the table's column header the word has
                      no referent, and absent badges already say it. */}
                  {contact.engagements.length > 0 ? <EngagementBadges contact={contact} /> : null}
                </div>
                <div className="mt-1.5 text-[13px] text-slate-500">
                  <ContactChannels contact={contact} />
                </div>
                <p className="mt-1.5 text-xs text-slate-500">
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
        'whitespace-nowrap px-3 py-2 text-left text-xs font-medium text-slate-600 first:pl-4',
        className,
      )}
    >
      {children}
    </th>
  )
}

/**
 * A sortable column is a link that rewrites `?sort=` — server-rendered like
 * every other view change here. The arrow marks the active order; there is
 * one direction per sort because that is the direction the question is asked
 * in ("A first", "most recent first").
 */
function SortableTh({
  filters,
  sort,
  children,
  className,
}: {
  filters: ContactListFilters
  sort: ContactSort
  children: React.ReactNode
  className?: string
}) {
  const active = filters.sort === sort
  const params = contactListSearchParams({ ...filters, sort })
  if (sort === 'recent') params.delete('sort')
  const query = params.toString()

  return (
    <th
      scope="col"
      aria-sort={active ? (sort === 'name' ? 'ascending' : 'descending') : undefined}
      className={cn('whitespace-nowrap px-3 py-2 text-left text-xs font-medium', className)}
    >
      <Link
        href={query ? `/contacts?${query}` : '/contacts'}
        className={cn(
          'inline-flex items-center gap-1 rounded hover:text-slate-900',
          active ? 'font-semibold text-slate-900' : 'text-slate-600',
        )}
      >
        {children}
        {active ? (
          sort === 'name' ? (
            <ArrowUp className="h-3 w-3" aria-hidden="true" />
          ) : (
            <ArrowDown className="h-3 w-3" aria-hidden="true" />
          )
        ) : null}
      </Link>
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
