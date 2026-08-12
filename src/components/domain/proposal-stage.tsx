'use client'

import { useActionState } from 'react'
import { FormError } from '@/components/domain/contact-form-controls'
import {
  PROPOSAL_STATUSES,
  PROPOSAL_STATUS_HINTS,
  PROPOSAL_STATUS_LABELS,
} from '@/components/domain/development-badges'
import { cn } from '@/lib/utils'
import type { ContactActionState } from '@/lib/validation/contact'
import type { ProposalRow, ProposalStatus } from '@/types/database'

/**
 * Moving a proposal along, without opening the edit form.
 *
 * Advancing a stage is the single most frequent change anyone makes to a
 * proposal, and routing it through a fifteen-field form was the kind of
 * friction that leaves a CRM permanently out of date.
 *
 * Each stage is its own one-button form carrying a hidden `status`, rather
 * than one form with six submit buttons: a submit button's `name`/`value` does
 * not survive a real-browser server-action POST, which is a fault this project
 * has already been bitten by. A hidden field always arrives.
 */
export function ProposalStage({
  proposal,
  action,
}: {
  proposal: ProposalRow
  action: (state: ContactActionState, formData: FormData) => Promise<ContactActionState>
}) {
  const [state, formAction] = useActionState<ContactActionState, FormData>(action, {})
  const currentIndex = PROPOSAL_STATUSES.indexOf(proposal.status)

  return (
    <div className="space-y-2">
      <FormError state={state} />
      <div
        role="group"
        aria-label="Move this proposal to a different stage"
        className="flex flex-wrap items-center gap-2"
      >
        {PROPOSAL_STATUSES.map((status: ProposalStatus, index) => {
          const current = status === proposal.status
          // Everything up to and including the current stage reads as done;
          // the rest is ahead. Colour is never the only signal — the current
          // stage also carries the ring and the aria-current.
          const behind = index < currentIndex
          const settled = status === 'funded' || status === 'declined'

          return (
            <form key={status} action={formAction}>
              <input type="hidden" name="proposal_id" value={proposal.id} />
              <input type="hidden" name="status" value={status} />
              <button
                type="submit"
                disabled={current}
                aria-current={current ? 'step' : undefined}
                title={PROPOSAL_STATUS_HINTS[status]}
                className={cn(
                  'rounded-full px-3.5 py-2 text-sm font-medium transition-colors disabled:cursor-default',
                  current
                    ? 'bg-brand-600 text-white ring-2 ring-brand-600 ring-offset-2 ring-offset-slate-50'
                    : behind
                      ? 'bg-brand-50 text-brand-800 hover:bg-brand-100'
                      : settled
                        ? 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                        : 'bg-white text-slate-700 ring-1 ring-slate-300 hover:bg-slate-100',
                )}
              >
                {PROPOSAL_STATUS_LABELS[status]}
              </button>
            </form>
          )
        })}
      </div>
      <p className="text-sm text-slate-600">{PROPOSAL_STATUS_HINTS[proposal.status]}</p>
    </div>
  )
}
