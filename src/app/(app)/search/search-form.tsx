'use client'

import { Button } from '@/components/ui/button'
import { Input, Label } from '@/components/ui/form'

/**
 * A plain GET form, so the URL stays the single source of truth for a search
 * and a result set can be bookmarked or shared.
 *
 * The query box is the hero of the page — one large, roomy control sitting
 * directly on the parchment rather than boxed inside a card.
 */
export function SearchForm({ q }: { q: string }) {
  return (
    <form method="get" action="/search" role="search" aria-label="Search Grace Lead Management">
      <Label htmlFor="search-query" className="sr-only">
        Search
      </Label>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative min-w-0 flex-1">
          <svg
            aria-hidden="true"
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400"
          >
            <circle cx="9" cy="9" r="6" />
            <path d="m14 14 3.5 3.5" />
          </svg>
          <Input
            id="search-query"
            aria-describedby="search-hint"
            name="q"
            type="search"
            defaultValue={q}
            placeholder="Search everything…"
            autoComplete="off"
            // The page's one primary control keeps 16px text on desktop too,
            // sized to read as the reason the page exists.
            className="h-14 rounded-lg pl-11 pr-4 text-base shadow-card ring-slate-200 sm:text-base"
          />
        </div>
        <Button type="submit" size="lg" className="w-full sm:w-auto">
          Search
        </Button>
      </div>
      <p id="search-hint" className="mt-2.5 text-sm text-slate-500">
        Names, email addresses, organisations, notes and timeline entries.
      </p>
    </form>
  )
}
