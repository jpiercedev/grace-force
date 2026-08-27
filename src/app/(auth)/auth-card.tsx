import Image from 'next/image'
import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * The Grace “G” emblem + wordmark, shared by every screen that renders outside
 * the app shell (auth, setup, no-access, intake) so a stranded visitor always
 * sees the same brand reassurance. The emblem keeps its native proportions
 * inside a square box via object-contain.
 */
export function BrandMark({ className }: { className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2.5 text-lg font-bold text-slate-900', className)}>
      <Image
        src="/brand/grace-g.webp"
        alt=""
        aria-hidden="true"
        width={32}
        height={32}
        className="h-8 w-8 shrink-0 object-contain"
      />
      Grace Lead Manager
    </span>
  )
}

/**
 * A slim white band carrying the wordmark — the header for the standalone
 * pages (setup, no-access, intake) that need brand presence without the full
 * auth treatment.
 */
export function BrandBand({
  tagline,
  width = 'max-w-2xl',
}: {
  tagline?: string
  width?: string
}) {
  return (
    <header className="border-b border-slate-200 bg-white">
      <div
        className={cn(
          'mx-auto flex w-full items-center justify-between gap-4 px-6 py-4 sm:px-8',
          width,
        )}
      >
        <BrandMark />
        {tagline ? <p className="hidden text-sm text-slate-500 sm:block">{tagline}</p> : null}
      </div>
    </header>
  )
}

/**
 * The auth shell: bright and centered — the mark, a plain title, and one
 * white card on the warm canvas. This is the first thing anyone sees of the
 * product, so it makes the same promise the product does: clear, familiar,
 * nothing to decode.
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
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 py-10 sm:px-6">
      <div className="w-full max-w-md">
        <div className="flex justify-center">
          <BrandMark />
        </div>

        <h1 className="mt-6 text-center text-xl font-bold leading-tight text-slate-900 sm:text-2xl">
          {title}
        </h1>
        {description ? (
          <p className="mt-1.5 text-center text-sm text-slate-600">{description}</p>
        ) : null}

        <div className="mt-6 rounded-lg border border-slate-200 bg-white p-6 shadow-card">
          {children}
        </div>

        {footer ? <div className="mt-5 text-center">{footer}</div> : null}
      </div>
    </div>
  )
}
