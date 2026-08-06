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
  /**
   * How many items the current segment holds. Only the active segment's count
   * is known without extra queries, so only the active tab shows one.
   */
  activeCount?: number
}

/**
 * Segment tabs plus an assignee/priority filter.
 *
 * The filter is a plain GET form so it works without JavaScript and leaves the
 * current view in the URL — shareable, bookmarkable, and back-button friendly.
 * It is a Client Component only because `Field` takes a render prop, and a
 * function cannot cross the server/client boundary.
 */
export function FollowUpFilters({
  segment,
  assignee,
  priority,
  team,
  activeCount,
}: FollowUpFiltersProps) {
  function hrefFor(target: FollowUpSegment): string {
    const params = new URLSearchParams({ segment: target })
    if (assignee !== ASSIGNEE_ME) params.set('assignee', assignee)
    if (priority !== 'all') params.set('priority', priority)
    return `/follow-ups?${params.toString()}`
  }

  return (
    <div className="space-y-4">
      <nav aria-label="Follow-up segments">
        {/* One tonal track, one white pill: a segmented control rather than a
            row of disconnected buttons. It wraps rather than scrolls — a
            scrolled row hides the last segment with no affordance that more
            exist. */}
        <ul className="inline-flex max-w-full flex-wrap items-center gap-1 rounded-lg bg-slate-100 p-1 ring-1 ring-inset ring-slate-200/60">
          {FOLLOW_UP_SEGMENTS.map((option) => {
            const active = option === segment
            return (
              <li key={option}>
                <Link
                  href={hrefFor(option)}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'inline-flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-2 text-sm transition-colors duration-150',
                    active
                      ? 'bg-white font-semibold text-brand-800 shadow-sm'
                      : 'font-medium text-slate-600 hover:bg-white/60 hover:text-slate-900',
                  )}
                >
                  {SEGMENT_LABELS[option]}
                  {active && typeof activeCount === 'number' ? (
                    <span className="text-xs font-semibold tabular-nums text-slate-500">
                      {activeCount}
                    </span>
                  ) : null}
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

        {/* Tonal, not primary: applying a filter is housekeeping, and the one
            evergreen action on this page should stay "New follow-up". */}
        <Button type="submit" variant="secondary">
          Apply filters
        </Button>
        <LinkButton href={`/follow-ups?segment=${segment}`} variant="ghost">
          Clear
        </LinkButton>
      </form>
    </div>
  )
}
