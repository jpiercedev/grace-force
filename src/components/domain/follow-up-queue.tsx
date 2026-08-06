'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import type { FollowUpActionState } from '@/app/(app)/follow-ups/actions'
import { FollowUpRow } from '@/components/domain/follow-up-row'
import { Callout } from '@/components/ui/display'
import type { FollowUpQueueItem, TeamProfile } from '@/lib/queries/follow-ups'

export interface FollowUpQueueProps {
  items: FollowUpQueueItem[]
  team: TeamProfile[]
  canEdit: boolean
  /**
   * The instant the page was rendered. Passing it in keeps "overdue" and the
   * relative labels identical on the server and on hydration.
   */
  nowIso: string
  action: (prev: FollowUpActionState, formData: FormData) => Promise<FollowUpActionState>
}

/**
 * The queue list, plus the one place its rows report back to.
 *
 * Completing or snoozing a follow-up usually moves it out of the segment being
 * viewed, so the row that was acted on is gone by the time there is anything to
 * say — and the keyboard focus went with it. The result therefore lives here,
 * above the list, and takes focus so the outcome is announced rather than
 * silently swallowed.
 */
export function FollowUpQueue({ items, team, canEdit, nowIso, action }: FollowUpQueueProps) {
  const [state, formAction] = useActionState<FollowUpActionState, FormData>(action, {})
  const [resolvedCount, setResolvedCount] = useState(0)
  const statusRef = useRef<HTMLDivElement>(null)
  const message = state.error ?? state.notice

  useEffect(() => {
    if (message) statusRef.current?.focus()
  }, [state, message])

  // A row that stays on screen should not be left holding an open confirmation
  // panel once its action has gone through.
  useEffect(() => {
    if (state.notice) setResolvedCount((count) => count + 1)
  }, [state])

  return (
    <div>
      {message ? (
        <div ref={statusRef} tabIndex={-1} className="px-4 pt-4 sm:px-5">
          <Callout
            tone={state.error ? 'danger' : 'success'}
            role={state.error ? 'alert' : 'status'}
          >
            {message}
          </Callout>
        </div>
      ) : null}

      <ul className="divide-y divide-slate-200">
        {items.map((item) => (
          <FollowUpRow
            key={item.id}
            item={item}
            team={team}
            canEdit={canEdit}
            nowIso={nowIso}
            formAction={formAction}
            resetSignal={resolvedCount}
          />
        ))}
      </ul>
    </div>
  )
}
