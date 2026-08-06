import Link from 'next/link'
import type { ComponentProps, ReactNode } from 'react'
import { cn, initials } from '@/lib/utils'

// --- Badge ------------------------------------------------------------------

/**
 * Colours are looked up from a static map rather than interpolated into a
 * class string, because Tailwind's compiler only keeps classes it can see
 * literally in the source.
 */
const BADGE_TONES = {
  slate: 'bg-slate-100 text-slate-700 ring-slate-200',
  zinc: 'bg-zinc-100 text-zinc-700 ring-zinc-200',
  emerald: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  sky: 'bg-sky-50 text-sky-700 ring-sky-200',
  indigo: 'bg-indigo-50 text-indigo-700 ring-indigo-200',
  violet: 'bg-violet-50 text-violet-700 ring-violet-200',
  amber: 'bg-amber-50 text-amber-800 ring-amber-200',
  rose: 'bg-rose-50 text-rose-700 ring-rose-200',
  red: 'bg-red-50 text-red-700 ring-red-200',
  brand: 'bg-brand-50 text-brand-700 ring-brand-200',
} as const

export type BadgeTone = keyof typeof BADGE_TONES

export function badgeTone(value: string | null | undefined): BadgeTone {
  return value && value in BADGE_TONES ? (value as BadgeTone) : 'slate'
}

export function Badge({
  tone = 'slate',
  className,
  ...props
}: ComponentProps<'span'> & { tone?: BadgeTone }) {
  return (
    <span
      {...props}
      className={cn(
        // whitespace-nowrap: a squeezed column must never fold a pill onto two
        // lines — the surrounding flex-wrap containers handle overflow instead.
        'inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset',
        BADGE_TONES[tone],
        className,
      )}
    />
  )
}

// --- Card -------------------------------------------------------------------

export function Card({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      {...props}
      className={cn('rounded-lg border border-slate-200 bg-white shadow-sm', className)}
    />
  )
}

export function CardHeader({
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
    <div
      className={cn(
        'flex flex-wrap items-start justify-between gap-3 border-b border-slate-200 px-4 py-3',
        className,
      )}
    >
      <div className="min-w-0">
        <h2 className="text-base font-semibold text-slate-900">{title}</h2>
        {description ? <p className="mt-0.5 text-sm text-slate-500">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  )
}

export function CardBody({ className, ...props }: ComponentProps<'div'>) {
  return <div {...props} className={cn('px-4 py-4', className)} />
}

// --- Page chrome ------------------------------------------------------------

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string
  description?: ReactNode
  action?: ReactNode
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4 pb-5">
      {/* basis-64 guarantees the title block a readable column: when the
          actions would squeeze it below ~16rem they wrap underneath instead,
          and long action rows also wrap internally (min-w-0, not shrink-0). */}
      <div className="min-w-0 flex-1 basis-64">
        <h1 className="break-words text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">
          {title}
        </h1>
        {description ? <p className="mt-1 text-sm text-slate-600">{description}</p> : null}
      </div>
      {action ? <div className="flex min-w-0 flex-wrap items-center gap-2">{action}</div> : null}
    </header>
  )
}

export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string
  description?: ReactNode
  action?: ReactNode
  icon?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-8 text-center sm:py-12">
      {icon ? <div className="mb-3 text-slate-300">{icon}</div> : null}
      <p className="text-sm font-medium text-slate-900">{title}</p>
      {description ? (
        <p className="mt-1 max-w-md text-sm text-slate-500">{description}</p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  )
}

// --- Callout ----------------------------------------------------------------

const CALLOUT_TONES = {
  info: 'border-sky-200 bg-sky-50 text-sky-900',
  warning: 'border-amber-200 bg-amber-50 text-amber-900',
  danger: 'border-red-200 bg-red-50 text-red-900',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-900',
} as const

export function Callout({
  tone = 'info',
  title,
  children,
  className,
  // `status` announces politely, which suits unconfigured-integration notices.
  // Form errors should pass role="alert" so they interrupt instead.
  role = 'status',
}: {
  tone?: keyof typeof CALLOUT_TONES
  title?: ReactNode
  children?: ReactNode
  className?: string
  role?: 'status' | 'alert' | 'note'
}) {
  return (
    <div
      role={role}
      className={cn('rounded-md border px-4 py-3 text-sm', CALLOUT_TONES[tone], className)}
    >
      {title ? <p className="font-semibold">{title}</p> : null}
      {children ? <div className={cn(title && 'mt-1')}>{children}</div> : null}
    </div>
  )
}

// --- Avatar -----------------------------------------------------------------

export function Avatar({
  name,
  size = 'md',
  className,
}: {
  name: string
  size?: 'sm' | 'md' | 'lg'
  className?: string
}) {
  const sizes = {
    sm: 'h-6 w-6 text-[10px]',
    md: 'h-8 w-8 text-xs',
    lg: 'h-12 w-12 text-sm',
  }
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full bg-brand-100 font-semibold text-brand-800',
        sizes[size],
        className,
      )}
    >
      {initials(name)}
    </span>
  )
}

// --- Stat tile --------------------------------------------------------------

export function StatTile({
  label,
  value,
  hint,
  href,
  tone = 'slate',
}: {
  label: string
  value: ReactNode
  hint?: ReactNode
  href?: string
  tone?: BadgeTone
}) {
  const content = (
    <>
      <dt className="truncate text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </dt>
      <dd className="mt-1.5 text-2xl font-semibold tabular-nums text-slate-900">{value}</dd>
      {hint ? <p className="mt-1 text-xs text-slate-500">{hint}</p> : null}
    </>
  )

  // The left border is always present (transparent when neutral) so a toned
  // tile does not sit 3px narrower than its neighbours, and each tone repeats
  // its colour under hover: so the card-wide hover:border-brand-300 shorthand
  // cannot repaint an alert bar.
  const shell = cn(
    'block rounded-lg border border-slate-200 border-l-4 border-l-transparent bg-white px-4 py-3 shadow-sm',
    href && 'transition-colors hover:border-brand-300 hover:bg-brand-50/40',
    tone === 'red' && 'border-l-red-400 hover:border-l-red-400',
    tone === 'amber' && 'border-l-amber-400 hover:border-l-amber-400',
    tone === 'emerald' && 'border-l-emerald-400 hover:border-l-emerald-400',
    tone === 'brand' && 'border-l-brand-400 hover:border-l-brand-400',
  )

  if (href) {
    return (
      <Link href={href} className={shell}>
        <dl>{content}</dl>
      </Link>
    )
  }
  return (
    <dl className={shell}>{content}</dl>
  )
}
