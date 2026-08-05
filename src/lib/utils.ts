import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

/** Money is stored in minor units everywhere; format from cents, never floats. */
export function formatCurrency(cents: number | null | undefined, currency = 'USD'): string {
  if (cents === null || cents === undefined) return '—'
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(cents / 100)
}

/** Parses "$1,234.56" / "1234.56" into cents. Returns null when unparseable. */
export function parseCurrencyToCents(input: string | number | null | undefined): number | null {
  if (input === null || input === undefined || input === '') return null
  if (typeof input === 'number') {
    return Number.isFinite(input) ? Math.round(input * 100) : null
  }
  const cleaned = input.replace(/[^0-9.-]/g, '')
  if (cleaned === '' || cleaned === '-' || cleaned === '.') return null
  const value = Number.parseFloat(cleaned)
  return Number.isFinite(value) ? Math.round(value * 100) : null
}

const DATE_FORMAT = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
})

const DATE_TIME_FORMAT = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
})

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—'
  const date = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(date.getTime())) return '—'
  return DATE_FORMAT.format(date)
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—'
  const date = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(date.getTime())) return '—'
  return DATE_TIME_FORMAT.format(date)
}

/** Compact "3d ago" / "in 2h" labels for timelines and due dates. */
export function formatRelative(
  value: string | Date | null | undefined,
  now: Date = new Date(),
): string {
  if (!value) return '—'
  const date = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(date.getTime())) return '—'

  const diffMs = date.getTime() - now.getTime()
  const abs = Math.abs(diffMs)
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour

  if (abs < minute) return 'just now'

  const [amount, unit] =
    abs < hour
      ? [Math.round(abs / minute), 'm']
      : abs < day
        ? [Math.round(abs / hour), 'h']
        : abs < 30 * day
          ? [Math.round(abs / day), 'd']
          : abs < 365 * day
            ? [Math.round(abs / (30 * day)), 'mo']
            : [Math.round(abs / (365 * day)), 'y']

  return diffMs < 0 ? `${amount}${unit} ago` : `in ${amount}${unit}`
}

export function isOverdue(dueAt: string | Date | null | undefined, now = new Date()): boolean {
  if (!dueAt) return false
  const date = typeof dueAt === 'string' ? new Date(dueAt) : dueAt
  return !Number.isNaN(date.getTime()) && date.getTime() < now.getTime()
}

/** Best available display name, falling back through the fields we may have. */
export function contactDisplayName(contact: {
  full_name?: string | null
  preferred_name?: string | null
  first_name?: string | null
  last_name?: string | null
  organization_name?: string | null
  email?: string | null
}): string {
  const composed = [contact.preferred_name ?? contact.first_name, contact.last_name]
    .filter(Boolean)
    .join(' ')
    .trim()
  return (
    composed ||
    contact.full_name?.trim() ||
    contact.organization_name?.trim() ||
    contact.email?.trim() ||
    'Unnamed contact'
  )
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase()
  return `${parts[0]![0]}${parts[parts.length - 1]![0]}`.toUpperCase()
}

/** Normalises an email the same way the database's generated column does. */
export function normalizeEmail(value: string | null | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim().toLowerCase()
  return trimmed === '' ? null : trimmed
}

export function normalizePhone(value: string | null | undefined): string | null {
  if (!value) return null
  const trimmed = value.trim()
  const digits = trimmed.replace(/[^0-9]/g, '')
  if (digits === '') return null
  return trimmed.startsWith('+') ? `+${digits}` : digits
}

/** Truncates on a word boundary for list previews. */
export function truncate(value: string | null | undefined, max = 120): string {
  if (!value) return ''
  if (value.length <= max) return value
  const slice = value.slice(0, max)
  const lastSpace = slice.lastIndexOf(' ')
  return `${slice.slice(0, lastSpace > max * 0.6 ? lastSpace : max).trimEnd()}…`
}

export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count.toLocaleString()} ${count === 1 ? singular : plural}`
}

/** Splits an array into fixed-size chunks — used for batched API writes. */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  if (size <= 0) throw new Error('chunk size must be positive')
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size))
  }
  return out
}
