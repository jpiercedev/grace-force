import { resendConfig } from '@/lib/env'
import type { Database, Json } from '@/types/database'

/**
 * The notification outbox.
 *
 * `notifications` is not a log written after the fact — it *is* the
 * deduplication mechanism. Every send claims its `dedupe_key` first:
 *
 *   insert … on conflict (dedupe_key) do nothing returning id
 *
 * If that returns no row, another request or cron run already claimed the same
 * real-world event and this caller must send nothing. Because the claim is a
 * single atomic statement against a unique index, two concurrent callers cannot
 * both win — which is what makes "notify once" hold under concurrency, not just
 * on retry.
 *
 * Both the transport and the database client are injectable so the guarantee
 * can be tested without a network or a Postgres.
 */

type NotificationInsert = Database['public']['Tables']['notifications']['Insert']
type NotificationUpdate = Database['public']['Tables']['notifications']['Update']

export interface ClaimedRow {
  id: string
  attempts: number
}

export interface QueryError {
  message: string
}

/**
 * The narrow slice of the service-role client this module uses. Writing it out
 * lets the unit suite substitute an in-memory store that enforces the unique
 * `dedupe_key` for real, rather than a stub that would make the dedupe tests
 * prove nothing.
 */
export interface NotificationClient {
  from(table: 'notifications'): {
    upsert(
      values: NotificationInsert,
      options: { onConflict: string; ignoreDuplicates: boolean },
    ): { select(): PromiseLike<{ data: ClaimedRow[] | null; error: QueryError | null }> }
    update(values: NotificationUpdate): {
      eq(column: 'id', value: string): PromiseLike<{ error: QueryError | null }>
    }
  }
}

export type Sender = (msg: {
  from: string
  to: string[]
  subject: string
  text?: string
  html?: string
}) => Promise<{ id: string }>

export interface Transport {
  from: string
  send: Sender
}

export interface SendDeps {
  client?: NotificationClient
  /** Resolved lazily; returning null is the supported "Resend is not set up" mode. */
  transport?: () => Transport | null
}

export interface NotificationRelations {
  contactId?: string | null
  leadId?: string | null
  followUpId?: string | null
}

export interface SendNotificationInput {
  kind: string
  dedupeKey: string
  recipients: readonly string[]
  subject: string
  text?: string
  html?: string
  payload?: Json
  related?: NotificationRelations
}

export type SendFailureReason = 'duplicate' | 'unconfigured' | 'failed'

export type SendResult =
  | { sent: true; id: string; providerMessageId: string }
  | { sent: false; id: string | null; reason: SendFailureReason; error?: string }

/** Long enough to identify a provider fault, short enough to stay readable in the outbox. */
const MAX_ERROR_LENGTH = 500

export async function sendNotification(
  input: SendNotificationInput,
  deps: SendDeps = {},
): Promise<SendResult> {
  const recipients = normalizeRecipients(input.recipients)
  const transport = (deps.transport ?? resendTransport)()
  const client = deps.client ?? (await defaultClient())

  // Decided before the claim because the row is written in its final state when
  // there is nothing to send: `notifications_recipients_present` only tolerates
  // an empty recipient list on a `skipped` row, and claiming as `pending` would
  // otherwise leave a row no worker will ever resolve.
  const willSend = transport !== null && recipients.length > 0

  const claim = await client
    .from('notifications')
    .upsert(
      {
        kind: input.kind,
        dedupe_key: input.dedupeKey,
        recipients,
        subject: input.subject,
        body_text: input.text ?? null,
        body_html: input.html ?? null,
        status: willSend ? 'pending' : 'skipped',
        payload: input.payload ?? {},
        related_contact_id: input.related?.contactId ?? null,
        related_lead_id: input.related?.leadId ?? null,
        related_follow_up_id: input.related?.followUpId ?? null,
      },
      { onConflict: 'dedupe_key', ignoreDuplicates: true },
    )
    .select()

  if (claim.error) {
    return { sent: false, id: null, reason: 'failed', error: errorText(claim.error.message) }
  }

  const claimed = claim.data?.[0]
  // No row means the conflict clause fired: somebody else owns this event.
  if (!claimed) return { sent: false, id: null, reason: 'duplicate' }

  if (transport === null || recipients.length === 0) {
    return { sent: false, id: claimed.id, reason: 'unconfigured' }
  }

  try {
    const { id: providerMessageId } = await transport.send({
      from: transport.from,
      to: recipients,
      subject: input.subject,
      text: input.text,
      html: input.html,
    })

    await update(client, claimed.id, {
      status: 'sent',
      provider_message_id: providerMessageId,
      attempts: claimed.attempts + 1,
      error: null,
      sent_at: new Date().toISOString(),
    })

    return { sent: true, id: claimed.id, providerMessageId }
  } catch (cause) {
    const message = errorText(cause)
    // The row keeps the claim, so a retry inside the same dedupe window is
    // still suppressed; a key that carries a date rolls over on its own.
    await update(client, claimed.id, {
      status: 'failed',
      error: message,
      attempts: claimed.attempts + 1,
    })
    return { sent: false, id: claimed.id, reason: 'failed', error: message }
  }
}

/**
 * Bookkeeping after the fact. A failure here is not reported to the caller: the
 * claim is already durable, so the at-most-once guarantee holds regardless, and
 * the worst case is a row left reading `pending` in the outbox.
 */
async function update(
  client: NotificationClient,
  id: string,
  values: NotificationUpdate,
): Promise<void> {
  await client.from('notifications').update(values).eq('id', id)
}

/** Trims, drops blanks and de-duplicates so one address is never emailed twice. */
export function normalizeRecipients(recipients: readonly string[]): string[] {
  const seen = new Set<string>()
  for (const recipient of recipients) {
    const trimmed = recipient.trim()
    if (trimmed.includes('@')) seen.add(trimmed)
  }
  return [...seen]
}

/**
 * The outbox is one of the three sanctioned service-role callers: only Postgres
 * can arbitrate the claim, and no signed-in user is present when the cron runs.
 *
 * The client is imported lazily rather than at module scope because it is
 * marked `server-only`, which throws on import in a plain Node context, and the
 * unit suite loads this module to exercise the claim logic with its own client.
 *
 * The calls are spelled out rather than handing the client straight back
 * because PostgREST's builder types are deep enough that comparing them
 * structurally against the interface above defeats the compiler.
 */
async function defaultClient(): Promise<NotificationClient> {
  const { createAdminClient } = await import('@/lib/supabase/admin')
  const supabase = createAdminClient()

  return {
    from: (table) => ({
      upsert: (values, options) => ({
        select: async () => {
          const { data, error } = await supabase
            .from(table)
            .upsert(values, options)
            .select('id, attempts')
          return { data, error }
        },
      }),
      update: (values) => ({
        eq: async (column, value) => {
          const { error } = await supabase.from(table).update(values).eq(column, value)
          return { error }
        },
      }),
    }),
  }
}

function resendTransport(): Transport | null {
  const config = resendConfig()
  if (!config) return null

  return {
    from: config.fromEmail,
    send: async (message) => {
      const { Resend } = await import('resend')
      const resend = new Resend(config.apiKey)

      const { data, error } = await resend.emails.send({
        from: message.from,
        to: message.to,
        subject: message.subject,
        // Resend requires at least one body part; every caller sends both.
        html: message.html ?? '',
        text: message.text ?? '',
      })

      // Resend reports provider faults in the response body rather than by
      // rejecting, so they are re-thrown to reach the single failure path.
      if (error) throw new Error(error.message)
      if (!data) throw new Error('Resend returned no message id.')

      return { id: data.id }
    },
  }
}

function errorText(cause: unknown): string {
  const message =
    cause instanceof Error ? cause.message : typeof cause === 'string' ? cause : String(cause)
  return message.slice(0, MAX_ERROR_LENGTH)
}
