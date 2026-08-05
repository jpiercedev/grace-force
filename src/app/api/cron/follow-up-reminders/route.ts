import { timingSafeEqual } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { cronSecret, hasServiceRoleKey } from '@/lib/env'
import { notifyFollowUpDue, type FollowUpNotificationInput } from '@/lib/notifications/events'
import type { SendResult } from '@/lib/notifications/send'
/*
 * The reminder job runs without a session, so it is one of the sanctioned
 * service-role callers: it reads follow-ups across every owner and writes the
 * notification outbox, neither of which RLS would allow an anonymous request.
 */
// eslint-disable-next-line no-restricted-imports
import { createAdminClient } from '@/lib/supabase/admin'
import { chunk } from '@/lib/utils'
import type { FollowUpPriority } from '@/types/database'

/**
 * Scheduled follow-up reminders.
 *
 * Vercel's scheduler issues a `GET`; an operator triggering the job by hand
 * usually reaches for `POST`. Both are accepted, and both require the shared
 * secret — an unauthenticated caller could otherwise burn a day's worth of
 * dedupe keys and suppress the real reminders.
 *
 * Safe to run as often as the schedule likes: the notification dedupe key
 * carries the date, so a follow-up produces at most one reminder per day no
 * matter how many times this fires.
 */

export const dynamic = 'force-dynamic'

/** One page per run. At 15-minute intervals a backlog drains within the hour. */
const BATCH_LIMIT = 100

/** Small enough to stay polite to the provider, large enough to beat a serial loop. */
const SEND_CONCURRENCY = 5

/** Rate-limit rows only exist to enforce an hourly window; two days is generous. */
const RATE_LIMIT_RETENTION_HOURS = 48

interface DueFollowUp {
  id: string
  contact_id: string
  title: string
  details: string | null
  due_at: string
  priority: FollowUpPriority
  contact: {
    id: string
    full_name: string | null
    preferred_name: string | null
    first_name: string | null
    last_name: string | null
    organization_name: string | null
    email: string | null
  } | null
  assignee: {
    id: string
    email: string
    full_name: string | null
    is_active: boolean
  } | null
}

const DUE_SELECT = `
  id, contact_id, title, details, due_at, priority,
  contact:contacts!inner(id, full_name, preferred_name, first_name, last_name, organization_name, email),
  assignee:profiles!follow_ups_assigned_to_fkey(id, email, full_name, is_active)
`

export async function GET(request: NextRequest): Promise<NextResponse> {
  return run(request)
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return run(request)
}

async function run(request: NextRequest): Promise<NextResponse> {
  const secret = cronSecret()
  // Unlike lead intake, "no secret configured" cannot mean "open": this
  // endpoint sends mail and consumes dedupe keys.
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: 'CRON_SECRET is not configured on this deployment.' },
      { status: 503 },
    )
  }

  if (!matchesBearer(request.headers.get('authorization'), secret)) {
    return NextResponse.json({ ok: false, error: 'Unauthorized.' }, { status: 401 })
  }

  if (!hasServiceRoleKey()) {
    return NextResponse.json(
      { ok: false, error: 'SUPABASE_SERVICE_ROLE_KEY is not configured on this deployment.' },
      { status: 503 },
    )
  }

  const supabase = createAdminClient()
  const now = new Date()

  const { data, error } = await supabase
    .from('follow_ups')
    .select(DUE_SELECT)
    .eq('status', 'open')
    .not('assigned_to', 'is', null)
    .not('remind_at', 'is', null)
    .lte('remind_at', now.toISOString())
    .is('reminder_sent_at', null)
    // A follow-up outlives its contact's soft delete; the reminder should not.
    .is('contact.deleted_at', null)
    .order('remind_at', { ascending: true })
    .limit(BATCH_LIMIT)
    .overrideTypes<DueFollowUp[], { merge: false }>()

  if (error) {
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  }

  const due = data ?? []
  const counts = { notified: 0, duplicate: 0, skipped: 0, failed: 0 }

  for (const batch of chunk(due, SEND_CONCURRENCY)) {
    const outcomes = await Promise.all(batch.map((followUp) => notifyOne(followUp, now)))

    for (const outcome of outcomes) {
      if (outcome.result === 'notified') counts.notified += 1
      else if (outcome.result === 'duplicate') counts.duplicate += 1
      else if (outcome.result === 'skipped') counts.skipped += 1
      else counts.failed += 1
    }

    // Stamped only where the event was actually claimed. A failure is left
    // unstamped on purpose: today's retries will collide with the claim it
    // already holds, but tomorrow's key is a different one and can succeed.
    const stamp = outcomes.filter((outcome) => outcome.result !== 'failed').map((o) => o.id)
    if (stamp.length > 0) {
      const { error: stampError } = await supabase
        .from('follow_ups')
        .update({ reminder_sent_at: now.toISOString() })
        .in('id', stamp)

      // Losing the stamp costs a duplicate claim attempt next run, which the
      // dedupe key absorbs — not a reason to abandon the remaining batches.
      if (stampError) counts.failed += stamp.length
    }
  }

  const { data: pruned, error: pruneError } = await supabase.rpc('prune_rate_limit_hits', {
    p_older_than_hours: RATE_LIMIT_RETENTION_HOURS,
  })

  return NextResponse.json({
    ok: true,
    considered: due.length,
    ...counts,
    pruned: pruneError ? null : (pruned ?? 0),
  })
}

/** One follow-up's reminder. Never throws: a bad row must not stop the batch. */
async function notifyOne(
  followUp: DueFollowUp,
  now: Date,
): Promise<{ id: string; result: 'notified' | 'duplicate' | 'skipped' | 'failed' }> {
  const assignee = followUp.assignee

  // A deactivated account is not somewhere to send work. Left unstamped so the
  // reminder resumes if the follow-up is reassigned to someone active.
  if (!assignee || !assignee.is_active || !assignee.email) {
    return { id: followUp.id, result: 'failed' }
  }

  try {
    const outcome = await notifyFollowUpDue(toNotificationInput(followUp), assignee, { now })
    return { id: followUp.id, result: classify(outcome) }
  } catch {
    return { id: followUp.id, result: 'failed' }
  }
}

function classify(outcome: SendResult): 'notified' | 'duplicate' | 'skipped' | 'failed' {
  if (outcome.sent) return 'notified'
  if (outcome.reason === 'duplicate') return 'duplicate'
  if (outcome.reason === 'unconfigured') return 'skipped'
  return 'failed'
}

function toNotificationInput(followUp: DueFollowUp): FollowUpNotificationInput {
  return {
    id: followUp.id,
    contact_id: followUp.contact_id,
    title: followUp.title,
    details: followUp.details,
    due_at: followUp.due_at,
    priority: followUp.priority,
    contact: followUp.contact,
  }
}

/**
 * `Authorization: Bearer <CRON_SECRET>`, compared in constant time.
 * `timingSafeEqual` throws on a length mismatch, so length is checked first —
 * which leaks the secret's length and nothing else.
 */
function matchesBearer(header: string | null, expected: string): boolean {
  const provided = header?.startsWith('Bearer ') ? header.slice('Bearer '.length).trim() : null
  if (!provided) return false

  const a = Buffer.from(provided, 'utf8')
  const b = Buffer.from(expected, 'utf8')
  if (a.length !== b.length) return false

  return timingSafeEqual(a, b)
}
