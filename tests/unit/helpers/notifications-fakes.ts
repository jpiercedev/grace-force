import type { NotificationClient, Sender, Transport } from '@/lib/notifications/send'
import type { Json, NotificationStatus } from '@/types/database'

/**
 * Doubles for the notification outbox.
 *
 * The store reproduces the two database rules the send path depends on — the
 * unique `dedupe_key` and the `notifications_recipients_present` check — because
 * a fake that accepted everything would let the deduplication tests pass while
 * the real thing double-sent.
 */

export interface StoredNotification {
  id: string
  kind: string
  dedupe_key: string
  recipients: string[]
  subject: string
  body_text: string | null
  body_html: string | null
  status: NotificationStatus
  provider: string
  provider_message_id: string | null
  error: string | null
  attempts: number
  payload: Json
  related_contact_id: string | null
  related_lead_id: string | null
  related_follow_up_id: string | null
  sent_at: string | null
}

export interface FakeNotificationStore {
  client: NotificationClient
  rows: StoredNotification[]
  byKey(dedupeKey: string): StoredNotification | undefined
}

/** Resolves on a later microtask so concurrent callers genuinely interleave. */
function settle<T>(value: T): PromiseLike<T> {
  return Promise.resolve().then(() => value)
}

export function createNotificationStore(): FakeNotificationStore {
  const rows: StoredNotification[] = []
  const claimed = new Map<string, StoredNotification>()
  let sequence = 0

  const client: NotificationClient = {
    from() {
      return {
        upsert(values, options) {
          /*
           * Everything up to the point of decision runs synchronously, before
           * any promise is handed back. That is what `insert … on conflict do
           * nothing` gives you in Postgres, and it is the whole reason two
           * concurrent callers cannot both claim the same event.
           */
          const dedupeKey = values.dedupe_key
          const recipients = values.recipients ?? []
          const status: NotificationStatus = values.status ?? 'pending'

          const outcome = ((): {
            data: { id: string; attempts: number }[] | null
            error: { message: string } | null
          } => {
            if (!dedupeKey) {
              return { data: null, error: { message: 'null value in column "dedupe_key"' } }
            }

            if (claimed.has(dedupeKey)) {
              return options.ignoreDuplicates
                ? { data: [], error: null }
                : {
                    data: null,
                    error: {
                      message:
                        'duplicate key value violates unique constraint "notifications_dedupe_key_key"',
                    },
                  }
            }

            if (status !== 'skipped' && recipients.length === 0) {
              return {
                data: null,
                error: {
                  message:
                    'new row for relation "notifications" violates check constraint "notifications_recipients_present"',
                },
              }
            }

            const row: StoredNotification = {
              id: `ntf_${++sequence}`,
              kind: values.kind ?? '',
              dedupe_key: dedupeKey,
              recipients: [...recipients],
              subject: values.subject ?? '',
              body_text: values.body_text ?? null,
              body_html: values.body_html ?? null,
              status,
              provider: values.provider ?? 'resend',
              provider_message_id: values.provider_message_id ?? null,
              error: values.error ?? null,
              attempts: values.attempts ?? 0,
              payload: values.payload ?? {},
              related_contact_id: values.related_contact_id ?? null,
              related_lead_id: values.related_lead_id ?? null,
              related_follow_up_id: values.related_follow_up_id ?? null,
              sent_at: values.sent_at ?? null,
            }

            rows.push(row)
            claimed.set(dedupeKey, row)
            return { data: [{ id: row.id, attempts: row.attempts }], error: null }
          })()

          return { select: () => settle(outcome) }
        },

        update(values) {
          return {
            eq(_column, id) {
              const row = rows.find((candidate) => candidate.id === id)
              if (!row) {
                return settle({ error: { message: `no notification with id ${id}` } })
              }
              Object.assign(row, values)
              return settle({ error: null })
            },
          }
        },
      }
    },
  }

  return {
    client,
    rows,
    byKey: (dedupeKey) => claimed.get(dedupeKey),
  }
}

export interface SentMessage {
  from: string
  to: string[]
  subject: string
  text?: string
  html?: string
}

export interface FakeTransport {
  transport: () => Transport | null
  sent: SentMessage[]
  /** Makes every subsequent send reject, standing in for a provider outage. */
  failWith(message: string | null): void
}

export const FAKE_FROM = 'Grace Lead Manager <crm@gracelead.test>'

export function createTransport(): FakeTransport {
  const sent: SentMessage[] = []
  let failure: string | null = null

  const send: Sender = async (message) => {
    sent.push(message)
    if (failure) throw new Error(failure)
    return { id: `resend_${sent.length}` }
  }

  return {
    transport: () => ({ from: FAKE_FROM, send }),
    sent,
    failWith(message) {
      failure = message
    },
  }
}

/** Stands in for a deployment with no `RESEND_API_KEY`. */
export const unconfiguredTransport = (): Transport | null => null
