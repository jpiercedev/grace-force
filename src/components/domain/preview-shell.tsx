'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef, type ReactNode } from 'react'

/**
 * The client half of the record preview: a fixed panel that closes on Escape
 * and takes focus when it opens, so a keyboard user is looking at what just
 * appeared instead of hunting for it.
 *
 * Deliberately non-modal — the point of a preview is glancing at a record
 * while the list stays where it is. The content itself is server-rendered
 * and arrives as children; this wrapper only owns dismissal.
 */
export function PreviewShell({
  closeHref,
  label,
  children,
}: {
  closeHref: string
  label: string
  children: ReactNode
}) {
  const router = useRouter()
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    panelRef.current?.focus({ preventScroll: true })
  }, [])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return
      // A dialog open above the preview owns Escape while it is up.
      // `stopPropagation` in its handler does not silence a second listener
      // on the same document node, so check for one instead of racing it.
      if (document.querySelector('[role="dialog"]')) return
      router.push(closeHref, { scroll: false })
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [closeHref, router])

  return (
    <div
      ref={panelRef}
      role="complementary"
      aria-label={label}
      tabIndex={-1}
      className="fixed inset-y-0 right-0 z-40 flex w-full flex-col border-l border-slate-200 bg-white shadow-raised outline-none animate-slide-in-right motion-reduce:animate-none sm:w-[400px]"
    >
      {children}
    </div>
  )
}
