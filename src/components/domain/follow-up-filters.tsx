'use client'

import Link from 'next/link'
import { Button, LinkButton } from '@/components/ui/button'
import { Field, Select } from '@/components/ui/form'
import type { TeamProfile } from '@/lib/queries/follow-ups'
import { cn } from '@/lib/utils'
import {
  ASSIGNEE_ALL,
  ASSIGNEE_ME,
  ASSIGNEE_UNASSIGNED,
  FOLLOW_UP_PRIORITIES,
  FOLLOW_UP_SEGMENTS,
  PRIORITY_LABELS,
  SEGMENT_LABELS,
  type FollowUpSegment,
} from '@/lib/validation/follow-up'
import type { FollowUpPriority } from '@/types/database'

export interface FollowUpFiltersProps {
  segment: FollowUpSegment
  /** The raw filter value: a profile id or one of the sentinels. */
  assignee: string
  priority: FollowUpPriority | 'all'
  team: TeamProfile[]
}

/**
 * Segment tabs plus an assignee/priority filter.
 *
 * The filter is a plain GET form so it works without JavaScript and leaves the
 * current view in the URL — shareable, bookmarkable, and back-button friendly.
 * It is a Client Component only because `Field` takes a render prop, and a
 * function cannot cross the server/client boundary.
 */
export function FollowUpFilters({ segment, assignee, priority, team }: FollowUpFiltersProps) {
  function hrefFor(target: FollowUpSegment): string {
    const params = new URLSearchParams({ segment: target })
    if (assignee !== ASSIGNEE_ME) params.set('assignee', assignee)
    if (priority !== 'all') params.set('priority', priority)
    return `/follow-ups?${params.toString()}`
  }

  return (
    <div className="space-y-4">
      <nav aria-label="Follow-up segments">
        {/* Wrap rather than scroll: a scrolled row hides the last segment with
            no affordance that more exist. */}
        <ul className="-mx-1 flex flex-wrap gap-1.5 px-1">
          {FOLLOW_UP_SEGMENTS.map((option) => {
            const active = option === segment
            return (
              <li key={option}>
                <Link
                  href={hrefFor(option)}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'inline-flex whitespace-nowrap rounded-md px-3.5 py-2 text-sm font-medium transition-colors',
                    active
                      ? 'bg-brand-600 text-white'
                      : 'bg-white text-slate-600 ring-1 ring-inset ring-slate-300 hover:bg-slate-50',
                  )}
                >
                  {SEGMENT_LABELS[option]}
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>

      <form method="get" action="/follow-ups" className="flex flex-wrap items-end gap-3">
        <input type="hidden" name="segment" value={segment} />

        <Field label="Assignee" className="min-w-[10rem] flex-1 sm:w-60 sm:flex-none">
          {(props) => (
            <Select {...props} name="assignee" defaultValue={assignee}>
              <option value={ASSIGNEE_ME}>Assigned to me</option>
              <option value={ASSIGNEE_ALL}>Everyone</option>
              <option value={ASSIGNEE_UNASSIGNED}>Unassigned</option>
              {team.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.full_name?.trim() || member.email}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Field label="Priority" className="min-w-[9rem] flex-1 sm:w-44 sm:flex-none">
          {(props) => (
            <Select {...props} name="priority" defaultValue={priority}>
              <option value="all">Any priority</option>
              {FOLLOW_UP_PRIORITIES.map((option) => (
                <option key={option} value={option}>
                  {PRIORITY_LABELS[option]}
                </option>
              ))}
            </Select>
          )}
        </Field>

        <Button type="submit">Apply filters</Button>
        <LinkButton href={`/follow-ups?segment=${segment}`} variant="ghost">
          Clear
        </LinkButton>
      </form>
    </div>
  )
}
