'use client'

import Link from 'next/link'
import type { FormEvent } from 'react'
import { Button, buttonClasses } from '@/components/ui/button'
import { Field, Input, Select } from '@/components/ui/form'
import type { GivingFilters as Filters, GivingRange } from '@/lib/queries/giving'

/**
 * A plain GET form: the URL stays the single source of truth, so a report can
 * be bookmarked and shared. It is a client component because `Field` takes a
 * render prop and because empty controls are dropped from the query string.
 */
export function GivingFilters({
  filters,
  range,
  funds,
}: {
  filters: Filters
  /** The resolved window, so the date inputs show what is actually being reported. */
  range: GivingRange
  funds: string[]
}) {
  // Empty controls are disabled for the duration of the submit so they are left
  // out of the query string; `?from=&to=&fund=` is unreadable when shared.
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

  return (
    <form
      method="get"
      action="/giving"
      aria-label="Filter giving"
      onSubmit={dropEmptyValues}
      className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="From" hint="Defaults to twelve months ago.">
          {(props) => <Input {...props} name="from" type="date" defaultValue={range.from} />}
        </Field>

        <Field label="To" hint="Defaults to today.">
          {(props) => <Input {...props} name="to" type="date" defaultValue={range.to} />}
        </Field>

        <Field label="Fund">
          {(props) => (
            <Select {...props} name="fund" defaultValue={filters.fund ?? ''}>
              <option value="">All funds</option>
              {funds.map((fund) => (
                <option key={fund} value={fund}>
                  {fund}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm">
          Apply
        </Button>
        <Link href="/giving" className={buttonClasses('ghost', 'sm')}>
          Reset
        </Link>
      </div>
    </form>
  )
}
