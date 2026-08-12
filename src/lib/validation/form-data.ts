import { z } from 'zod'
import { toFieldErrors, type ContactActionState } from '@/lib/validation/contact'

/**
 * The plumbing every server action repeats: pulling strings out of `FormData`,
 * turning a Zod failure into the `{ error, fieldErrors }` shape the forms
 * render, and translating a Postgres error code into a sentence.
 *
 * Extracted so the six action files that now exist share one implementation
 * rather than six subtly different ones.
 */

export function text(formData: FormData, key: string): string | null {
  const value = formData.get(key)
  return typeof value === 'string' ? value : null
}

/** Multi-select and checkbox groups: every value submitted under one name. */
export function textList(formData: FormData, key: string): string[] {
  return formData.getAll(key).filter((value): value is string => typeof value === 'string')
}

export function uuidField(message: string) {
  return z.string({ required_error: message, invalid_type_error: message }).trim().uuid(message)
}

export function invalid(error: z.ZodError): ContactActionState {
  return { error: 'Check the highlighted fields and try again.', fieldErrors: toFieldErrors(error) }
}

/**
 * Turns a driver error into something a person can act on. The codes matter:
 * 23505 is a uniqueness index, 23514 a check constraint, and 42501 is Row
 * Level Security refusing the write — all three are expected outcomes of
 * ordinary use, not crashes.
 */
export function writeFailed(error: { code?: string; message: string }, fallback: string): string {
  if (error.code === '42501') return 'You do not have permission to make that change.'
  if (error.code === '23514') return 'That combination of values is not allowed.'
  if (error.code === '23505') return 'That already exists.'
  return fallback
}

export function isUniqueViolation(error: { code?: string }): boolean {
  return error.code === '23505'
}

const DATETIME_LOCAL = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/

/**
 * `datetime-local` submits wall-clock time with no zone. Reading it as UTC and
 * re-adding the browser's own offset recovers the instant the person meant,
 * instead of silently reinterpreting it in whatever zone the server runs in.
 */
export function localDateTimeToIso(value: string, offsetMinutes: number): string | null {
  if (!DATETIME_LOCAL.test(value)) return null
  const withSeconds = value.length === 16 ? `${value}:00` : value
  const asUtc = Date.parse(`${withSeconds}Z`)
  if (Number.isNaN(asUtc)) return null
  return new Date(asUtc + offsetMinutes * 60_000).toISOString()
}

export function timezoneOffset(formData: FormData): number {
  const parsed = Number.parseInt(text(formData, 'tz_offset') ?? '', 10)
  return Number.isFinite(parsed) && Math.abs(parsed) <= 900 ? parsed : 0
}

export function today(): string {
  return new Date().toISOString().slice(0, 10)
}

/**
 * Money arrives as whatever a person typed — "$25,000", "25000.50", "". Parsed
 * to integer cents because every monetary column in the schema is minor units.
 */
export function optionalMoneyCents() {
  return z
    .union([z.string(), z.number()])
    .optional()
    .nullable()
    .transform((value) => {
      if (value === null || value === undefined) return null
      const raw = typeof value === 'number' ? String(value) : value.trim()
      if (raw === '') return null
      const cleaned = raw.replace(/[$,\s]/g, '')
      const parsed = Number.parseFloat(cleaned)
      if (!Number.isFinite(parsed)) return Number.NaN
      return Math.round(parsed * 100)
    })
    .refine((cents) => cents === null || (Number.isFinite(cents) && cents >= 0), {
      message: 'Enter an amount like 25,000',
    })
}
