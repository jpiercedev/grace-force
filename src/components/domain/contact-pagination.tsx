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
      aria-label="People list pages"
      className="flex flex-wrap items-center justify-between gap-3 px-1"
    >
      <p className="text-sm tabular-nums text-slate-500" aria-live="polite">
        {total === 0
          ? 'Nobody here'
          : `Showing ${firstOnPage}–${firstOnPage + shown - 1} of ${pluralize(total, 'person', 'people')}`}
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
          <span className="text-sm tabular-nums text-slate-500">
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
