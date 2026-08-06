import Link from 'next/link'
import { buttonClasses } from '@/components/ui/button'
import {
  CONTACT_PAGE_SIZE,
  contactListSearchParams,
  type ContactListFilters,
} from '@/lib/queries/contacts'
import { pluralize } from '@/lib/utils'

function hrefForPage(filters: ContactListFilters, page: number): string {
  const params = contactListSearchParams(filters)
  if (page > 1) params.set('page', String(page))
  const query = params.toString()
  return query === '' ? '/contacts' : `/contacts?${query}`
}

export function ContactPagination({
  filters,
  page,
  pageCount,
  total,
  shown,
}: {
  filters: ContactListFilters
  page: number
  pageCount: number
  total: number
  shown: number
}) {
  const firstOnPage = total === 0 ? 0 : (page - 1) * CONTACT_PAGE_SIZE + 1

  return (
    <nav
      aria-label="Contact list pages"
      className="flex flex-wrap items-center justify-between gap-3"
    >
      <p className="text-sm text-slate-600" aria-live="polite">
        {total === 0
          ? 'No contacts'
          : `Showing ${firstOnPage}–${firstOnPage + shown - 1} of ${pluralize(total, 'contact')}`}
      </p>
      {pageCount > 1 ? (
        <div className="flex items-center gap-2">
          {page > 1 ? (
            <Link href={hrefForPage(filters, page - 1)} className={buttonClasses('secondary', 'md')}>
              Previous
            </Link>
          ) : (
            <span className={`${buttonClasses('secondary', 'md')} pointer-events-none text-slate-500 shadow-none ring-slate-200`}>
              Previous
            </span>
          )}
          <span className="text-sm text-slate-600">
            Page {page} of {pageCount}
          </span>
          {page < pageCount ? (
            <Link href={hrefForPage(filters, page + 1)} className={buttonClasses('secondary', 'md')}>
              Next
            </Link>
          ) : (
            <span className={`${buttonClasses('secondary', 'md')} pointer-events-none text-slate-500 shadow-none ring-slate-200`}>
              Next
            </span>
          )}
        </div>
      ) : null}
    </nav>
  )
}
