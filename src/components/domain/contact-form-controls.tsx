'use client'

import { useCallback, useEffect, useRef, useState, type ComponentProps } from 'react'
import { useFormStatus } from 'react-dom'
import { Button } from '@/components/ui/button'
import { Callout } from '@/components/ui/display'
import { Input } from '@/components/ui/form'
import type { ContactActionState } from '@/lib/validation/contact'

/**
 * The interactive pieces every form in this slice shares.
 *
 * `Field` from `@/components/ui/form` takes a render prop, so it can only be
 * used from a client component — which is why the forms below (and their
 * containers) are client components even where they have little behaviour.
 */

export interface Disclosure {
  open: boolean
  toggle: () => void
  close: () => void
  triggerRef: React.RefObject<HTMLButtonElement | null>
}

/**
 * A show/hide panel that closes on Escape and hands focus back to the button
 * that opened it.
 *
 * `hash` links it to a quick action in the page header: those are plain
 * anchors, so following one opens the panel it points at instead of scrolling
 * to a collapsed button.
 */
export function useDisclosure({ hash }: { hash?: string } = {}): Disclosure {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)

  const close = useCallback(() => {
    setOpen(false)
    triggerRef.current?.focus()
    if (hash && window.location.hash === `#${hash}`) {
      // Clearing the hash lets the same quick action reopen the panel later;
      // otherwise the link would not change the URL and nothing would happen.
      window.history.replaceState(null, '', window.location.pathname + window.location.search)
    }
  }, [hash])

  const toggle = useCallback(() => setOpen((value) => !value), [])

  useEffect(() => {
    if (!open) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      setOpen(false)
      triggerRef.current?.focus()
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [open])

  useEffect(() => {
    if (!hash) return
    const target = `#${hash}`
    function sync() {
      if (window.location.hash === target) setOpen(true)
    }
    sync()
    window.addEventListener('hashchange', sync)
    return () => window.removeEventListener('hashchange', sync)
  }, [hash])

  return { open, toggle, close, triggerRef }
}

/** Collapses the panel once the action reports success, so the list below can be read. */
export function useCloseOnSuccess(state: ContactActionState, close: () => void): void {
  useEffect(() => {
    if (state.ok) close()
    // `state` is a fresh object per submission, so reopening the panel by hand
    // does not immediately re-trigger this.
  }, [state, close])
}

export function SubmitButton({
  children,
  pendingLabel = 'Saving…',
  variant = 'primary',
  size = 'md',
  className,
}: {
  children: React.ReactNode
  pendingLabel?: string
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger'
  size?: 'sm' | 'md' | 'lg'
  className?: string
}) {
  const { pending } = useFormStatus()
  return (
    <Button type="submit" variant={variant} size={size} className={className} disabled={pending}>
      {pending ? pendingLabel : children}
    </Button>
  )
}

export function FormError({ state }: { state: ContactActionState }) {
  if (!state.error) return null
  return (
    <Callout tone="danger" role="alert">
      {state.error}
    </Callout>
  )
}

/**
 * `datetime-local` submits wall-clock time with no zone, so the server cannot
 * tell 2pm Central from 2pm UTC. This ships the browser's offset alongside it.
 * The value is read after mount because rendering it on the server would
 * produce a different string and trip a hydration mismatch.
 */
export function TimezoneOffsetField() {
  const [offset, setOffset] = useState(0)
  useEffect(() => setOffset(new Date().getTimezoneOffset()), [])
  return <input type="hidden" name="tz_offset" value={offset} readOnly />
}

function toDateTimeLocal(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  )
}

/**
 * A `datetime-local` input that seeds itself with a sensible local default
 * after mount, for the same hydration reason as the offset field above.
 */
export function LocalDateTimeInput({
  daysAhead = 0,
  hour,
  ...props
}: ComponentProps<'input'> & { daysAhead?: number; hour?: number; invalid?: boolean }) {
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const input = ref.current
    if (!input || input.value !== '') return
    const seed = new Date()
    seed.setDate(seed.getDate() + daysAhead)
    if (hour !== undefined) seed.setHours(hour, 0, 0, 0)
    input.value = toDateTimeLocal(seed)
  }, [daysAhead, hour])

  return <Input {...props} ref={ref} type="datetime-local" />
}

/**
 * Who can be offered as an owner. Viewers cannot act on a relationship and
 * deactivated staff should not collect new ones — but whoever already owns the
 * record stays selectable, so editing an unrelated field cannot quietly
 * reassign it.
 */
export function ownerOptions<T extends { id: string; role: string; is_active: boolean }>(
  team: readonly T[],
  currentId: string | null,
): T[] {
  return team.filter((member) => (member.is_active && member.role !== 'viewer') || member.id === currentId)
}
