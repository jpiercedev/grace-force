import { NextResponse, type NextRequest } from 'next/server'
import { hasServiceRoleKey, leadIntakeConfig, serviceRoleKey, siteUrl } from '@/lib/env'
import { HONEYPOT_FIELD, type LeadIntakeResult } from '@/lib/leads/form'
import {
  clientIpFrom,
  hashIp,
  intakeFieldErrors,
  isHoneypotTripped,
  isOriginAllowed,
  leadDedupeKey,
  leadIntakeSchema,
  matchesIntakeSecret,
  rateLimitBucket,
  utmFrom,
} from '@/lib/leads/intake'
import { notifyLeadCreated } from '@/lib/notifications/events'
/*
 * The public intake route is one of the three sanctioned service-role callers.
 * `anon` holds no table privileges by design, so an unauthenticated visitor
 * cannot reach `leads` any other way.
 */
// eslint-disable-next-line no-restricted-imports
import { createAdminClient } from '@/lib/supabase/admin'

/**
 * The public front door.
 *
 * Layered so that no single control has to be perfect: origin allow-list,
 * optional shared secret, per-IP rate limit, honeypot, schema validation and a
 * deterministic dedupe key whose unique index collapses double-submits. The
 * response never distinguishes "rejected as spam" from "accepted", and never
 * carries an internal error message.
 */

/** Fixed window matching `LEAD_INTAKE_RATE_LIMIT`, which is documented per hour. */
const RATE_LIMIT_WINDOW_SECONDS = 3600

/**
 * Nothing legitimate approaches this. Enforced before the body is read so a
 * flood of large payloads costs a header parse rather than memory.
 */
const MAX_BODY_BYTES = 64 * 1024

const GENERIC_REJECTION = 'That submission could not be accepted.'

export async function POST(request: NextRequest): Promise<NextResponse> {
  const config = leadIntakeConfig()
  const origin = request.headers.get('origin')

  if (!isOriginAllowed(origin, allowedOrigins(request, config.allowedOrigins), siteUrl())) {
    return reject(403, GENERIC_REJECTION, null)
  }

  if (!matchesIntakeSecret(request.headers.get('x-crm-intake-key'), config.secret)) {
    return reject(401, GENERIC_REJECTION, origin)
  }

  // Without the service-role key there is no way to write as an anonymous
  // visitor. Say so as a server fault, not as a rejection of the enquiry.
  if (!hasServiceRoleKey()) {
    return reject(503, 'Lead intake is not configured on this deployment.', origin)
  }

  const declaredLength = Number.parseInt(request.headers.get('content-length') ?? '', 10)
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return reject(413, GENERIC_REJECTION, origin)
  }

  const payload = await readPayload(request)
  if (!payload) return reject(400, 'Send a JSON object or a form submission.', origin)

  // Read before validation: a bot that trips the honeypot usually also sends
  // rubbish in the real fields, and it must never see a validation message.
  const trapped = isHoneypotTripped(payload[HONEYPOT_FIELD])

  const parsed = leadIntakeSchema.safeParse(payload)
  if (!parsed.success) {
    if (trapped) return accept(null, origin)
    return NextResponse.json(
      {
        ok: false,
        error: 'Check the highlighted fields.',
        fieldErrors: intakeFieldErrors(parsed.error),
      } satisfies LeadIntakeResult,
      { status: 400, headers: corsHeaders(origin) },
    )
  }

  const lead = parsed.data
  const supabase = createAdminClient()

  // Rate limiting costs a database round-trip; schema validation does not. So
  // malformed floods are turned away for free, and only well-formed submissions
  // spend a slot — which also means a mistyped email cannot burn someone's
  // hourly budget before they get the message telling them to fix it.
  const ip = clientIpFrom(request.headers)
  const ipHash = ip ? hashIp(ip, ipSalt(config.secret)) : null
  const { data: withinBudget, error: rateLimitError } = await supabase.rpc('consume_rate_limit', {
    p_bucket: rateLimitBucket(ipHash ?? 'unattributed'),
    p_limit: config.rateLimit,
    p_window_seconds: RATE_LIMIT_WINDOW_SECONDS,
  })

  if (rateLimitError) return reject(503, GENERIC_REJECTION, origin)
  if (withinBudget === false) {
    // The window is fixed rather than sliding, so this is an upper bound — but
    // a well-behaved client backing off for an hour is exactly right.
    return reject(429, 'Too many submissions. Please try again later.', origin, {
      'Retry-After': String(RATE_LIMIT_WINDOW_SECONDS),
    })
  }

  const dedupeKey = leadDedupeKey({
    form_key: lead.form_key,
    email: lead.email,
    phone: lead.phone,
    message: lead.message,
  })

  const { data: inserted, error: insertError } = await supabase
    .from('leads')
    .insert({
      first_name: lead.first_name,
      last_name: lead.last_name,
      email: lead.email,
      phone: lead.phone,
      organization_name: lead.organization_name,
      message: lead.message,
      interest: lead.interest,
      form_key: lead.form_key,
      page_url: lead.page_url,
      utm: utmFrom(lead),
      ip_hash: ipHash,
      user_agent: request.headers.get('user-agent')?.slice(0, 500) ?? null,
      honeypot_tripped: trapped,
      // Spam is stored rather than discarded: it is the only evidence available
      // if a form starts being abused, and it stays out of the triage queue.
      status: trapped ? 'spam' : 'new',
      dedupe_key: dedupeKey,
    })
    .select('id')
    .single()

  if (insertError) {
    // The unique index on dedupe_key is what makes a double-submit idempotent.
    if (insertError.code === '23505') {
      const { data: existing } = await supabase
        .from('leads')
        .select('id')
        .eq('dedupe_key', dedupeKey)
        .maybeSingle()
      return accept(existing?.id ?? null, origin)
    }
    return reject(503, GENERIC_REJECTION, origin)
  }

  if (!trapped) {
    // A notification failure must never cost the enquiry: the lead is already
    // safely stored, and the queue is the system of record either way.
    try {
      await notifyLeadCreated({
        id: inserted.id,
        first_name: lead.first_name,
        last_name: lead.last_name,
        email: lead.email,
        phone: lead.phone,
        organization_name: lead.organization_name,
        message: lead.message,
        form_key: lead.form_key,
        interest: lead.interest,
      })
    } catch {
      // Deliberately swallowed — see above.
    }
  }

  return accept(inserted.id, origin)
}

/** CORS preflight. Only an origin that would be accepted is echoed back. */
export async function OPTIONS(request: NextRequest): Promise<NextResponse> {
  const config = leadIntakeConfig()
  const origin = request.headers.get('origin')

  if (!isOriginAllowed(origin, allowedOrigins(request, config.allowedOrigins), siteUrl())) {
    return new NextResponse(null, { status: 403, headers: { Vary: 'Origin' } })
  }

  return new NextResponse(null, {
    status: 204,
    headers: {
      ...corsHeaders(origin),
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'content-type, x-crm-intake-key',
      'Access-Control-Max-Age': '86400',
    },
  })
}

/**
 * The deployment's own origin counts as allowed alongside the configured list.
 * `NEXT_PUBLIC_SITE_URL` is the public one; `request.nextUrl.origin` is what
 * the app is actually being served on, which differs behind a proxy — and the
 * form this route serves posts from one of the two.
 */
function allowedOrigins(request: NextRequest, configured: readonly string[]): string[] {
  return [...configured, request.nextUrl.origin]
}

/**
 * Salt for the stored IP hash. The intake secret is preferred; the service-role
 * key is the fallback because this route already requires it and it never
 * reaches a browser. Rotating either resets the rate-limit buckets, which is
 * harmless — they expire hourly regardless.
 */
function ipSalt(secret: string | null): string {
  return secret ?? serviceRoleKey()
}

function corsHeaders(origin: string | null): Record<string, string> {
  // `Vary` even when no origin is echoed, so a cache cannot serve one site's
  // CORS decision to another.
  return origin
    ? { 'Access-Control-Allow-Origin': origin, Vary: 'Origin' }
    : { Vary: 'Origin' }
}

function accept(id: string | null, origin: string | null): NextResponse {
  return NextResponse.json({ ok: true, ...(id ? { id } : {}) } satisfies LeadIntakeResult, {
    status: 200,
    headers: corsHeaders(origin),
  })
}

function reject(
  status: number,
  error: string,
  origin: string | null,
  headers: Record<string, string> = {},
): NextResponse {
  return NextResponse.json({ ok: false, error } satisfies LeadIntakeResult, {
    status,
    headers: { ...corsHeaders(origin), ...headers },
  })
}

/**
 * Accepts JSON and ordinary form encodings, so the endpoint works both from the
 * intake page's fetch and from a plain HTML form on a site that cannot run
 * JavaScript.
 */
async function readPayload(request: NextRequest): Promise<Record<string, unknown> | null> {
  const contentType = request.headers.get('content-type') ?? ''

  if (contentType.includes('application/json')) {
    try {
      const body: unknown = await request.json()
      return body !== null && typeof body === 'object' && !Array.isArray(body)
        ? (body as Record<string, unknown>)
        : null
    } catch {
      return null
    }
  }

  if (
    contentType.includes('application/x-www-form-urlencoded') ||
    contentType.includes('multipart/form-data')
  ) {
    try {
      const form = await request.formData()
      const fields: Record<string, unknown> = {}
      for (const [key, value] of form.entries()) {
        // File uploads have no place in a lead form; ignore anything non-textual.
        if (typeof value === 'string') fields[key] = value
      }
      return fields
    } catch {
      return null
    }
  }

  return null
}
