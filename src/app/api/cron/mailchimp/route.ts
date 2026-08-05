import { timingSafeEqual } from 'node:crypto'
import { NextResponse, type NextRequest } from 'next/server'
import { cronSecret } from '@/lib/env'
import { jobsFor, parseMailchimpJob } from '@/lib/mailchimp/jobs'
import { mailchimpUnavailableReason, runMailchimpSync } from '@/lib/mailchimp/run'

/**
 * Scheduled Mailchimp sync.
 *
 * `POST` is the honest verb for something that writes; `GET` is accepted too
 * because most platform schedulers — Vercel Cron among them — only issue GET.
 * Both go through the same bearer-token check.
 *
 * The response reports every job separately. A partial outcome is a real
 * outcome here: campaigns can mirror perfectly while one audience's members
 * fail, and collapsing that into a single boolean would hide it.
 */

export const dynamic = 'force-dynamic'

type Denial = { status: number; error: string }

/**
 * Constant-time comparison. `timingSafeEqual` throws on a length mismatch, so
 * length is checked first — which leaks the secret's length and nothing else.
 */
function secretMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, 'utf8')
  const b = Buffer.from(expected, 'utf8')
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

function bearerToken(request: NextRequest): string | null {
  const header = request.headers.get('authorization') ?? ''
  if (!/^Bearer /i.test(header)) return null
  const token = header.slice(7).trim()
  return token === '' ? null : token
}

/**
 * An unset `CRON_SECRET` is refused in production rather than run openly: an
 * unauthenticated endpoint that spends the ministry's Mailchimp rate limit is
 * a denial-of-service waiting to be found. Locally it is allowed, so the job
 * can be exercised without inventing a secret first.
 */
function authorize(request: NextRequest): Denial | null {
  const expected = cronSecret()

  if (!expected) {
    if (process.env.NODE_ENV === 'production') {
      return {
        status: 503,
        error:
          'CRON_SECRET is not configured, so scheduled jobs are disabled. Set it and send it as "Authorization: Bearer <secret>".',
      }
    }
    return null
  }

  const token = bearerToken(request)
  if (!token || !secretMatches(token, expected)) {
    return { status: 401, error: 'Unauthorized.' }
  }
  return null
}

async function handle(request: NextRequest): Promise<NextResponse> {
  const denied = authorize(request)
  if (denied) return NextResponse.json({ ok: false, error: denied.error }, { status: denied.status })

  const selection = parseMailchimpJob(request.nextUrl.searchParams.get('job'))
  if (!selection) {
    return NextResponse.json(
      { ok: false, error: 'Unknown job. Use job=audiences, members, campaigns, activity or all.' },
      { status: 400 },
    )
  }

  const unavailable = mailchimpUnavailableReason()
  if (unavailable) return NextResponse.json({ ok: false, error: unavailable }, { status: 503 })

  const runs = await runMailchimpSync(jobsFor(selection))
  const succeeded = runs.some((run) => run.status !== 'failed')

  return NextResponse.json(
    {
      ok: succeeded,
      job: selection,
      runs: runs.map((run) => ({
        job: run.job,
        status: run.status,
        stats: run.stats,
        warnings: run.warnings,
        error: run.error,
      })),
    },
    // A scheduler should retry a run in which nothing worked at all, and leave
    // a partial one alone — the recorded run row already explains it.
    { status: succeeded ? 200 : 502 },
  )
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  return handle(request)
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  return handle(request)
}
