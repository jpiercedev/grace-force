'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import { updateLead } from '@/app/(app)/leads/actions'
import { LeadRow } from '@/app/(app)/leads/lead-row'
import { Callout } from '@/components/ui/display'
import type { LeadActionState } from '@/lib/leads/triage'
import type { LeadQueueItem } from '@/lib/leads/queries'
import type { TeamProfile } from '@/lib/queries/follow-ups'

export interface LeadQueueProps {
  leads: LeadQueueItem[]
  team: TeamProfile[]
  /** Rendered once on the server so relative ages match on hydration. */
  nowIso: string
}

/**
 * The queue list and the one place its rows report back to.
 *
 * Triaging a lead almost always moves it out of the status being viewed, so the
 * row that was acted on — and the focus that was inside it — is gone by the
 * time there is anything to say. The outcome therefore lives above the list and
 * takes focus, rather than being announced from a row that no longer exists.
 */
export function LeadQueue({ leads, team, nowIso }: LeadQueueProps) {
  const [state, formAction] = useActionState<LeadActionState, FormData>(updateLead, {})
  const [resolvedCount, setResolvedCount] = useState(0)
  const statusRef = useRef<HTMLDivElement>(null)
  const message = state.error ?? state.notice

  useEffect(() => {
    if (message) statusRef.current?.focus()
  }, [state, message])

  // A row that stays on screen should not be left holding an open panel once
  // its action has gone through.
  useEffect(() => {
    if (state.notice) setResolvedCount((count) => count + 1)
  }, [state])

  return (
    <div>
      {message ? (
        <div ref={statusRef} tabIndex={-1} className="px-4 pt-4">
          <Callout tone={state.error ? 'danger' : 'success'} role={state.error ? 'alert' : 'status'}>
            {message}
          </Callout>
        </div>
      ) : null}

      <ul className="divide-y divide-slate-200">
        {leads.map((lead) => (
          <LeadRow
            key={lead.id}
            lead={lead}
            team={team}
            nowIso={nowIso}
            formAction={formAction}
            resetSignal={resolvedCount}
          />
        ))}
      </ul>
    </div>
  )
}
