import Link from 'next/link'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * Tabs that are links, not state.
 *
 * The donor record holds seven areas of information, and showing them all at
 * once is what made it overwhelming. Splitting them into tabs is only half the
 * answer though — the other half is that each tab is a real URL
 * (`?tab=proposals`), which means it is server-rendered, shareable, survives a
 * refresh, works with the back button, and needs no JavaScript to change.
 *
 * A tab with a count shows it; a tab with nothing in it says nothing rather
 * than shouting "0". An empty area is not news.
 */

export interface TabDefinition {
  key: string
  label: string
  count?: number | null
}

export function Tabs({
  tabs,
  active,
  hrefFor,
  label,
  className,
}: {
  tabs: readonly TabDefinition[]
  active: string
  /** Builds the href for a tab key, so the caller keeps its other params. */
  hrefFor: (key: string) => string
  label: string
  className?: string
}) {
  return (
    <div className={cn('border-b border-slate-200', className)}>
      <nav aria-label={label}>
        {/* Horizontal scroll rather than wrap: a wrapped tab strip on a phone
            reads as two rows of unrelated links. `-mb-px` sits the active
            underline on the container rule instead of beside it. */}
        <ul className="-mb-px flex gap-x-1 overflow-x-auto">
          {tabs.map((tab) => {
            const selected = tab.key === active
            return (
              <li key={tab.key}>
                <Link
                  href={hrefFor(tab.key)}
                  aria-current={selected ? 'page' : undefined}
                  className={cn(
                    'inline-flex items-center gap-2 whitespace-nowrap border-b-2 px-3 py-3 text-sm transition-colors',
                    selected
                      ? 'border-brand-600 font-semibold text-brand-800'
                      : 'border-transparent font-medium text-slate-600 hover:border-slate-300 hover:text-slate-900',
                  )}
                >
                  {tab.label}
                  {tab.count ? (
                    <span
                      className={cn(
                        'rounded-full px-1.5 py-0.5 text-[11px] font-semibold tabular-nums',
                        selected ? 'bg-brand-100 text-brand-800' : 'bg-slate-100 text-slate-600',
                      )}
                    >
                      {tab.count}
                    </span>
                  ) : null}
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>
    </div>
  )
}

/**
 * A section heading on the canvas rather than a card header.
 *
 * Most groups of information do not need a box around them. A small caps
 * eyebrow, an optional action on the right, and whitespace do the same job
 * with far less ink — which is what stops eight sections reading as eight
 * competing panels.
 */
export function SectionHeading({
  title,
  description,
  action,
  className,
}: {
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={cn('flex flex-wrap items-end justify-between gap-x-4 gap-y-2', className)}>
      <div className="min-w-0">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-500">
          {title}
        </h2>
        {description ? (
          <p className="mt-1 text-sm leading-relaxed text-slate-600">{description}</p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  )
}
