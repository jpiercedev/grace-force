'use client'

import { ChevronDown } from 'lucide-react'
import { useId, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * A collapsible section for the association rails of a record page.
 *
 * Quieter than `Disclosure`: no closed-state summary, a count instead, and
 * metrics sized for a narrow column. Sections holding data start open —
 * collapsing is for clearing space, not for hiding what exists.
 */
export function RailSection({
  title,
  count,
  defaultOpen = true,
  children,
  className,
}: {
  title: string
  count?: number
  defaultOpen?: boolean
  children: ReactNode
  className?: string
}) {
  const [open, setOpen] = useState(defaultOpen)
  const panelId = useId()

  return (
    <section className={cn('rounded-lg border border-slate-200 bg-white shadow-card', className)}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex w-full items-center justify-between gap-2 rounded-lg px-3.5 py-2.5 text-left transition-colors hover:bg-slate-50"
      >
        <span className="flex min-w-0 items-baseline gap-1.5">
          <span className="truncate text-[13px] font-semibold text-slate-900">{title}</span>
          {typeof count === 'number' && count > 0 ? (
            <span className="text-xs tabular-nums text-slate-500">({count})</span>
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
      <div id={panelId} hidden={!open} className="border-t border-slate-200 px-3.5 py-3">
        {children}
      </div>
    </section>
  )
}
