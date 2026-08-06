'use client'

import Link from 'next/link'
import { useEffect, useId, useRef, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { Button, type ButtonProps } from '@/components/ui/button'
import { Badge } from '@/components/ui/display'
import { Field, Select } from '@/components/ui/form'
import {
  LEAD_STATUS_LABELS,
  LEAD_STATUS_TONES,
  STATUS_ANY,
  interestLabel,
  leadDisplayName,
  type LeadStatusFilter,
} from '@/lib/leads/triage'
import type { LeadQueueItem } from '@/lib/leads/queries'
import type { TeamProfile } from '@/lib/queries/follow-ups'
import { contactDisplayName, formatDateTime, formatRelative, truncate } from '@/lib/utils'
import type { Json } from '@/types/database'

type Panel = 'assign' | 'convert' | null

export interface LeadRowProps {
  lead: LeadQueueItem
  team: TeamProfile[]
  /** The queue's active status filter, so a row can skip repeating it. */
  statusFilter: LeadStatusFilter
  /** Rendered once on the server so the relative age matches on hydration. */
  nowIso: string
  /** Owned by the queue, which outlives a row leaving the current status. */
  formAction: (formData: FormData) => void
  /** Changes when an action succeeds, which closes any open panel. */
  resetSignal: number
}

function SubmitButton({ children, ...props }: ButtonProps) {
  const { pending } = useFormStatus()
  return (
    <Button {...props} type="submit" disabled={pending}>
      {children}
    </Button>
  )
}

/**
 * Folds the lead's name into a button's accessible name. Twenty rows otherwise
 * present twenty buttons all called "Spam", which is unusable from a screen
 * reader's element list.
 */
function Subject({ name }: { name: string }) {
  return <span className="sr-only">: {name}</span>
}

/** Campaign parameters, when the form carried any. */
function utmSummary(utm: Json): string | null {
  if (!utm || typeof utm !== 'object' || Array.isArray(utm)) return null
  const parts = Object.entries(utm)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    .map(([key, value]) => `${key.replace(/^utm_/, '')}: ${value}`)
  return parts.length > 0 ? parts.join(' · ') : null
}

export function LeadRow({ lead, team, statusFilter, nowIso, formAction, resetSignal }: LeadRowProps) {
  const [panel, setPanel] = useState<Panel>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const panelId = useId()

  // Anything that opens closes on Escape.
  useEffect(() => {
    if (!panel) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setPanel(null)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [panel])

  // Move focus into the panel so a keyboard user is not left behind the button.
  useEffect(() => {
    if (!panel) return
    panelRef.current?.querySelector<HTMLElement>('select, button')?.focus()
  }, [panel])

  useEffect(() => {
    setPanel(null)
  }, [resetSignal])

  const now = new Date(nowIso)
  const name = leadDisplayName(lead)
  const interest = interestLabel(lead.interest)
  const campaign = utmSummary(lead.utm)
  const assigneeName = lead.assignee
    ? lead.assignee.full_name?.trim() || lead.assignee.email
    : 'Nobody yet'
  const converted = lead.status === 'converted'
  // Under a single-status filter every row would repeat the badge the card
  // heading already announces; it only differentiates on the mixed "All" view.
  const showStatusBadge = statusFilter === STATUS_ANY || lead.status !== statusFilter

  return (
    <li className="px-4 py-4">
      <form action={formAction} className="space-y-3">
        <input type="hidden" name="id" value={lead.id} />

        <div className="flex flex-col gap-3">
          <div className="min-w-0 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm font-semibold text-slate-900">{name}</h3>
              {showStatusBadge ? (
                <Badge tone={LEAD_STATUS_TONES[lead.status]}>
                  {LEAD_STATUS_LABELS[lead.status]}
                </Badge>
              ) : null}
              {interest ? <Badge tone="indigo">{interest}</Badge> : null}
            </div>

            <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-sm text-slate-600">
              {lead.email ? (
                <a href={`mailto:${lead.email}`} className="truncate hover:underline">
                  {lead.email}
                </a>
              ) : null}
              {lead.phone ? (
                <a href={`tel:${lead.phone}`} className="whitespace-nowrap hover:underline">
                  {lead.phone}
                </a>
              ) : null}
              {lead.organization_name ? <span>{lead.organization_name}</span> : null}
            </div>

            {lead.message ? (
              <p className="whitespace-pre-wrap break-words text-sm text-slate-700">
                {truncate(lead.message, 600)}
              </p>
            ) : (
              <p className="text-sm italic text-slate-500">No message left.</p>
            )}

            <p className="text-xs text-slate-500">
              via <span className="font-medium text-slate-600">{lead.form_key}</span> ·{' '}
              <time dateTime={lead.created_at} title={formatDateTime(lead.created_at)}>
                {formatRelative(lead.created_at, now)}
              </time>{' '}
              · Assigned to {assigneeName}
            </p>

            {campaign ? <p className="text-xs text-slate-500">{campaign}</p> : null}

            {lead.page_url ? (
              <p className="truncate text-xs text-slate-500">
                <a
                  href={lead.page_url}
                  rel="noreferrer nofollow"
                  target="_blank"
                  className="hover:underline"
                >
                  {lead.page_url}
                </a>
              </p>
            ) : null}

            {converted && lead.contact_id ? (
              <p className="text-xs text-slate-600">
                Converted {formatDateTime(lead.converted_at)} ·{' '}
                <Link
                  href={`/contacts/${lead.contact_id}`}
                  className="font-medium text-brand-700 underline-offset-2 hover:underline"
                >
                  {lead.contact ? contactDisplayName(lead.contact) : 'View contact'}
                </Link>
              </p>
            ) : null}
          </div>

          {converted ? null : (
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                onClick={() => setPanel(panel === 'convert' ? null : 'convert')}
                aria-expanded={panel === 'convert'}
                aria-controls={panel === 'convert' ? panelId : undefined}
              >
                Convert
                <Subject name={name} />
              </Button>

              <SubmitButton name="intent" value="assign_to_me" variant="secondary" size="sm">
                Assign to me
                <Subject name={name} />
              </SubmitButton>

              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setPanel(panel === 'assign' ? null : 'assign')}
                aria-expanded={panel === 'assign'}
                aria-controls={panel === 'assign' ? panelId : undefined}
              >
                Assign to…
                <Subject name={name} />
              </Button>

              {lead.status === 'new' ? (
                <SubmitButton name="intent" value="mark_in_review" variant="secondary" size="sm">
                  In review
                  <Subject name={name} />
                </SubmitButton>
              ) : null}

              {lead.status === 'spam' || lead.status === 'archived' ? (
                <SubmitButton name="intent" value="reopen" variant="secondary" size="sm">
                  Reopen
                  <Subject name={name} />
                </SubmitButton>
              ) : (
                <>
                  <SubmitButton name="intent" value="mark_spam" variant="ghost" size="sm">
                    Spam
                    <Subject name={name} />
                  </SubmitButton>
                  <SubmitButton name="intent" value="archive" variant="ghost" size="sm">
                    Archive
                    <Subject name={name} />
                  </SubmitButton>
                </>
              )}
            </div>
          )}
        </div>

        {panel ? (
          <div
            ref={panelRef}
            id={panelId}
            className="space-y-3 rounded-md border border-slate-200 bg-slate-50 p-3"
          >
            {panel === 'assign' ? (
              <>
                <Field label="Assign to" className="max-w-sm">
                  {(props) => (
                    <Select {...props} name="assigned_to" defaultValue={lead.assigned_to ?? ''}>
                      <option value="">Nobody</option>
                      {team.map((member) => (
                        <option key={member.id} value={member.id}>
                          {member.full_name?.trim() || member.email}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <div className="flex flex-wrap gap-2">
                  <SubmitButton name="intent" value="assign" size="sm">
                    Save assignee
                    <Subject name={name} />
                  </SubmitButton>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setPanel(null)}>
                    Discard
                  </Button>
                </div>
              </>
            ) : null}

            {panel === 'convert' ? (
              <>
                <p className="text-sm text-slate-700">
                  Convert {name} into a contact? An existing contact with the same email is
                  reused rather than duplicated
                  {interest ? `, and a ${interest.toLowerCase()} engagement is started` : ''}.
                  You will be taken to the contact.
                </p>
                <div className="flex flex-wrap gap-2">
                  <SubmitButton name="intent" value="convert" size="sm">
                    Convert to contact
                    <Subject name={name} />
                  </SubmitButton>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setPanel(null)}>
                    Not yet
                  </Button>
                </div>
              </>
            ) : null}
          </div>
        ) : null}
      </form>
    </li>
  )
}
