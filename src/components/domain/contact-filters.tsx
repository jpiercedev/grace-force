'use client'

import Link from 'next/link'
import type { FormEvent } from 'react'
import {
  CONTACT_STATUS_LABELS,
  LIFECYCLE_STAGE_LABELS,
} from '@/components/domain/contact-badges'
import { Button, buttonClasses } from '@/components/ui/button'
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

  return (
    <form
      method="get"
      action="/contacts"
      role="search"
      aria-label="Filter contacts"
      onSubmit={dropEmptyValues}
      className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field
          label="Search"
          hint="Name, email, phone or organisation."
          className="sm:col-span-2 lg:col-span-1"
        >
          {(props) => (
            <Input
              {...props}
              name="q"
              type="search"
              defaultValue={filters.q ?? ''}
              placeholder="Search contacts"
            />
          )}
        </Field>

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
            <Input {...props} name="tag" defaultValue={filters.tag ?? ''} placeholder="e.g. board" />
          )}
        </Field>

        <Field label="Sort by">
          {(props) => (
            <Select {...props} name="sort" defaultValue={filters.sort === 'recent' ? '' : filters.sort}>
              <option value="">{SORT_LABELS.recent}</option>
              <option value="name">{SORT_LABELS.name}</option>
              <option value="created">{SORT_LABELS.created}</option>
            </Select>
          )}
        </Field>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm">
          Apply filters
        </Button>
        <Link href="/contacts" className={buttonClasses('ghost', 'sm')}>
          Clear
        </Link>
      </div>
    </form>
  )
}
