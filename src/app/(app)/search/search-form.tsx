'use client'

import { Button } from '@/components/ui/button'
import { Field, Input } from '@/components/ui/form'

/**
 * A plain GET form, so the URL stays the single source of truth for a search
 * and a result set can be bookmarked or shared. It is a client component only
 * because `Field` takes a render prop.
 */
export function SearchForm({ q }: { q: string }) {
  return (
    <form
      method="get"
      action="/search"
      role="search"
      aria-label="Search Grace Force"
      className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
    >
      <div className="flex flex-wrap items-end gap-3">
        <Field
          label="Search"
          hint="Names, email addresses, organisations, notes and timeline entries."
          className="min-w-[12rem] flex-1"
        >
          {(props) => (
            <Input
              {...props}
              name="q"
              type="search"
              defaultValue={q}
              placeholder="Search everything"
              autoComplete="off"
            />
          )}
        </Field>
        <Button type="submit">Search</Button>
      </div>
    </form>
  )
}
