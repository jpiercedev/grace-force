'use client'

import { useActionState, useEffect, useRef, useState } from 'react'
import {
  EngagementStatusBadge,
  EngagementTypeBadge,
} from '@/components/domain/contact-badges'
import { FormError, SubmitButton, useDisclosure } from '@/components/domain/contact-form-controls'
import { EngagementForm } from '@/components/domain/engagement-form'
import { Button } from '@/components/ui/button'
import { Card, CardBody, CardHeader, EmptyState } from '@/components/ui/display'
import { Field, Input } from '@/components/ui/form'
import type { ContactEngagement, TeamMember } from '@/lib/queries/contacts'
import { formatDate } from '@/lib/utils'
import type { ContactActionState } from '@/lib/validation/contact'
import type { EngagementTypeRow } from '@/types/database'

export interface EngagementActions {
  add: (state: ContactActionState, formData: FormData) => Promise<ContactActionState>
  update: (state: ContactActionState, formData: FormData) => Promise<ContactActionState>
  end: (state: ContactActionState, formData: FormData) => Promise<ContactActionState>
}

/**
 * The engagements a contact holds — donor, volunteer, prayer partner — with
 * add, edit and end inline.
 *
 * None of these write a timeline entry: `engagements_log_activity` already
 * posts `engagement_started` and `engagement_changed`, so doing it here would
 * show every change twice.
 */
export function EngagementPanel({
  contactId,
  engagements,
  engagementTypes,
  team,
  canEdit,
  today,
  actions,
}: {
  contactId: string
  engagements: ContactEngagement[]
  engagementTypes: EngagementTypeRow[]
  team: TeamMember[]
  canEdit: boolean
  today: string
  actions: EngagementActions
}) {
  const disclosure = useDisclosure({ hash: 'add-engagement' })

  return (
    <Card id="add-engagement">
      <CardHeader
        title="Engagements"
        description="How this contact relates to the ministry."
        action={
          canEdit ? (
            <Button
              ref={disclosure.triggerRef}
              type="button"
              variant={disclosure.open ? 'ghost' : 'secondary'}
              size="sm"
              onClick={disclosure.toggle}
              aria-expanded={disclosure.open}
              aria-controls={disclosure.open ? 'add-engagement-panel' : undefined}
            >
              {disclosure.open ? 'Cancel' : 'Add'}
            </Button>
          ) : null
        }
      />

      {disclosure.open ? (
        // A tinted zone, not a nested card — docs/DESIGN.md.
        <CardBody id="add-engagement-panel" className="border-b border-slate-200 bg-slate-100/50">
          <EngagementForm
            action={actions.add}
            contactId={contactId}
            engagementTypes={engagementTypes}
            team={team}
            today={today}
            submitLabel="Add engagement"
            onDone={disclosure.close}
          />
        </CardBody>
      ) : null}

      {engagements.length === 0 ? (
        <EmptyState
          title="No engagements yet"
          description="Add one to record how this person is involved."
        />
      ) : (
        <ul className="divide-y divide-slate-100">
          {engagements.map((engagement) => (
            <EngagementRow
              key={engagement.id}
              contactId={contactId}
              engagement={engagement}
              engagementTypes={engagementTypes}
              team={team}
              canEdit={canEdit}
              today={today}
              actions={actions}
            />
          ))}
        </ul>
      )}
    </Card>
  )
}

type Panel = 'edit' | 'end' | null

function EngagementRow({
  contactId,
  engagement,
  engagementTypes,
  team,
  canEdit,
  today,
  actions,
}: {
  contactId: string
  engagement: ContactEngagement
  engagementTypes: EngagementTypeRow[]
  team: TeamMember[]
  canEdit: boolean
  today: string
  actions: EngagementActions
}) {
  const [panel, setPanel] = useState<Panel>(null)
  const [endState, endAction] = useActionState<ContactActionState, FormData>(actions.end, {})
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!panel) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setPanel(null)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [panel])

  // Follow the disclosure with focus, so a keyboard user is not left above it.
  useEffect(() => {
    if (!panel) return
    panelRef.current?.querySelector<HTMLElement>('select, input, textarea, button')?.focus()
  }, [panel])

  useEffect(() => {
    if (endState.ok) setPanel(null)
  }, [endState])

  const live = engagement.status !== 'ended'
  const label = engagement.type?.label ?? 'Engagement'

  return (
    <li className="px-5 py-3.5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <EngagementTypeBadge label={label} color={engagement.type?.color ?? null} />
            <EngagementStatusBadge status={engagement.status} />
          </div>
          {engagement.role_detail ? (
            <p className="text-sm text-slate-700">{engagement.role_detail}</p>
          ) : null}
          <p className="text-xs text-slate-500">
            Since {formatDate(engagement.started_on)}
            {engagement.ended_on ? ` · ended ${formatDate(engagement.ended_on)}` : ''}
            {engagement.owner ? ` · ${engagement.owner.name}` : ' · unassigned'}
          </p>
          {engagement.notes ? (
            <p className="whitespace-pre-wrap break-words text-xs text-slate-600">
              {engagement.notes}
            </p>
          ) : null}
        </div>

        {canEdit ? (
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setPanel(panel === 'edit' ? null : 'edit')}
              aria-expanded={panel === 'edit'}
            >
              Edit
              <span className="sr-only"> {label} engagement</span>
            </Button>
            {live ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setPanel(panel === 'end' ? null : 'end')}
                aria-expanded={panel === 'end'}
              >
                End
                <span className="sr-only"> {label} engagement</span>
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>

      {panel ? (
        <div ref={panelRef} className="mt-3 rounded-lg bg-slate-100/70 p-4">
          {panel === 'edit' ? (
            <EngagementForm
              action={actions.update}
              contactId={contactId}
              engagement={engagement}
              engagementTypes={engagementTypes}
              team={team}
              today={today}
              submitLabel="Save engagement"
              onDone={() => setPanel(null)}
            />
          ) : (
            <form action={endAction} className="space-y-3" noValidate>
              <input type="hidden" name="contact_id" value={contactId} />
              <input type="hidden" name="engagement_id" value={engagement.id} />

              <FormError state={endState} />

              <p className="text-sm text-slate-700">
                Ending this keeps it on the record as history, and frees the contact to hold a new{' '}
                {label.toLowerCase()} engagement later.
              </p>

              {/* Status and date move together, or the check constraint rejects it. */}
              <Field label="Ended on" required error={endState.fieldErrors?.ended_on}>
                {(props) => (
                  <Input
                    {...props}
                    name="ended_on"
                    type="date"
                    required
                    defaultValue={today}
                    min={engagement.started_on}
                    invalid={!!endState.fieldErrors?.ended_on}
                  />
                )}
              </Field>

              <div className="flex flex-wrap gap-2">
                <SubmitButton variant="danger" size="sm" pendingLabel="Ending…">
                  End engagement
                </SubmitButton>
                <Button type="button" variant="ghost" size="sm" onClick={() => setPanel(null)}>
                  Keep it
                </Button>
              </div>
            </form>
          )}
        </div>
      ) : null}
    </li>
  )
}
