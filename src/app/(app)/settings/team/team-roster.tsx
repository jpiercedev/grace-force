'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import { Callout } from '@/components/ui/display'
import type { TeamMemberDetail } from '@/lib/queries/team'
import type { TeamActionState } from './access'
import { MemberRow } from './member-row'
import { updateTeamMember } from './actions'

export interface TeamRosterProps {
  members: TeamMemberDetail[]
  currentUserId: string
  activeAdminCount: number
  /** Rendered once on the server so relative times match on hydration. */
  nowIso: string
}

/**
 * The roster and the one place its rows report back to.
 *
 * A single result region rather than one per row: saving collapses the panel
 * that was open, so a message anchored to that row would announce itself from
 * something that is no longer on screen. It takes focus instead, which also
 * matters for the refusal the database raises over the last administrator.
 */
export function TeamRoster({
  members,
  currentUserId,
  activeAdminCount,
  nowIso,
}: TeamRosterProps) {
  const [state, formAction] = useActionState<TeamActionState, FormData>(updateTeamMember, {})
  const [savedCount, setSavedCount] = useState(0)
  const statusRef = useRef<HTMLDivElement>(null)
  const message = state.error ?? state.notice

  useEffect(() => {
    if (message) statusRef.current?.focus()
  }, [state, message])

  useEffect(() => {
    if (state.notice) setSavedCount((count) => count + 1)
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
        {members.map((member) => (
          <MemberRow
            key={member.id}
            member={member}
            isSelf={member.id === currentUserId}
            activeAdminCount={activeAdminCount}
            nowIso={nowIso}
            formAction={formAction}
            resetSignal={savedCount}
          />
        ))}
      </ul>
    </div>
  )
}
