'use client'

import { Search } from 'lucide-react'
import Link from 'next/link'
import { useId, useState, type FormEvent } from 'react'
import {
  CONTACT_STATUS_LABELS,
  LIFECYCLE_STAGE_LABELS,
} from '@/components/domain/contact-badges'
import { Button } from '@/components/ui/button'
import { Field, Input, Select } from '@/components/ui/form'
import type { ContactListFilters, TeamMember } from '@/lib/queries/contacts'
import { CONTACT_STATUSES, LIFECYCLE_STAGES } from '@/lib/validation/contact'
import type { EngagementTypeRow } from '@/types/database'

const SORT_LABELS = {
  recent: 'Recently active',
  name: 'Name (A–Z)',
  created: 'Newest first',
} as const

/**
 * A plain GET form: the URL stays the single source of truth for the view, so
 * a filtered list can be bookmarked, shared and reloaded. It is a client
 * component only because `Field` takes a render prop.
 *
 * Search is the room's primary control — one generous input up top — and the
 * six narrowing filters stay folded away until someone asks for them. Six
 * select boxes rendered above every list is exactly the "too many visible
 * fields" the redesign set out to remove; they open on their own when a
 * filter is already applied, so a shared filtered URL never hides why it is
 * showing fewer people than expected.
 */
export function ContactFilters({
  filters,
  team,
  engagementTypes,
}: {
  filters: ContactListFilters
  team: TeamMember[]
  engagementTypes: EngagementTypeRow[]
}) {
  const searchId = useId()

  // Empty controls are disabled for the duration of the submit so they are
  // left out of the query string; a URL of `?q=&owner=&stage=` is unreadable
  // and impossible to reason about when someone shares it.
  function dropEmptyValues(event: FormEvent<HTMLFormElement>) {
    const disabled: (HTMLInputElement | HTMLSelectElement)[] = []
    for (const element of Array.from(event.currentTarget.elements)) {
      const isControl = element instanceof HTMLInputElement || element instanceof HTMLSelectElement
      if (!isControl || element.name === '' || element.value.trim() !== '') continue
      element.disabled = true
      disabled.push(element)
    }
    window.setTimeout(() => {
      for (const element of disabled) element.disabled = false
    }, 0)
  }

  const activeTypes = engagementTypes.filter(
    (type) => type.is_active || type.id === filters.engagementTypeId,
  )

  // Six expanded selects above the list is the "too many visible fields" the
  // redesign set out to remove, so everything but Search starts folded away —
  // unless one of the hidden filters is already applied, which must stay
  // visible to explain why the list looks thinned out.
  //
  // Computed here rather than imported from the query module: that module is
  // `server-only`, and importing its helper would drag it into the client
  // bundle.
  const narrowed = Boolean(
    filters.ownerId ||
      filters.engagementTypeId ||
      filters.lifecycleStage ||
      filters.status ||
      filters.tag ||
      filters.sort !== 'recent',
  )
  const [filtersOpen, setFiltersOpen] = useState(narrowed)

  return (
    <form
      method="get"
      action="/contacts"
      role="search"
      aria-label="Filter contacts"
      onSubmit={dropEmptyValues}
      className="rounded-xl border border-slate-200/70 bg-white p-4 shadow-card sm:p-5"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400"
          />
          <label htmlFor={searchId} className="sr-only">
            Search contacts by name, email, phone or organisation
          </label>
          <Input
            id={searchId}
            name="q"
            type="search"
            defaultValue={filters.q ?? ''}
            placeholder="Search by name, email, phone or organisation…"
            className="h-12 rounded-lg pl-11 pr-4 text-base sm:py-2.5 sm:text-base"
          />
        </div>

        <div className="flex gap-2">
          <Button
            type="button"
            variant="secondary"
            size="lg"
            className="flex-1 sm:flex-none"
            aria-expanded={filtersOpen}
            aria-controls="contact-filters-more"
            onClick={() => setFiltersOpen((open) => !open)}
          >
            {filtersOpen ? 'Hide filters' : 'Filters'}
          </Button>
          <Button type="submit" size="lg" className="flex-1 sm:flex-none sm:px-7">
            Search
          </Button>
        </div>
      </div>

      <div
        id="contact-filters-more"
        hidden={!filtersOpen}
        className="mt-4 border-t border-slate-200/70 pt-4"
      >
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            Refine
          </p>
          <Link href="/contacts" className="text-xs font-medium text-slate-500 hover:text-brand-700 hover:underline">
            Clear all filters
          </Link>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <Field label="Owner">
            {(props) => (
              <Select {...props} name="owner" defaultValue={filters.ownerId ?? ''}>
                <option value="">Anyone</option>
                {team.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field label="Engagement">
            {(props) => (
              <Select {...props} name="type" defaultValue={filters.engagementTypeId ?? ''}>
                <option value="">Any engagement</option>
                {activeTypes.map((type) => (
                  <option key={type.id} value={type.id}>
                    {type.label}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field label="Lifecycle stage">
            {(props) => (
              <Select {...props} name="stage" defaultValue={filters.lifecycleStage ?? ''}>
                <option value="">Any stage</option>
                {LIFECYCLE_STAGES.map((stage) => (
                  <option key={stage} value={stage}>
                    {LIFECYCLE_STAGE_LABELS[stage]}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field label="Record status">
            {(props) => (
              <Select {...props} name="status" defaultValue={filters.status ?? ''}>
                <option value="">Any status</option>
                {CONTACT_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {CONTACT_STATUS_LABELS[status]}
                  </option>
                ))}
              </Select>
            )}
          </Field>

          <Field label="Tag">
            {(props) => (
              <Input
                {...props}
                name="tag"
                defaultValue={filters.tag ?? ''}
                placeholder="e.g. board"
              />
            )}
          </Field>

          <Field label="Sort by">
            {(props) => (
              <Select
                {...props}
                name="sort"
                defaultValue={filters.sort === 'recent' ? '' : filters.sort}
              >
                <option value="">{SORT_LABELS.recent}</option>
                <option value="name">{SORT_LABELS.name}</option>
                <option value="created">{SORT_LABELS.created}</option>
              </Select>
            )}
          </Field>
        </div>

        {/* Below `sm` the Search button sits a screen above the last select,
            so the collapsed panel carries its own submit. */}
        <div className="mt-4 sm:hidden">
          <Button type="submit" size="md" className="w-full">
            Apply filters
          </Button>
        </div>
      </div>
    </form>
  )
}
