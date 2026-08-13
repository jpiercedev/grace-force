import { ContactFilters } from '@/components/domain/contact-filters'
import { ContactPagination } from '@/components/domain/contact-pagination'
import {
  ContactPreviewPanel,
  loadContactPreview,
} from '@/components/domain/contact-preview'
import { ContactTable } from '@/components/domain/contact-table'
import { LinkButton } from '@/components/ui/button'
import { Callout, EmptyState, PageHeader } from '@/components/ui/display'
import { canViewGiving, canWrite, requireProfile } from '@/lib/auth'
import {
  contactListSearchParams,
  hasActiveFilters,
  listContacts,
  listEngagementTypes,
  listTeamMembers,
  parseContactListFilters,
} from '@/lib/queries/contacts'

export const metadata = { title: 'People' }

type SearchParams = Record<string, string | string[] | undefined>

function first(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value
  return raw?.trim() || null
}

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>
}) {
  const profile = await requireProfile()
  const params = await searchParams
  const filters = parseContactListFilters(params)
  const previewId = first(params.preview)

  const [result, team, engagementTypes, preview] = await Promise.all([
    listContacts(filters),
    listTeamMembers(),
    listEngagementTypes(),
    // A stale or foreign id (a shared link to an archived person) resolves to
    // null and the list simply renders without a panel.
    previewId ? loadContactPreview(previewId, canViewGiving(profile)) : Promise.resolve(null),
  ])

  const filtered = hasActiveFilters(filters)
  const writable = canWrite(profile)

  const closeParams = contactListSearchParams(filters)
  if (result.page > 1) closeParams.set('page', String(result.page))
  const closeQuery = closeParams.toString()
  const closeHref = closeQuery ? `/contacts?${closeQuery}` : '/contacts'

  return (
    <div className="mx-auto max-w-7xl space-y-4">
      <PageHeader
        title="People"
        description="Everyone Grace Force is in relationship with."
        action={writable ? <LinkButton href="/contacts/new">Add person</LinkButton> : null}
      />

      {params.archived ? (
        <Callout tone="success">That person has been archived.</Callout>
      ) : null}

      <ContactFilters filters={filters} team={team} engagementTypes={engagementTypes} />

      {result.contacts.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-white shadow-card">
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
                writable ? <LinkButton href="/contacts/new">Add a person</LinkButton> : null
              }
            />
          )}
        </div>
      ) : (
        <>
          <ContactTable contacts={result.contacts} filters={filters} page={result.page} />
          <ContactPagination
            filters={filters}
            page={result.page}
            pageCount={result.pageCount}
            total={result.total}
            shown={result.contacts.length}
          />
        </>
      )}

      {preview ? (
        // Keyed by contact so switching previews remounts the panel and moves
        // focus to the record that just opened.
        <ContactPreviewPanel
          key={preview.contact.id}
          data={preview}
          closeHref={closeHref}
          canEdit={writable}
        />
      ) : null}
    </div>
  )
}
