import { format, isValid, parse as parseWithFormat } from 'date-fns'
import { z } from 'zod'
import { parseTagList } from '@/lib/validation/contact'
import { parseCurrencyToCents } from '@/lib/utils'

/**
 * Zod pieces for CSV cells.
 *
 * Every message here reads as a continuation of the field's label, so the
 * caller can render "Birthday could not be read as a date" without each
 * schema having to know what it is called.
 *
 * Cells reach these schemas already trimmed and non-empty (see `mapCells`),
 * so nothing needs to handle the empty string.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const ISO_DAY = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ].*)?$/
const SLASHED_DAY = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/
const WORDED_FORMATS = ['MMM d yyyy', 'MMMM d yyyy', 'd MMM yyyy', 'd MMMM yyyy']

const TRUE_VALUES = new Set(['true', 't', 'yes', 'y', '1', 'x', 'on'])
const FALSE_VALUES = new Set(['false', 'f', 'no', 'n', '0', 'off'])

function isRealDay(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day))
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  )
}

function toIsoDay(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/**
 * Reads the date spellings a spreadsheet actually produces into the
 * `YYYY-MM-DD` a DATE column wants.
 *
 * Slashed dates are read month-first (US convention), which is what Grace
 * Force's own exports and giving platform emit. It is genuinely ambiguous, so
 * the import screen says so rather than leaving it to be discovered.
 */
export function parseCsvDate(input: string): string | null {
  const value = input.trim()
  if (value === '') return null

  const iso = ISO_DAY.exec(value)
  if (iso) {
    const [, y, m, d] = iso
    const year = Number(y)
    const month = Number(m)
    const day = Number(d)
    return isRealDay(year, month, day) ? toIsoDay(year, month, day) : null
  }

  const slashed = SLASHED_DAY.exec(value)
  if (slashed) {
    const [, m, d, y] = slashed
    const month = Number(m)
    const day = Number(d)
    const rawYear = Number(y)
    // A two-digit year in ministry data is always this century in practice;
    // birthdays predating 2000 are written in full.
    const year = y!.length === 2 ? 2000 + rawYear : rawYear
    return isRealDay(year, month, day) ? toIsoDay(year, month, day) : null
  }

  const cleaned = value.replace(/,/g, '')
  for (const pattern of WORDED_FORMATS) {
    const parsed = parseWithFormat(cleaned, pattern, new Date())
    if (isValid(parsed)) return format(parsed, 'yyyy-MM-dd')
  }

  return null
}

export function parseCsvBoolean(input: string): boolean | null {
  const value = input.trim().toLowerCase()
  if (TRUE_VALUES.has(value)) return true
  if (FALSE_VALUES.has(value)) return false
  return null
}

export function csvText(max: number) {
  return z.string().trim().max(max, `is longer than ${max} characters`)
}

export function csvEmail(max = 254) {
  return csvText(max).email('is not a valid email address')
}

export function csvUuid() {
  return csvText(36).regex(UUID, 'is not an id this CRM issued')
}

export function csvDate() {
  return z.string().transform((value, ctx) => {
    const day = parseCsvDate(value)
    if (day === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'could not be read as a date — try YYYY-MM-DD',
      })
      return z.NEVER
    }
    return day
  })
}

export function csvBoolean() {
  return z.string().transform((value, ctx) => {
    const parsed = parseCsvBoolean(value)
    if (parsed === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'should be yes or no' })
      return z.NEVER
    }
    return parsed
  })
}

/** Tags arrive comma- or semicolon-separated depending on who exported them. */
export function csvTags() {
  return z.string().transform((value) => parseTagList(value.split(/[;,]/)))
}

/** Money in, integer cents out. The database rejects anything at or below zero. */
export function csvCents() {
  return z.string().transform((value, ctx) => {
    const cents = parseCurrencyToCents(value)
    if (cents === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'could not be read as an amount' })
      return z.NEVER
    }
    if (cents <= 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'must be greater than zero' })
      return z.NEVER
    }
    return cents
  })
}

/**
 * Cents that are already cents. This CRM's own exports carry the integer, and
 * running it through currency parsing would multiply every amount by a
 * hundred on the way back in.
 */
export function csvIntegerCents() {
  return z.string().transform((value, ctx) => {
    const cleaned = value.replace(/[\s,]/g, '')
    if (!/^-?\d+$/.test(cleaned)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'should be a whole number of cents',
      })
      return z.NEVER
    }
    const cents = Number(cleaned)
    if (cents <= 0) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'must be greater than zero' })
      return z.NEVER
    }
    return cents
  })
}

export function csvCurrencyCode() {
  return z
    .string()
    .trim()
    .transform((value) => value.toUpperCase())
    .refine((value) => /^[A-Z]{3}$/.test(value), {
      message: 'should be a three-letter currency code such as USD',
    })
}

/**
 * Matches a cell against a fixed vocabulary, ignoring case and punctuation so
 * "Prayer Partner" and "prayer_partner" are the same answer.
 */
export function csvEnum<Value extends string>(values: readonly [Value, ...Value[]]) {
  const lookup = new Map<string, Value>(
    values.map((value) => [value.toLowerCase().replace(/[^a-z0-9]+/g, ''), value]),
  )
  return z.string().transform((raw, ctx) => {
    const match = lookup.get(raw.toLowerCase().replace(/[^a-z0-9]+/g, ''))
    if (match === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `should be one of: ${values.join(', ')}`,
      })
      return z.NEVER
    }
    return match
  })
}

/** First message per field; a row's error list is read, not scrolled. */
export function issueMessages(
  error: z.ZodError,
  labels: Readonly<Record<string, string>>,
): string[] {
  const messages: string[] = []
  const seen = new Set<string>()
  for (const issue of error.issues) {
    const field = issue.path[0]
    const key = typeof field === 'string' ? field : ''
    if (key !== '' && seen.has(key)) continue
    if (key !== '') seen.add(key)
    const label = labels[key] ?? key
    messages.push(label === '' ? issue.message : `${label} ${issue.message}`)
  }
  return messages
}
