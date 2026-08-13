'use client'

import { useEffect, useId, useRef, useState } from 'react'
import { useFormStatus } from 'react-dom'
import { Button } from '@/components/ui/button'
import { Avatar, Badge, Callout } from '@/components/ui/display'
import { Checkbox, Field, Select } from '@/components/ui/form'
import { ROLE_DESCRIPTIONS, ROLE_LABELS } from '@/lib/permissions'
import type { TeamMemberDetail } from '@/lib/queries/team'
import { formatDate, formatDateTime, formatRelative } from '@/lib/utils'
import type { UserRole } from '@/types/database'
import { ROLES, ROLE_TONES } from './access'

export interface MemberRowProps {
  member: TeamMemberDetail
  /** Marks the signed-in administrator's own row, which behaves differently. */
  isSelf: boolean
  /** When 1, the database will refuse to demote or deactivate the last admin. */
  activeAdminCount: number
  /** Rendered once on the server so relative times match on hydration. */
  nowIso: string
  /** Owned by the roster, so one result region speaks for every row. */
  formAction: (formData: FormData) => void
  /** Changes when a save succeeds, which closes any open panel. */
  resetSignal: number
}

function SaveButton({ name }: { name: string }) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Saving…' : 'Save changes'}
      <span className="sr-only">: {name}</span>
    </Button>
  )
}

export function MemberRow({
  member,
  isSelf,
  activeAdminCount,
  nowIso,
  formAction,
  resetSignal,
}: MemberRowProps) {
  const [open, setOpen] = useState(false)
  const [role, setRole] = useState<UserRole>(member.role)
  const panelRef = useRef<HTMLDivElement>(null)
  const panelId = useId()

  useEffect(() => {
    if (!open) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open])

  // Move focus into the panel so a keyboard user is not left behind the button
  // that opened it.
  useEffect(() => {
    if (open) panelRef.current?.querySelector<HTMLElement>('select, input, button')?.focus()
  }, [open])

  useEffect(() => {
    setOpen(false)
  }, [resetSignal])

  const name = member.full_name?.trim() || member.email
  const lastAdmin = activeAdminCount <= 1 && member.role === 'admin' && member.is_active

  return (
    <li className="px-5 py-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 gap-3.5">
          <Avatar name={name} size="lg" className="mt-0.5" />
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <h3 className="text-[15px] font-semibold tracking-tight text-slate-900">{name}</h3>
              {isSelf ? <Badge tone="slate">You</Badge> : null}
              <Badge tone={ROLE_TONES[member.role]}>{ROLE_LABELS[member.role]}</Badge>
              {member.can_view_giving ? <Badge tone="emerald">Giving access</Badge> : null}
              {member.is_active ? null : <Badge tone="amber">Deactivated</Badge>}
            </div>

            <p className="truncate text-sm text-slate-600">
              {/* A persistent quiet underline: hover never happens on touch,
                  so the link has to declare itself. */}
              <a
                href={`mailto:${member.email}`}
                className="underline decoration-slate-300 underline-offset-2 hover:decoration-slate-500"
              >
                {member.email}
              </a>
            </p>

            {member.title ? <p className="text-xs text-slate-500">{member.title}</p> : null}

            <p className="text-xs text-slate-500">
              {member.last_seen_at ? (
                <>
                  Last seen{' '}
                  <time
                    dateTime={member.last_seen_at}
                    title={formatDateTime(member.last_seen_at)}
                  >
                    {formatRelative(member.last_seen_at, new Date(nowIso))}
                  </time>
                </>
              ) : (
                'Has not signed in yet'
              )}
              {' · Joined '}
              {/* Day precision only: the time of day is noise on a roster and
                  forces a mid-timestamp wrap on phones. */}
              <time dateTime={member.created_at} title={formatDateTime(member.created_at)}>
                {formatDate(member.created_at)}
              </time>
            </p>
          </div>
        </div>

        <Button
          type="button"
          variant="secondary"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-controls={open ? panelId : undefined}
          className="self-start"
        >
          {open ? 'Close' : 'Change access'}
          <span className="sr-only">: {name}</span>
        </Button>
      </div>

      {open ? (
        <form action={formAction}>
          <input type="hidden" name="id" value={member.id} />
          <div
            ref={panelRef}
            id={panelId}
            className="mt-4 space-y-4 rounded-lg border border-slate-200 bg-slate-100/60 p-4 sm:p-5"
          >
            <Field
              label={`Role for ${name}`}
              hint={ROLE_DESCRIPTIONS[role]}
              className="max-w-md"
            >
              {(props) => (
                <Select
                  {...props}
                  name="role"
                  value={role}
                  onChange={(event) => setRole(event.target.value as UserRole)}
                >
                  {ROLES.map((option) => (
                    <option key={option} value={option}>
                      {ROLE_LABELS[option]}
                    </option>
                  ))}
                </Select>
              )}
            </Field>

            <Checkbox
              name="can_view_giving"
              label={`${name} can see giving records`}
              hint="Administrators always see giving, whatever this is set to."
              defaultChecked={member.can_view_giving}
            />

            {/* Removing sign-in is the roster's most consequential action, so
                it gets its own section rather than blending into routine edits. */}
            <div className="space-y-3 border-t border-slate-200 pt-4">
              <h4 className="text-xs font-medium text-slate-500">
                Sign-in access
              </h4>
              <Checkbox
                name="is_active"
                label={`${name} can sign in`}
                hint="Deactivating keeps every record they created and can be undone. There is no delete."
                defaultChecked={member.is_active}
              />
            </div>

            {lastAdmin ? (
              <Callout tone="warning">
                This is the only active administrator. The database will refuse to change the role
                or sign-in access until someone else is an administrator.
              </Callout>
            ) : null}

            {isSelf ? (
              <Callout tone="warning">
                This is your own account. Lowering your role or turning off sign-in takes effect
                immediately and will remove your access to this page.
              </Callout>
            ) : null}

            <div className="flex flex-wrap gap-2">
              <SaveButton name={name} />
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
                <span className="sr-only">: {name}</span>
              </Button>
            </div>
          </div>
        </form>
      ) : null}
    </li>
  )
}
