import Link from 'next/link'
import type { ComponentProps, ReactNode } from 'react'
import { cn, initials } from '@/lib/utils'

// --- Badge ------------------------------------------------------------------

/**
 * Soft tint + a colored dot + text. The dot restates the tone so color is
 * never the only signal, and the tint stays quiet enough that a row with
 * three chips does not shout. Tone names are looked up from a static map
 * because Tailwind's compiler only keeps classes it can see literally.
 */
const BADGE_TONES = {
  slate: 'bg-slate-100 text-slate-700',
  zinc: 'bg-slate-100 text-slate-600',
  emerald: 'bg-emerald-50 text-emerald-800',
  sky: 'bg-sky-50 text-sky-800',
  indigo: 'bg-indigo-50 text-indigo-800',
  violet: 'bg-violet-50 text-violet-800',
  amber: 'bg-amber-50 text-amber-800',
  rose: 'bg-rose-50 text-rose-800',
  red: 'bg-red-50 text-red-800',
  brand: 'bg-brand-50 text-brand-800',
} as const

const BADGE_DOTS: Record<keyof typeof BADGE_TONES, string> = {
  slate: 'bg-slate-400',
  zinc: 'bg-slate-400',
  emerald: 'bg-emerald-500',
  sky: 'bg-sky-500',
  indigo: 'bg-indigo-500',
  violet: 'bg-violet-500',
  amber: 'bg-amber-500',
  rose: 'bg-rose-500',
  red: 'bg-red-600',
  brand: 'bg-brand-500',
}

export type BadgeTone = keyof typeof BADGE_TONES

export function badgeTone(value: string | null | undefined): BadgeTone {
  return value && value in BADGE_TONES ? (value as BadgeTone) : 'slate'
}

export function Badge({
  tone = 'slate',
  className,
  children,
  ...props
}: ComponentProps<'span'> & { tone?: BadgeTone }) {
  return (
    <span
      {...props}
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium',
        BADGE_TONES[tone],
        className,
      )}
    >
      <span aria-hidden="true" className={cn('h-1.5 w-1.5 shrink-0 rounded-full', BADGE_DOTS[tone])} />
      {children}
    </span>
  )
}

// --- Card -------------------------------------------------------------------

export function Card({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      {...props}
      className={cn('rounded-xl border border-slate-200/70 bg-white shadow-card', className)}
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
        'flex flex-wrap items-start justify-between gap-3 border-b border-slate-200/70 px-5 py-4',
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
  return <div {...props} className={cn('px-5 py-4', className)} />
}

// --- Page chrome ------------------------------------------------------------

/**
 * Page titles speak in the serif display voice — the moment that tells you
 * where you are should feel like a chapter heading, not a bold form label.
 * The optional eyebrow is a small caps waypoint above the title.
 */
export function PageHeader({
  title,
  description,
  action,
  eyebrow,
}: {
  title: string
  description?: ReactNode
  action?: ReactNode
  eyebrow?: ReactNode
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4 pb-6">
      <div className="min-w-0 flex-1 basis-64">
        {eyebrow ? (
          <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-slate-500">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="break-words font-display text-[1.75rem] font-semibold leading-tight tracking-tight text-slate-900 sm:text-[2rem]">
          {title}
        </h1>
        {description ? <p className="mt-1.5 text-[15px] text-slate-600">{description}</p> : null}
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
    <div className="flex flex-col items-center justify-center px-6 py-10 text-center sm:py-14">
      {icon ? (
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-slate-100 text-slate-500">
          {icon}
        </div>
      ) : null}
      <p className="font-display text-lg font-semibold text-slate-900">{title}</p>
      {description ? (
        <p className="mt-1.5 max-w-md text-sm leading-relaxed text-slate-600">{description}</p>
      ) : null}
      {action ? <div className="mt-5">{action}</div> : null}
    </div>
  )
}

// --- Callout ----------------------------------------------------------------

/**
 * Info callouts are neutral ink-on-tint rather than blue: most of them are
 * ambient guidance, and a blue box makes every page look like an alert.
 */
const CALLOUT_TONES = {
  info: 'border-slate-200 bg-slate-100/80 text-slate-800',
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
      className={cn('rounded-lg border px-4 py-3 text-sm', CALLOUT_TONES[tone], className)}
    >
      {title ? <p className="font-semibold">{title}</p> : null}
      {children ? <div className={cn(title && 'mt-1')}>{children}</div> : null}
    </div>
  )
}

// --- Avatar -----------------------------------------------------------------

/**
 * People get faces. The hue is derived from the name so the same person is
 * always the same color — six warm tones from the system palette, deep
 * enough for white initials at AA contrast.
 */
const AVATAR_HUES = [
  'bg-brand-600',
  'bg-accent-600',
  'bg-[#8a5a44]',
  'bg-[#6d6b35]',
  'bg-[#7d4a5e]',
  'bg-[#44657d]',
]

function avatarHue(name: string): string {
  let hash = 0
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0
  return AVATAR_HUES[Math.abs(hash) % AVATAR_HUES.length] ?? 'bg-brand-600'
}

export function Avatar({
  name,
  size = 'md',
  className,
}: {
  name: string
  size?: 'sm' | 'md' | 'lg' | 'xl'
  className?: string
}) {
  const sizes = {
    sm: 'h-6 w-6 text-[10px]',
    md: 'h-8 w-8 text-xs',
    lg: 'h-12 w-12 text-sm',
    xl: 'h-16 w-16 text-xl',
  }
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold text-white',
        avatarHue(name),
        sizes[size],
        size === 'xl' && 'font-display',
        className,
      )}
    >
      {initials(name)}
    </span>
  )
}

// --- Stat tile --------------------------------------------------------------

/**
 * A quiet figure, not an admin widget: eyebrow label, serif number, one hint
 * line. Tone colors the figure itself (and a dot beside the label) when the
 * number is a genuine alert — no more accent-bar strips.
 */
const STAT_FIGURES: Record<BadgeTone, string> = {
  slate: 'text-slate-900',
  zinc: 'text-slate-900',
  emerald: 'text-emerald-800',
  sky: 'text-sky-800',
  indigo: 'text-indigo-800',
  violet: 'text-violet-800',
  amber: 'text-amber-700',
  rose: 'text-rose-700',
  red: 'text-red-700',
  brand: 'text-brand-700',
}

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
      <dt className="flex items-center gap-1.5 truncate text-xs font-semibold uppercase tracking-wider text-slate-500">
        {tone !== 'slate' && tone !== 'zinc' ? (
          <span aria-hidden="true" className={cn('h-1.5 w-1.5 shrink-0 rounded-full', BADGE_DOTS[tone])} />
        ) : null}
        {label}
      </dt>
      <dd
        className={cn(
          'mt-1 font-display text-[1.75rem] font-semibold leading-none tabular-nums',
          STAT_FIGURES[tone],
        )}
      >
        {value}
      </dd>
      {hint ? <dd className="mt-1.5 text-xs leading-snug text-slate-500">{hint}</dd> : null}
    </>
  )

  const shell = cn(
    'block rounded-xl border border-slate-200/70 bg-white px-5 py-4 shadow-card',
    href &&
      'transition-all duration-150 hover:-translate-y-px hover:shadow-raised motion-reduce:hover:translate-y-0',
  )

  if (href) {
    return (
      <Link href={href} className={shell}>
        <dl>{content}</dl>
      </Link>
    )
  }
  return <dl className={shell}>{content}</dl>
}
