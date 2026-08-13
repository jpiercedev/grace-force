'use client'

import Link from 'next/link'
import {
  ACTIVITY_TYPE_LABELS,
  AUTOMATIC_ACTIVITY_TYPES,
  MANUAL_ACTIVITY_TYPES,
} from '@/components/domain/contact-badges'
import { Button, buttonClasses } from '@/components/ui/button'
import { Field, Select } from '@/components/ui/form'
import type { ActivityType } from '@/types/database'

/**
 * A GET form, like the contact list filters: the URL stays the source of truth
 * so a filtered timeline survives a reload and can be linked to.
 *
 * Only the type control (plus any pinned `hidden` params, like the tab) is
 * submitted, which drops any `show` parameter — the right behaviour, since a
 * narrowed timeline should start from the top again. A GET submit replaces
 * the action's own query string entirely, so anything that must survive has
 * to ride along as a hidden field.
 */
export function TimelineFilters({
  basePath,
  type,
  hidden = {},
}: {
  basePath: string
  type: ActivityType | null
  /** Query params to keep across a submit (e.g. { tab: 'activity' }). */
  hidden?: Record<string, string>
}) {
  const hiddenEntries = Object.entries(hidden)
  const clearQuery = new URLSearchParams(hidden).toString()
  const clearHref = clearQuery ? `${basePath}?${clearQuery}` : basePath

  return (
    <form
      method="get"
      action={basePath}
      className="flex flex-wrap items-end gap-2"
      aria-label="Filter the timeline"
    >
      {hiddenEntries.map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {/* max-w-xs: a short enum list does not earn the full card width. */}
      <Field label="Activity type" className="w-full max-w-xs">
        {(props) => (
          <Select {...props} name="type" defaultValue={type ?? ''}>
            <option value="">All activity</option>
            <optgroup label="Logged by staff">
              {MANUAL_ACTIVITY_TYPES.map((value) => (
                <option key={value} value={value}>
                  {ACTIVITY_TYPE_LABELS[value]}
                </option>
              ))}
            </optgroup>
            <optgroup label="Recorded automatically">
              {AUTOMATIC_ACTIVITY_TYPES.map((value) => (
                <option key={value} value={value}>
                  {ACTIVITY_TYPE_LABELS[value]}
                </option>
              ))}
            </optgroup>
          </Select>
        )}
      </Field>
      <Button type="submit" variant="secondary" size="sm">
        Filter
      </Button>
      {type ? (
        <Link href={clearHref} className={buttonClasses('ghost', 'sm')}>
          Clear
        </Link>
      ) : null}
    </form>
  )
}
