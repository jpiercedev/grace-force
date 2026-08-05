import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  ASSIGNEE_ALL,
  ASSIGNEE_ME,
  ASSIGNEE_UNASSIGNED,
  completeFollowUpSchema,
  createFollowUpSchema,
  fieldErrorsFrom,
  parseAssignee,
  parseIntent,
  parsePriorityFilter,
  parseSegment,
  reassignFollowUpSchema,
  segmentWindow,
  snoozeIntervalFor,
  snoozeTimestamps,
  toDateTimeLocalValue,
  toIsoTimestamp,
} from '@/lib/validation/follow-up'

/**
 * The queue's arithmetic — which segment a follow-up falls in, and where a
 * snooze lands it — decides what a staff member sees they owe. It is tested
 * against a fixed clock rather than through the page.
 */

const NOW = new Date('2026-08-05T12:00:00.000Z')
const HOUR = 3_600_000
const DAY = 24 * HOUR

const UUID = '11111111-1111-4111-8111-111111111111'

describe('parseSegment', () => {
  it('accepts the known segments', () => {
    expect(parseSegment('completed')).toBe('completed')
    expect(parseSegment('week')).toBe('week')
  })

  it('falls back to overdue, which is what the queue exists to surface', () => {
    expect(parseSegment(undefined)).toBe('overdue')
    expect(parseSegment('everything')).toBe('overdue')
  })
})

describe('parseAssignee', () => {
  it('keeps the sentinels and any profile id', () => {
    expect(parseAssignee(ASSIGNEE_ALL)).toBe(ASSIGNEE_ALL)
    expect(parseAssignee(ASSIGNEE_UNASSIGNED)).toBe(ASSIGNEE_UNASSIGNED)
    expect(parseAssignee(UUID)).toBe(UUID)
  })

  it('defaults to the signed-in user rather than the whole team', () => {
    expect(parseAssignee(undefined)).toBe(ASSIGNEE_ME)
    expect(parseAssignee('everyone')).toBe(ASSIGNEE_ME)
    // Anything that is not a uuid must not reach the query as a filter value.
    expect(parseAssignee("' or true --")).toBe(ASSIGNEE_ME)
  })
})

describe('parsePriorityFilter', () => {
  it('defaults to any priority', () => {
    expect(parsePriorityFilter('urgent')).toBe('urgent')
    expect(parsePriorityFilter('critical')).toBe('all')
    expect(parsePriorityFilter(undefined)).toBe('all')
  })
})

describe('segmentWindow', () => {
  it('treats overdue as everything open and already past', () => {
    const window = segmentWindow('overdue', NOW)
    expect(window.status).toBe('open')
    expect(window.dueFrom).toBeNull()
    expect(window.dueBefore).toBe(NOW.toISOString())
  })

  it('starts today at now, so an hour-old item is overdue rather than due', () => {
    const window = segmentWindow('today', NOW)
    expect(window.dueFrom).toBe(NOW.toISOString())
    const end = new Date(window.dueBefore!)
    expect(end.getTime()).toBeGreaterThan(NOW.getTime())
    expect(end.getTime() - NOW.getTime()).toBeLessThanOrEqual(DAY)
    // The boundary is a day start, not "24 hours from now".
    expect(end.getHours()).toBe(0)
  })

  it('reads "this week" as the next seven days, overlapping today', () => {
    const today = segmentWindow('today', NOW)
    const week = segmentWindow('week', NOW)
    expect(week.dueFrom).toBe(today.dueFrom)

    const days = (new Date(week.dueBefore!).getTime() - new Date(today.dueBefore!).getTime()) / DAY
    expect(days).toBeCloseTo(6, 1)
  })

  it('hands "upcoming" everything the week window stops at', () => {
    const week = segmentWindow('week', NOW)
    const upcoming = segmentWindow('upcoming', NOW)
    expect(upcoming.dueFrom).toBe(week.dueBefore)
    expect(upcoming.dueBefore).toBeNull()
  })

  it('selects completed follow-ups regardless of when they were due', () => {
    const window = segmentWindow('completed', NOW)
    expect(window.status).toBe('completed')
    expect(window.dueFrom).toBeNull()
    expect(window.dueBefore).toBeNull()
  })
})

describe('snoozeTimestamps', () => {
  it('pushes a future follow-up out by the interval', () => {
    const result = snoozeTimestamps(
      { due_at: '2026-08-10T09:00:00.000Z', remind_at: '2026-08-10T08:00:00.000Z' },
      'day',
      NOW,
    )
    const shift = new Date(result.due_at).getTime() - Date.parse('2026-08-10T09:00:00.000Z')
    expect(shift).toBeGreaterThanOrEqual(23 * HOUR)
    expect(shift).toBeLessThanOrEqual(25 * HOUR)
  })

  it('keeps the reminder the same distance ahead of the due date', () => {
    const result = snoozeTimestamps(
      { due_at: '2026-08-10T09:00:00.000Z', remind_at: '2026-08-10T08:00:00.000Z' },
      'week',
      NOW,
    )
    const lead = new Date(result.due_at).getTime() - new Date(result.remind_at!).getTime()
    expect(lead).toBe(HOUR)
  })

  it('measures an overdue item from now, so snoozing actually clears it', () => {
    const result = snoozeTimestamps(
      { due_at: '2026-07-01T09:00:00.000Z', remind_at: '2026-07-01T09:00:00.000Z' },
      'day',
      NOW,
    )
    const due = new Date(result.due_at).getTime()
    expect(due).toBeGreaterThan(NOW.getTime())
    expect(due - NOW.getTime()).toBeLessThanOrEqual(25 * HOUR)
  })

  it('leaves an absent reminder absent', () => {
    const result = snoozeTimestamps({ due_at: '2026-08-10T09:00:00.000Z', remind_at: null }, 'day', NOW)
    expect(result.remind_at).toBeNull()
  })

  it('re-arms the reminder job by clearing reminder_sent_at', () => {
    const result = snoozeTimestamps({ due_at: '2026-08-10T09:00:00.000Z', remind_at: null }, 'day', NOW)
    expect(result.reminder_sent_at).toBeNull()
  })
})

describe('intents', () => {
  it('maps each snooze intent to its interval and rejects anything else', () => {
    expect(snoozeIntervalFor('snooze_day')).toBe('day')
    expect(snoozeIntervalFor('snooze_week')).toBe('week')
    expect(snoozeIntervalFor('complete')).toBeNull()
  })

  it('refuses an unknown intent rather than guessing', () => {
    expect(parseIntent('complete')).toBe('complete')
    expect(parseIntent('delete')).toBeNull()
    expect(parseIntent(undefined)).toBeNull()
  })
})

describe('timestamp helpers', () => {
  it('treats an empty datetime-local value as absent', () => {
    expect(toIsoTimestamp('')).toBeNull()
    expect(toIsoTimestamp('   ')).toBeNull()
  })

  it('rejects an unparseable value instead of inventing a date', () => {
    expect(toIsoTimestamp('next tuesday')).toBeNull()
  })

  it('round-trips through the datetime-local format', () => {
    const iso = toIsoTimestamp('2026-08-10T09:30')!
    expect(toDateTimeLocalValue(iso)).toBe('2026-08-10T09:30')
  })

  it('renders an unusable date as an empty input value', () => {
    expect(toDateTimeLocalValue('not a date')).toBe('')
  })
})

describe('createFollowUpSchema', () => {
  const valid = {
    contact_id: UUID,
    title: 'Send the partnership pack',
    details: '',
    due_at: '2026-08-10T09:00',
    remind_at: '',
    priority: 'high',
    assigned_to: UUID,
    engagement_id: '',
    pipeline_card_id: '',
  }

  it('accepts a filled-in form and normalises the blanks to null', () => {
    const parsed = createFollowUpSchema.parse(valid)
    expect(parsed.details).toBeNull()
    // Left null so the database trigger mirrors remind_at from due_at.
    expect(parsed.remind_at).toBeNull()
    expect(parsed.engagement_id).toBeNull()
    expect(parsed.pipeline_card_id).toBeNull()
    expect(parsed.due_at).toBe(new Date('2026-08-10T09:00').toISOString())
  })

  it('insists on a contact and a title', () => {
    const result = createFollowUpSchema.safeParse({ ...valid, contact_id: '', title: '  ' })
    expect(result.success).toBe(false)
    if (result.success) return
    const errors = fieldErrorsFrom(result.error)
    expect(errors.contact_id).toBe('Choose the contact this is about')
    expect(errors.title).toBe('Say what needs doing')
  })

  it('requires a due date, because an undated commitment never surfaces', () => {
    const result = createFollowUpSchema.safeParse({ ...valid, due_at: '' })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(fieldErrorsFrom(result.error).due_at).toBe('Choose when this is due')
    }
  })

  it('falls back to normal priority rather than failing on a stale form value', () => {
    expect(createFollowUpSchema.parse({ ...valid, priority: 'whenever' }).priority).toBe('normal')
  })

  it('reads an empty assignee as a deliberate "leave it unassigned"', () => {
    expect(createFollowUpSchema.parse({ ...valid, assigned_to: '' }).assigned_to).toBeNull()
  })

  it('rejects a non-uuid assignee', () => {
    const result = createFollowUpSchema.safeParse({ ...valid, assigned_to: 'dana' })
    expect(result.success).toBe(false)
  })

  it('keeps an explicit reminder time', () => {
    const parsed = createFollowUpSchema.parse({ ...valid, remind_at: '2026-08-09T08:00' })
    expect(parsed.remind_at).toBe(new Date('2026-08-09T08:00').toISOString())
  })
})

describe('completeFollowUpSchema', () => {
  it('treats an empty outcome note as none', () => {
    expect(completeFollowUpSchema.parse({ id: UUID, outcome_note: '  ' }).outcome_note).toBeNull()
  })

  it('caps the outcome note instead of letting Postgres decide', () => {
    const result = completeFollowUpSchema.safeParse({ id: UUID, outcome_note: 'x'.repeat(2001) })
    expect(result.success).toBe(false)
  })
})

describe('reassignFollowUpSchema', () => {
  it('allows unassigning', () => {
    expect(reassignFollowUpSchema.parse({ id: UUID, assigned_to: '' }).assigned_to).toBeNull()
  })
})

describe('fieldErrorsFrom', () => {
  it('keeps the first message per field, which is the one the form shows', () => {
    const schema = z.object({ title: z.string().min(5, 'Too short').max(2, 'Too long') })
    const result = schema.safeParse({ title: 'abc' })
    expect(result.success).toBe(false)
    if (!result.success) expect(fieldErrorsFrom(result.error)).toEqual({ title: 'Too short' })
  })
})
