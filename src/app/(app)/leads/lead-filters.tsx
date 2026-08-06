'use client'

import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Field, Select } from '@/components/ui/form'
import {
  ASSIGNEE_ANYONE,
  ASSIGNEE_ME,
  ASSIGNEE_UNASSIGNED,
  LEAD_STATUSES,
  LEAD_STATUS_LABELS,
  STATUS_ANY,
  type LeadStatusFilter,
} from '@/lib/leads/triage'
import type { TeamProfile } from '@/lib/queries/follow-ups'
import { cn, pluralize } from '@/lib/utils'
import type { LeadStatus } from '@/types/database'

export interface LeadFiltersProps {
  status: LeadStatusFilter
  /** The raw filter value: a profile id or one of the sentinels. */
  assignee: string
  team: TeamProfile[]
  counts: Record<LeadStatus, number>
}

const TAB_ORDER: LeadStatusFilter[] = [...LEAD_STATUSES, STATUS_ANY]

/**
 * Status tabs plus an assignee filter.
 *
 * A plain GET form, so the current view lives in the URL — shareable between
 * two people triaging the same queue, and survivable by the back button. It is
 * a Client Component only because `Field` takes a render prop, which cannot
 * cross the server/client boundary.
 */
export function LeadFilters({ status, assignee, team, counts }: LeadFiltersProps) {
  function hrefFor(target: LeadStatusFilter): string {
    const params = new URLSearchParams({ status: target })
    if (assignee !== ASSIGNEE_ANYONE) params.set('assignee', assignee)
    return `/leads?${params.toString()}`
  }

  return (
    <div className="space-y-4">
      <nav aria-label="Lead statuses">
        {/* Wrapping beats horizontal scroll here: a clipped chip row hides
            whole statuses on a phone with no cue that more exist. */}
        <ul className="flex flex-wrap gap-1.5">
          {TAB_ORDER.map((option) => {
            const active = option === status
            const label = option === STATUS_ANY ? 'All' : LEAD_STATUS_LABELS[option]
            const count = option === STATUS_ANY ? null : counts[option]
            return (
              <li key={option}>
                <Link
                  href={hrefFor(option)}
                  aria-current={active ? 'page' : undefined}
                  // Starts with the visible label, so the accessible name still
                  // contains what is on screen.
                  aria-label={count === null ? undefined : `${label}, ${pluralize(count, 'lead')}`}
                  className={cn(
                    'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors duration-150',
                    active
                      ? 'bg-brand-600 text-white shadow-sm'
                      : 'bg-white text-slate-600 shadow-sm hover:bg-slate-100 hover:text-slate-900',
                  )}
                >
                  {label}
                  {count === null ? null : (
                    <span
                      aria-hidden="true"
                      className={cn(
                        'rounded-full px-1.5 text-xs tabular-nums',
                        active ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-500',
                      )}
                    >
                      {count}
                    </span>
                  )}
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>

      <form method="get" action="/leads" className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="status" value={status} />

        <Field label="Assigned to" className="w-full sm:w-64">
          {(props) => (
            <Select {...props} name="assignee" defaultValue={assignee}>
              <option value={ASSIGNEE_ANYONE}>Anyone</option>
              <option value={ASSIGNEE_ME}>Me</option>
              <option value={ASSIGNEE_UNASSIGNED}>Nobody yet</option>
              {team.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.full_name?.trim() || member.email}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Button type="submit" variant="secondary">
          Apply filter
        </Button>
      </form>
    </div>
  )
}
