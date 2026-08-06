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
      {/* The hint lives outside the Field column so the submit button
          bottom-aligns with the input itself, not with the hint text. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <Field label="Search" className="w-full sm:flex-1">
          {(props) => (
            <Input
              {...props}
              aria-describedby="search-hint"
              name="q"
              type="search"
              defaultValue={q}
              placeholder="Search everything"
              autoComplete="off"
              // The page's one primary control keeps 16px text on desktop
              // too, sitting level with the lg submit button.
              className="sm:py-3 sm:text-base"
            />
          )}
        </Field>
        <Button type="submit" size="lg" className="w-full sm:w-auto">
          Search
        </Button>
      </div>
      <p id="search-hint" className="mt-2 text-sm text-slate-500">
        Names, email addresses, organisations, notes and timeline entries.
      </p>
    </form>
  )
}
