import { addDays, startOfDay } from 'date-fns'
import { z } from 'zod'
import type { BadgeTone } from '@/components/ui/display'
import type { FollowUpPriority, FollowUpStatus } from '@/types/database'

/**
 * Follow-up queue vocabulary and input validation.
 *
 * The pure helpers here (segment windows, snooze arithmetic, timestamp
 * parsing) are deliberately free of database and React imports so they can be
 * unit-tested against a fixed clock.
 */

export const FOLLOW_UP_PRIORITIES = [
  'low',
  'normal',
  'high',
  'urgent',
] as const satisfies readonly FollowUpPriority[]

export const PRIORITY_LABELS: Record<FollowUpPriority, string> = {
  low: 'Low',
  normal: 'Normal',
  high: 'High',
  urgent: 'Urgent',
}

export const PRIORITY_TONES: Record<FollowUpPriority, BadgeTone> = {
  low: 'slate',
  normal: 'sky',
  high: 'amber',
  urgent: 'red',
}

export const FOLLOW_UP_SEGMENTS = ['overdue', 'today', 'week', 'upcoming', 'completed'] as const

export type FollowUpSegment = (typeof FOLLOW_UP_SEGMENTS)[number]

export const SEGMENT_LABELS: Record<FollowUpSegment, string> = {
  overdue: 'Overdue',
  today: 'Today',
  week: 'This week',
  upcoming: 'Upcoming',
  completed: 'Completed',
}

export const SEGMENT_EMPTY_MESSAGES: Record<FollowUpSegment, string> = {
  overdue: 'Nothing is overdue. Everything owed is still in hand.',
  today: 'Nothing else is due today.',
  week: 'Nothing is due in the next seven days.',
  upcoming: 'Nothing is scheduled beyond the next seven days.',
  completed: 'No follow-ups have been completed yet.',
}

export function parseSegment(value: string | undefined | null): FollowUpSegment {
  return FOLLOW_UP_SEGMENTS.find((segment) => segment === value) ?? 'overdue'
}

/** Sentinel values the assignee filter accepts alongside a profile id. */
export const ASSIGNEE_ME = 'me'
export const ASSIGNEE_ALL = 'all'
export const ASSIGNEE_UNASSIGNED = 'unassigned'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Defaults to the signed-in user, which is what the queue is for. */
export function parseAssignee(value: string | undefined | null): string {
  if (value === ASSIGNEE_ALL || value === ASSIGNEE_UNASSIGNED) return value
  if (value && UUID_PATTERN.test(value)) return value
  return ASSIGNEE_ME
}

export function parsePriorityFilter(value: string | undefined | null): FollowUpPriority | 'all' {
  return FOLLOW_UP_PRIORITIES.find((priority) => priority === value) ?? 'all'
}

export interface SegmentWindow {
  status: FollowUpStatus
  /** Inclusive lower bound on `due_at`, ISO. */
  dueFrom: string | null
  /** Exclusive upper bound on `due_at`, ISO. */
  dueBefore: string | null
}

/**
 * Boundaries are evaluated against the server clock, the same clock that
 * interprets the due-date input, so the queue stays self-consistent even when
 * a viewer sits in another timezone.
 *
 * "This week" deliberately overlaps "Today": people read it as "the next seven
 * days", not "the days after today".
 */
export function segmentWindow(segment: FollowUpSegment, now: Date = new Date()): SegmentWindow {
  const tomorrow = startOfDay(addDays(now, 1)).toISOString()
  const weekEnd = startOfDay(addDays(now, 7)).toISOString()
  const nowIso = now.toISOString()

  switch (segment) {
    case 'overdue':
      return { status: 'open', dueFrom: null, dueBefore: nowIso }
    case 'today':
      return { status: 'open', dueFrom: nowIso, dueBefore: tomorrow }
    case 'week':
      return { status: 'open', dueFrom: nowIso, dueBefore: weekEnd }
    case 'upcoming':
      return { status: 'open', dueFrom: weekEnd, dueBefore: null }
    case 'completed':
      return { status: 'completed', dueFrom: null, dueBefore: null }
  }
}

export const SNOOZE_INTERVALS = ['day', 'week'] as const

export type SnoozeInterval = (typeof SNOOZE_INTERVALS)[number]

export const SNOOZE_DAYS: Record<SnoozeInterval, number> = { day: 1, week: 7 }

export const SNOOZE_LABELS: Record<SnoozeInterval, string> = {
  day: '+1 day',
  week: '+1 week',
}

/**
 * Shifts the reminder by the same amount as the due date so a snoozed item
 * keeps its lead time, and clears `reminder_sent_at` so the reminder job
 * re-arms for the new date instead of treating it as already notified.
 */
export function snoozeTimestamps(
  followUp: { due_at: string; remind_at: string | null },
  interval: SnoozeInterval,
): { due_at: string; remind_at: string | null; reminder_sent_at: null } {
  const days = SNOOZE_DAYS[interval]
  const due = new Date(followUp.due_at)
  const remind = followUp.remind_at ? new Date(followUp.remind_at) : null

  return {
    due_at: addDays(due, days).toISOString(),
    remind_at: remind ? addDays(remind, days).toISOString() : null,
    reminder_sent_at: null,
  }
}

/**
 * Turns a `datetime-local` value into an ISO timestamp. Values without a zone
 * are read in the server's timezone — the same clock `segmentWindow` uses.
 */
export function toIsoTimestamp(value: string): string | null {
  const trimmed = value.trim()
  if (trimmed === '') return null
  const parsed = new Date(trimmed)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

/** Formats an ISO timestamp back into a `datetime-local` input value. */
export function toDateTimeLocalValue(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(date.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  )
}

// --- Schemas ----------------------------------------------------------------

const uuidField = (message: string) => z.string().trim().uuid(message)

const optionalUuid = z
  .string()
  .trim()
  .transform((value) => (value === '' ? null : value))
  .refine((value) => value === null || UUID_PATTERN.test(value), 'That record could not be found')

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Keep this under ${max} characters`)
    .transform((value) => (value === '' ? null : value))

const requiredTimestamp = (missingMessage: string) =>
  z
    .string()
    .trim()
    .min(1, missingMessage)
    .transform((value, ctx) => {
      const iso = toIsoTimestamp(value)
      if (!iso) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter a valid date and time' })
        return z.NEVER
      }
      return iso
    })

const optionalTimestamp = z.string().trim().transform((value, ctx) => {
  if (value === '') return null
  const iso = toIsoTimestamp(value)
  if (!iso) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter a valid date and time' })
    return z.NEVER
  }
  return iso
})

export const createFollowUpSchema = z.object({
  contact_id: uuidField('Choose the contact this is about'),
  title: z
    .string()
    .trim()
    .min(1, 'Say what needs doing')
    .max(200, 'Keep the title under 200 characters'),
  details: optionalText(4000),
  due_at: requiredTimestamp('Choose when this is due'),
  remind_at: optionalTimestamp,
  priority: z.enum(FOLLOW_UP_PRIORITIES).catch('normal'),
  assigned_to: optionalUuid,
  engagement_id: optionalUuid,
  pipeline_card_id: optionalUuid,
})

export type CreateFollowUpInput = z.infer<typeof createFollowUpSchema>

export const completeFollowUpSchema = z.object({
  id: uuidField('That follow-up could not be found'),
  outcome_note: optionalText(2000),
})

export const snoozeFollowUpSchema = z.object({
  id: uuidField('That follow-up could not be found'),
  interval: z.enum(SNOOZE_INTERVALS),
})

export const reassignFollowUpSchema = z.object({
  id: uuidField('That follow-up could not be found'),
  assigned_to: optionalUuid,
})

export const cancelFollowUpSchema = z.object({
  id: uuidField('That follow-up could not be found'),
})

export const FOLLOW_UP_INTENTS = ['complete', 'snooze', 'reassign', 'cancel'] as const

export type FollowUpIntent = (typeof FOLLOW_UP_INTENTS)[number]

export function parseIntent(value: string | undefined | null): FollowUpIntent | null {
  return FOLLOW_UP_INTENTS.find((intent) => intent === value) ?? null
}

/** Collapses Zod issues into the `fieldErrors` shape server actions return. */
export function fieldErrorsFrom(error: z.ZodError): Record<string, string> {
  const errors: Record<string, string> = {}
  for (const issue of error.issues) {
    const key = issue.path[0]
    if (typeof key === 'string' && !errors[key]) errors[key] = issue.message
  }
  return errors
}
