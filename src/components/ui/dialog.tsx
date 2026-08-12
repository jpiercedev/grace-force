'use client'

import { X } from 'lucide-react'
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * The modal used for the workflows that must not cost a page load: logging an
 * interaction, linking a relative, recording an interest.
 *
 * Everything a modal has to get right is here rather than at each call site,
 * because "we forgot the focus trap on that one" is how a dialog becomes a
 * keyboard dead end:
 *
 * - focus moves in on open and returns to the trigger on close
 * - Escape closes it, and Tab cannot leave it
 * - the page behind is scroll-locked and `inert`-adjacent (pointer events are
 *   caught by the backdrop; the trap catches the keyboard)
 * - it is labelled by its own heading
 *
 * On phones it rises from the bottom as a sheet, which puts the controls under
 * the thumb instead of under the notch.
 */

export interface DialogController {
  open: boolean
  openDialog: () => void
  close: () => void
  /** Spread onto the element that opens it, so focus can return there. */
  triggerRef: React.RefObject<HTMLButtonElement | null>
}

export function useDialog(): DialogController {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)

  const close = useCallback(() => {
    setOpen(false)
    // Focus goes home. Without this the caret lands at the top of the document
    // and a keyboard user has to tab back through the whole page.
    triggerRef.current?.focus()
  }, [])

  return { open, openDialog: () => setOpen(true), close, triggerRef }
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

export function Dialog({
  controller,
  title,
  description,
  children,
  footer,
  formAction,
  wide = false,
}: {
  controller: DialogController
  title: string
  description?: ReactNode
  children: ReactNode
  footer?: ReactNode
  /**
   * When given, the body and footer are wrapped in one `<form>`. That matters:
   * the submit button lives in the pinned footer while the fields scroll in
   * the body, and `useFormStatus` only reports pending for a button *inside*
   * its form — a `form="…"` attribute across the boundary would leave the
   * button with no pending state at all.
   */
  formAction?: (formData: FormData) => void
  wide?: boolean
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const descriptionId = useId()
  const { open, close } = controller

  useEffect(() => {
    if (!open) return

    const panel = panelRef.current
    // First real control, not the panel itself: opening onto the close button
    // is disorienting, and opening onto nothing is worse.
    const first = panel?.querySelector<HTMLElement>(FOCUSABLE)
    first?.focus()

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.stopPropagation()
        close()
        return
      }
      if (event.key !== 'Tab' || !panel) return
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (element) => element.offsetParent !== null,
      )
      const firstElement = focusable[0]
      const lastElement = focusable[focusable.length - 1]
      if (!firstElement || !lastElement) return
      const active = document.activeElement
      if (event.shiftKey && (active === firstElement || !panel.contains(active))) {
        event.preventDefault()
        lastElement.focus()
      } else if (!event.shiftKey && (active === lastElement || !panel.contains(active))) {
        event.preventDefault()
        firstElement.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open, close])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      {/* tabIndex={-1}: click-outside stays, but Tab must not land on an
          invisible viewport-sized button. Escape and Cancel are the keyboard
          paths out. */}
      <button
        type="button"
        tabIndex={-1}
        aria-hidden="true"
        onClick={close}
        className="absolute inset-0 h-full w-full cursor-default bg-slate-950/40"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        className={cn(
          'relative flex max-h-[92dvh] w-full flex-col rounded-t-2xl bg-white shadow-raised',
          'animate-rise-in motion-reduce:animate-none sm:rounded-2xl',
          wide ? 'sm:max-w-3xl' : 'sm:max-w-lg',
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4 sm:px-6">
          <div className="min-w-0">
            <h2
              id={titleId}
              className="font-display text-xl font-semibold tracking-tight text-slate-900"
            >
              {title}
            </h2>
            {description ? (
              <p id={descriptionId} className="mt-1 text-sm leading-relaxed text-slate-600">
                {description}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="-mr-2 -mt-1 shrink-0 rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>

        <Body formAction={formAction} footer={footer}>
          {children}
        </Body>
      </div>
    </div>
  )
}

/**
 * The body scrolls, the header and footer do not: on a phone the save button
 * must stay reachable however long the form gets.
 */
function Body({
  formAction,
  footer,
  children,
}: {
  formAction?: (formData: FormData) => void
  footer?: ReactNode
  children: ReactNode
}) {
  const inner = (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">{children}</div>
      {footer ? (
        <div className="flex flex-wrap gap-2 border-t border-slate-200 bg-slate-50 px-5 py-4 sm:px-6">
          {footer}
        </div>
      ) : null}
    </>
  )

  if (!formAction) return <div className="flex min-h-0 flex-1 flex-col">{inner}</div>

  return (
    <form action={formAction} noValidate className="flex min-h-0 flex-1 flex-col">
      {inner}
    </form>
  )
}
