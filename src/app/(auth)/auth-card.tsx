import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * The GF mark + wordmark, shared by every screen that renders outside the app
 * shell (auth, setup, no-access, intake) so a stranded visitor always sees
 * the same brand reassurance. The wordmark speaks in the serif display voice —
 * it is the one line on these pages that is about the organisation rather
 * than the software.
 */
export function BrandMark({ tone = 'default' }: { tone?: 'default' | 'light' }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-2.5 font-display text-lg font-semibold tracking-tight',
        tone === 'light' ? 'text-slate-50' : 'text-slate-900',
      )}
    >
      <span
        aria-hidden="true"
        className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 font-display text-sm font-semibold text-white shadow-sm"
      >
        GF
      </span>
      Grace Force
    </span>
  )
}

/**
 * A slim evergreen-ink band carrying the wordmark — the header for the
 * standalone pages (setup, no-access, intake) that need brand presence
 * without the full split-panel treatment the auth screens get.
 */
export function BrandBand({
  tagline,
  width = 'max-w-2xl',
}: {
  tagline?: string
  width?: string
}) {
  return (
    <header className="bg-ink">
      <div
        className={cn(
          'mx-auto flex w-full items-center justify-between gap-4 px-6 py-5 sm:px-8',
          width,
        )}
      >
        <BrandMark tone="light" />
        {tagline ? (
          <p className="hidden text-sm text-slate-200/70 sm:block">{tagline}</p>
        ) : null}
      </div>
    </header>
  )
}

/**
 * The auth shell: an evergreen-ink brand panel beside (above, on phones) the
 * form on parchment. The dark surface carries the serif wordmark and one warm
 * sentence; everything operational stays on the light side. This is the first
 * thing anyone sees of the product, so it borrows the sidebar's silhouette —
 * the one place Grace Force is dark.
 */
export function AuthCard({
  title,
  description,
  children,
  footer,
}: {
  title: string
  description?: string
  children: ReactNode
  footer?: ReactNode
}) {
  return (
    <div className="flex min-h-dvh flex-col lg:flex-row">
      <aside className="relative isolate overflow-hidden bg-ink px-6 py-7 sm:px-10 lg:flex lg:w-[44%] lg:max-w-2xl lg:flex-col lg:justify-between lg:gap-12 lg:px-14 lg:py-12">
        {/* A quiet evergreen glow so the panel reads as a surface, not a void. */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-28 -top-28 -z-10 h-96 w-96 rounded-full bg-brand-600/25 blur-3xl"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-32 -left-24 -z-10 h-80 w-80 rounded-full bg-accent-500/10 blur-3xl"
        />

        <BrandMark tone="light" />

        {/* Banded on phones: the sentence sits right under the wordmark. */}
        <p className="mt-3 max-w-md text-[15px] leading-relaxed text-slate-100/75 lg:hidden">
          A well-kept ledger of the people who carry the ministry.
        </p>

        <p className="hidden max-w-md font-display text-[2.125rem] font-semibold leading-[1.25] tracking-tight text-slate-50 lg:block">
          A well-kept ledger of the <em className="not-italic text-brand-300">people</em> who
          carry the ministry.
        </p>

        <p className="hidden border-t border-ink-line pt-6 text-sm text-slate-200/60 lg:block">
          Relationship management for the Grace Force team.
        </p>
      </aside>

      <main className="flex flex-1 flex-col justify-center px-6 py-10 sm:px-10 lg:px-16 lg:py-12">
        <div className="mx-auto w-full max-w-md">
          <h1 className="font-display text-[1.75rem] font-semibold leading-tight tracking-tight text-slate-900 sm:text-[2rem]">
            {title}
          </h1>
          {description ? <p className="mt-2 text-[15px] text-slate-600">{description}</p> : null}

          <div className="mt-7 rounded-xl border border-slate-200/70 bg-white p-6 shadow-card sm:p-7">
            {children}
          </div>

          {footer ? <div className="mt-6">{footer}</div> : null}
        </div>
      </main>
    </div>
  )
}
