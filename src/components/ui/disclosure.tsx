'use client'

import { ChevronDown } from 'lucide-react'
import { useId, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * Progressive disclosure, as one component.
 *
 * The brief's central instruction — "do not put every available field,
 * metric, section and action on screen simultaneously" — turns into this: a
 * heading a person can read, a summary of what is inside when it is closed,
 * and the detail only once they ask.
 *
 * Built on a real `<button aria-expanded>` rather than `<details>` because a
 * native disclosure cannot carry the closed-state summary line, and because
 * Safari's `<details>` still fights any attempt to animate it.
 */
export function Disclosure({
  label,
  /** Shown while closed: what is inside, so opening it is an informed choice. */
  summary,
  defaultOpen = false,
  children,
  className,
}: {
  label: string
  summary?: ReactNode
  defaultOpen?: boolean
  children: ReactNode
  className?: string
}) {
  const [open, setOpen] = useState(defaultOpen)
  const panelId = useId()

  return (
    <div className={cn('rounded-lg border border-slate-200 bg-white', className)}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex w-full items-center justify-between gap-3 rounded-lg px-4 py-3 text-left transition-colors hover:bg-slate-50"
      >
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-slate-900">{label}</span>
          {summary && !open ? (
            <span className="mt-0.5 block truncate text-[13px] text-slate-500">{summary}</span>
          ) : null}
        </span>
        <ChevronDown
          aria-hidden="true"
          className={cn(
            'h-4 w-4 shrink-0 text-slate-500 transition-transform duration-150',
            open && 'rotate-180',
          )}
        />
      </button>
      <div
        id={panelId}
        hidden={!open}
        className="border-t border-slate-200 px-4 py-3.5 animate-fade-in motion-reduce:animate-none"
      >
        {children}
      </div>
    </div>
  )
}
