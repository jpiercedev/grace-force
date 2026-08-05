import { z } from 'zod'
import type { BadgeTone } from '@/components/ui/display'
import { INTEREST_OPTIONS } from '@/lib/leads/form'
import { checkboxField, optionalText } from '@/lib/validation/contact'

/**
 * Vocabulary and validation for the engagement type catalogue.
 *
 * Pure and browser-safe, so the forms and the server actions agree on the
 * colour list, the slug rule and the result shape.
 */

/**
 * The colour tokens `Badge` can actually render.
 *
 * Tailwind only keeps classes it can see written out in the source, so the
 * badge component looks its colours up in a static map. A free-text colour
 * would therefore compile to nothing and the badge would silently lose its
 * tone — hence a fixed list. `satisfies` breaks the build here if the badge
 * ever drops one of these.
 */
export const ENGAGEMENT_COLORS = [
  'slate',
  'zinc',
  'emerald',
  'sky',
  'indigo',
  'violet',
  'amber',
  'rose',
  'red',
  'brand',
] as const satisfies readonly BadgeTone[]

export type EngagementColor = (typeof ENGAGEMENT_COLORS)[number]

export const COLOR_LABELS: Record<EngagementColor, string> = {
  slate: 'Slate',
  zinc: 'Zinc',
  emerald: 'Emerald',
  sky: 'Sky',
  indigo: 'Indigo',
  violet: 'Violet',
  amber: 'Amber',
  rose: 'Rose',
  red: 'Red',
  brand: 'Brand',
}

/** Mirrors the `engagement_types_slug_format` check constraint. */
const SLUG_PATTERN = /^[a-z0-9_]+$/

/**
 * Slugs other parts of the app resolve by name.
 *
 * Lead intake offers these as "what brings you here" and `convert_lead()`
 * starts the matching engagement; the Mailchimp sync looks `newsletter` up to
 * record who is on the list. Both match on slug alone, which is why a slug
 * cannot be edited once it exists.
 */
export const WIRED_SLUGS: Record<string, string> = {
  ...Object.fromEntries(
    INTEREST_OPTIONS.map((option) => [option.slug, 'Offered by the public lead form']),
  ),
  newsletter: 'Offered by the public lead form, and used by the Mailchimp sync',
}

export interface EngagementTypeActionState {
  error?: string
  notice?: string
  fieldErrors?: Record<string, string>
}

const labelField = z
  .string()
  .trim()
  .min(1, 'Give this engagement type a label')
  .max(80, 'Keep the label under 80 characters')

const colorField = z.enum(ENGAGEMENT_COLORS, {
  errorMap: () => ({ message: 'Choose a colour from the list' }),
})

/**
 * Ordering is a plain integer the catalogue sorts on, so a blank field takes
 * the column's own default rather than silently becoming 0 and jumping to the
 * top of every picker.
 */
const sortOrderField = z
  .string()
  .trim()
  .transform((value, ctx) => {
    if (value === '') return 100
    const parsed = Number(value)
    if (!Number.isInteger(parsed) || parsed < 0 || parsed > 9999) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Enter a whole number between 0 and 9999',
      })
      return z.NEVER
    }
    return parsed
  })

const slugField = z
  .string()
  .trim()
  .toLowerCase()
  .min(2, 'Give this a slug of at least 2 characters')
  .max(40, 'Keep the slug under 40 characters')
  .regex(SLUG_PATTERN, 'Use lower-case letters, numbers and underscores only')

export const createEngagementTypeSchema = z.object({
  slug: slugField,
  label: labelField,
  description: optionalText(500),
  color: colorField,
  sort_order: sortOrderField,
  is_active: checkboxField(),
})

/** No slug: it is fixed at creation, so the update never carries one to ignore. */
export const updateEngagementTypeSchema = z.object({
  id: z.string().trim().uuid('That engagement type could not be found'),
  label: labelField,
  description: optionalText(500),
  color: colorField,
  sort_order: sortOrderField,
  is_active: checkboxField(),
})

/** Suggests a slug from a label as the person types, matching the slug rule. */
export function slugify(label: string): string {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40)
}
