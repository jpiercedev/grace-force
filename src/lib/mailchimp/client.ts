import type {
  ListCampaignsOptions,
  ListMembersOptions,
  MailchimpCampaign,
  MailchimpCampaignReport,
  MailchimpCampaignsResponse,
  MailchimpEmailActivity,
  MailchimpEmailActivityResponse,
  MailchimpList,
  MailchimpListsResponse,
  MailchimpMember,
  MailchimpMembersResponse,
  PageOptions,
} from '@/lib/mailchimp/types'

/**
 * A small typed client over the Mailchimp Marketing API v3.
 *
 * Written against `fetch` rather than the vendor SDK: the surface used here is
 * five read-only endpoints, and a dependency that ships its own HTTP stack
 * would be more code than this file, not less.
 *
 * Both the configuration and the fetch implementation arrive through the
 * constructor, so the sync engine can be exercised end to end against a fake
 * transport without a network or an API key.
 */

/** Mailchimp caps a page at 1000; 500 keeps a member page under a megabyte. */
export const DEFAULT_PAGE_SIZE = 500
export const MAX_PAGE_SIZE = 1000

/**
 * A ceiling on requests per collection. An audience of five million would need
 * more, but a client that loops forever against a misbehaving endpoint is a
 * worse failure than one that stops and says so.
 */
export const MAX_PAGES = 200

export const DEFAULT_MAX_RETRIES = 3
const RETRY_BASE_MS = 1_000
const MAX_RETRY_DELAY_MS = 60_000

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export interface MailchimpClientConfig {
  apiKey: string
  serverPrefix: string
}

export interface MailchimpClientOptions {
  fetchImpl?: FetchLike
  /** Retries applied to 429 only. Anything else fails on the first response. */
  maxRetries?: number
  sleep?: (ms: number) => Promise<void>
  pageSize?: number
}

/**
 * A non-2xx response from Mailchimp.
 *
 * Carries the provider's own `status` and `detail` because those are what
 * makes a failure actionable: a 401 with "API key is invalid" and a 401 with
 * "wrong datacenter" need different fixes, and the sync run records the text
 * verbatim so an admin can read it later.
 */
export class MailchimpError extends Error {
  readonly status: number
  readonly detail: string | null
  readonly title: string | null
  readonly path: string

  constructor(
    status: number,
    path: string,
    options: { title?: string | null; detail?: string | null } = {},
  ) {
    const title = options.title ?? null
    const detail = options.detail ?? null
    super(`Mailchimp ${status} on ${path}${detail ? `: ${detail}` : title ? `: ${title}` : ''}`)
    this.name = 'MailchimpError'
    this.status = status
    this.path = path
    this.title = title
    this.detail = detail
  }
}

export function isMailchimpError(error: unknown): error is MailchimpError {
  return error instanceof MailchimpError
}

type QueryValue = string | number | undefined | null

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

/**
 * `Retry-After` is seconds in Mailchimp's responses. When it is missing or
 * unreadable the wait grows exponentially, so a rate-limited job backs off
 * instead of hammering the same limit three times in a row.
 */
export function retryDelayMs(header: string | null, attempt: number): number {
  const seconds = Number.parseInt(header ?? '', 10)
  const fromHeader = Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : null
  const backoff = RETRY_BASE_MS * 2 ** attempt
  return Math.min(fromHeader ?? backoff, MAX_RETRY_DELAY_MS)
}

export class MailchimpClient {
  private readonly baseUrl: string
  private readonly authorization: string
  private readonly fetchImpl: FetchLike
  private readonly maxRetries: number
  private readonly sleep: (ms: number) => Promise<void>
  private readonly pageSize: number

  constructor(config: MailchimpClientConfig, options: MailchimpClientOptions = {}) {
    this.baseUrl = `https://${config.serverPrefix}.api.mailchimp.com/3.0`
    // Mailchimp's documented scheme: any username, the key as the password.
    this.authorization = `Basic ${Buffer.from(`anystring:${config.apiKey}`, 'utf8').toString('base64')}`
    this.fetchImpl = options.fetchImpl ?? ((input, init) => fetch(input, init))
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES
    this.sleep = options.sleep ?? defaultSleep
    this.pageSize = clampPageSize(options.pageSize ?? DEFAULT_PAGE_SIZE)
  }

  // --- Endpoints ------------------------------------------------------------

  async listAudiences(options: PageOptions = {}): Promise<MailchimpList[]> {
    return this.collect<MailchimpListsResponse, MailchimpList>(
      '/lists',
      {},
      options,
      (payload) => payload.lists ?? [],
    )
  }

  async listMembers(listId: string, options: ListMembersOptions = {}): Promise<MailchimpMember[]> {
    return this.collect<MailchimpMembersResponse, MailchimpMember>(
      `/lists/${encodeURIComponent(listId)}/members`,
      {
        since_last_changed: options.sinceLastChanged,
        // `_links` is HATEOAS navigation the sync never follows, and it is a
        // large fraction of a member payload that would otherwise be stored.
        exclude_fields: 'members._links,_links',
      },
      options,
      (payload) => payload.members ?? [],
    )
  }

  /**
   * Sent campaigns only, newest first. A draft or a scheduled send has no
   * report and nothing to mirror, so filtering here rather than locally saves
   * pages of payload on an account that keeps many drafts.
   */
  async listCampaigns(options: ListCampaignsOptions = {}): Promise<MailchimpCampaign[]> {
    return this.collect<MailchimpCampaignsResponse, MailchimpCampaign>(
      '/campaigns',
      {
        status: 'sent',
        since_send_time: options.sinceSendTime,
        sort_field: 'send_time',
        sort_dir: 'DESC',
        exclude_fields: 'campaigns._links,_links',
      },
      options,
      (payload) => payload.campaigns ?? [],
    )
  }

  async getCampaignReport(campaignId: string): Promise<MailchimpCampaignReport> {
    return this.request<MailchimpCampaignReport>(
      `/reports/${encodeURIComponent(campaignId)}`,
      { exclude_fields: '_links' },
    )
  }

  /** Per-subscriber opens, clicks and bounces for one campaign. */
  async listCampaignEmailActivity(
    campaignId: string,
    options: PageOptions = {},
  ): Promise<MailchimpEmailActivity[]> {
    return this.collect<MailchimpEmailActivityResponse, MailchimpEmailActivity>(
      `/reports/${encodeURIComponent(campaignId)}/email-activity`,
      { exclude_fields: 'emails._links,_links' },
      options,
      (payload) => payload.emails ?? [],
    )
  }

  // --- Transport ------------------------------------------------------------

  /**
   * Walks a collection endpoint to the end.
   *
   * Pages are requested serially. Mailchimp allows ten concurrent connections
   * per key across the whole account, and a sync that saturates them would
   * starve anything else the ministry runs against the same key.
   */
  private async collect<R, T>(
    path: string,
    params: Record<string, QueryValue>,
    page: PageOptions,
    select: (payload: R) => T[],
  ): Promise<T[]> {
    const count = clampPageSize(page.count ?? this.pageSize)
    let offset = Math.max(0, page.offset ?? 0)
    const collected: T[] = []

    for (let request = 0; request < MAX_PAGES; request += 1) {
      const payload = await this.request<R>(path, { ...params, count, offset })
      const items = select(payload)
      collected.push(...items)
      offset += items.length

      const total = (payload as { total_items?: number }).total_items
      // A short page means the end, whether or not the reported total agrees;
      // relying on `total_items` alone loops forever if it is ever wrong.
      if (items.length === 0 || items.length < count) break
      if (typeof total === 'number' && offset >= total) break
    }

    return collected
  }

  private async request<T>(path: string, params: Record<string, QueryValue> = {}): Promise<T> {
    const url = this.buildUrl(path, params)

    for (let attempt = 0; ; attempt += 1) {
      const response = await this.fetchImpl(url, {
        method: 'GET',
        headers: {
          Authorization: this.authorization,
          Accept: 'application/json',
        },
      })

      if (response.status === 429 && attempt < this.maxRetries) {
        await this.sleep(retryDelayMs(response.headers.get('retry-after'), attempt))
        continue
      }

      if (!response.ok) {
        const problem = await readProblem(response)
        throw new MailchimpError(response.status, path, problem)
      }

      return (await response.json()) as T
    }
  }

  private buildUrl(path: string, params: Record<string, QueryValue>): string {
    const url = new URL(`${this.baseUrl}${path}`)
    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null || value === '') continue
      url.searchParams.set(key, String(value))
    }
    return url.toString()
  }
}

function clampPageSize(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_PAGE_SIZE
  return Math.min(Math.max(Math.trunc(value), 1), MAX_PAGE_SIZE)
}

/**
 * Mailchimp reports errors as RFC 7807 problem documents. A body that is not
 * JSON at all — a proxy's HTML error page, say — still has to produce a usable
 * error rather than a parse failure that hides the status code.
 */
async function readProblem(
  response: Response,
): Promise<{ title: string | null; detail: string | null }> {
  try {
    const body = (await response.json()) as { title?: unknown; detail?: unknown }
    return { title: text(body.title), detail: text(body.detail) }
  } catch {
    return { title: null, detail: null }
  }
}
