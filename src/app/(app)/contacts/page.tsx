import { ContactFilters } from '@/components/domain/contact-filters'
import { ContactPagination } from '@/components/domain/contact-pagination'
import { ContactTable } from '@/components/domain/contact-table'
import { LinkButton } from '@/components/ui/button'
import { Callout, EmptyState, PageHeader } from '@/components/ui/display'
import { canWrite, requireProfile } from '@/lib/auth'
import {
  hasActiveFilters,
  listContacts,
  listEngagementTypes,
  listTeamMembers,
  parseContactListFilters,
} from '@/lib/queries/contacts'

export const metadata = { title: 'Contacts' }

type SearchParams = Record<string, string | string[] | undefined>

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const profile = await requireProfile()
  const params = await searchParams
  const filters = parseContactListFilters(params)

  const [result, team, engagementTypes] = await Promise.all([
    listContacts(filters),
    listTeamMembers(),
    listEngagementTypes(),
  ])

  const filtered = hasActiveFilters(filters)
  const writable = canWrite(profile)

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        title="Contacts"
        description="Everyone Grace Force is in relationship with."
        action={
          writable ? (
            <LinkButton href="/contacts/new">New contact</LinkButton>
          ) : null
        }
      />

      {params.archived ? (
        <Callout tone="success">That contact has been archived.</Callout>
      ) : null}

      <ContactFilters filters={filters} team={team} engagementTypes={engagementTypes} />

      {result.contacts.length === 0 ? (
        <div className="rounded-xl border border-slate-200/70 bg-white shadow-card">
          {filtered ? (
            <EmptyState
              title="No contacts match these filters"
              description="Try a broader search, or clear the filters to see everyone."
              action={
                <LinkButton href="/contacts" variant="secondary">
                  Clear filters
                </LinkButton>
              }
            />
          ) : (
            <EmptyState
              title="No contacts yet"
              description="Add the first person Grace Force is in relationship with, or bring a list in from a CSV."
              action={
                writable ? <LinkButton href="/contacts/new">Add a contact</LinkButton> : null
              }
            />
          )}
        </div>
      ) : (
        <>
          <ContactTable contacts={result.contacts} />
          <ContactPagination
            filters={filters}
            page={result.page}
            pageCount={result.pageCount}
            total={result.total}
            shown={result.contacts.length}
          />
        </>
      )}
    </div>
  )
}
