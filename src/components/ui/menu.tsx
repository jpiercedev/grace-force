'use client'

import Link from 'next/link'
import { MoreHorizontal } from 'lucide-react'
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * The overflow menu.
 *
 * Its whole reason for existing is the brief's "do not display five equally
 * prominent buttons": a donor record has one primary action, one secondary,
 * and then six more that matter occasionally. Those six go here.
 *
 * Kept deliberately plain — a labelled button, a list of links and buttons,
 * Escape and click-outside to close. No roving tabindex, no `role="menu"`:
 * a menu role would make arrow keys the *only* way to move between items,
 * which is worse for the audience this product has than ordinary Tab.
 */
export function ActionMenu({
  label = 'More actions',
  children,
  align = 'right',
}: {
  label?: string
  children: ReactNode
  align?: 'left' | 'right'
}) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelId = useId()

  useEffect(() => {
    if (!open) return

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      setOpen(false)
      triggerRef.current?.focus()
    }
    function onPointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    // Tabbing past the last item should close it rather than leaving an open
    // panel floating over content the caret has already left.
    function onFocusIn(event: FocusEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }

    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('focusin', onFocusIn)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('focusin', onFocusIn)
    }
  }, [open])

  return (
    <div ref={containerRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={label}
        className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-600 shadow-card transition-colors hover:bg-slate-50 hover:text-slate-900"
      >
        <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
      </button>

      {open ? (
        <div
          id={panelId}
          className={cn(
            'absolute z-30 mt-1 w-56 overflow-hidden rounded-md border border-slate-200 bg-white py-1 shadow-raised',
            'animate-fade-in motion-reduce:animate-none',
            align === 'right' ? 'right-0' : 'left-0',
          )}
          onClick={() => setOpen(false)}
        >
          {children}
        </div>
      ) : null}
    </div>
  )
}

const ITEM =
  'flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm text-slate-700 transition-colors hover:bg-slate-100 hover:text-slate-900'

export function ActionMenuLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className={ITEM}>
      {children}
    </Link>
  )
}

export function ActionMenuButton({
  onClick,
  children,
  tone = 'default',
}: {
  onClick: () => void
  children: ReactNode
  tone?: 'default' | 'danger'
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(ITEM, tone === 'danger' && 'text-red-700 hover:bg-red-50 hover:text-red-800')}
    >
      {children}
    </button>
  )
}

export function ActionMenuDivider() {
  return <div className="my-1 border-t border-slate-200" role="presentation" />
}
