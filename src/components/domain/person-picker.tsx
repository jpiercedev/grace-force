'use client'

import { Search } from 'lucide-react'
import { useEffect, useId, useState, useTransition } from 'react'
import { findPeople, type PersonHit } from '@/app/(app)/contacts/find-people'
import { Avatar } from '@/components/ui/display'
import { Input, Label } from '@/components/ui/form'
import { cn } from '@/lib/utils'

/**
 * Choosing a person, without a combobox.
 *
 * The obvious pattern beats the clever one here: type a name, see up to eight
 * matches, choose one with a radio button. Radios are keyboard operable and
 * announced correctly by every screen reader with no ARIA at all, and the
 * chosen value posts with the form like any other field — so the surrounding
 * form stays a plain server-action form.
 *
 * Search runs 250ms after typing stops. Below two characters it does not run,
 * because every contact matching "a" is not a search result.
 */
export function PersonPicker({
  name,
  label,
  excludeId,
  error,
  hint,
  required,
}: {
  name: string
  label: string
  /** The contact whose page this is — never offer them as their own relative. */
  excludeId?: string
  error?: string
  hint?: string
  required?: boolean
}) {
  const [term, setTerm] = useState('')
  const [hits, setHits] = useState<PersonHit[]>([])
  const [searched, setSearched] = useState(false)
  const [pending, startTransition] = useTransition()
  const inputId = useId()
  const statusId = useId()

  useEffect(() => {
    const query = term.trim()
    if (query.length < 2) {
      setHits([])
      setSearched(false)
      return
    }
    const timer = setTimeout(() => {
      startTransition(async () => {
        setHits(await findPeople(query, excludeId))
        setSearched(true)
      })
    }, 250)
    return () => clearTimeout(timer)
  }, [term, excludeId])

  return (
    <div className="space-y-2">
      <Label htmlFor={inputId}>
        {label}
        {required ? (
          <span className="ml-0.5 text-red-600" aria-hidden="true">
            *
          </span>
        ) : null}
      </Label>
      <div className="relative">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500"
        />
        <Input
          id={inputId}
          type="search"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder="Start typing a name"
          autoComplete="off"
          aria-describedby={statusId}
          className="pl-9"
          invalid={!!error}
        />
      </div>
      {hint ? <p className="text-sm text-slate-500">{hint}</p> : null}

      {/* Announced politely so a screen reader hears the result count without
          the list stealing focus mid-typing. */}
      <p id={statusId} className="sr-only" role="status">
        {pending
          ? 'Searching'
          : searched
            ? `${hits.length} ${hits.length === 1 ? 'match' : 'matches'}`
            : ''}
      </p>

      {hits.length > 0 ? (
        <fieldset className="rounded-lg border border-slate-200">
          <legend className="sr-only">Choose a person</legend>
          <ul className="divide-y divide-slate-100">
            {hits.map((hit) => (
              <li key={hit.id}>
                <label
                  className={cn(
                    'flex cursor-pointer items-center gap-3 px-3 py-2.5',
                    'hover:bg-slate-50 has-[:checked]:bg-brand-50',
                  )}
                >
                  <input
                    type="radio"
                    name={name}
                    value={hit.id}
                    className="h-4 w-4 shrink-0 border-slate-400 text-brand-600 focus:ring-brand-500"
                  />
                  <Avatar name={hit.name} size="sm" />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-slate-900">
                      {hit.name}
                    </span>
                    {hit.detail ? (
                      <span className="block truncate text-xs text-slate-500">{hit.detail}</span>
                    ) : null}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
      ) : null}

      {searched && !pending && hits.length === 0 ? (
        <p className="text-sm text-slate-500">
          Nobody matches “{term.trim()}”. Check the spelling, or add them from People first.
        </p>
      ) : null}

      {error ? <p className="text-sm font-medium text-red-600">{error}</p> : null}
    </div>
  )
}
