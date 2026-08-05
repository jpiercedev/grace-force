import type { FetchLike } from '@/lib/mailchimp/client'
import type {
  MailchimpCampaign,
  MailchimpCampaignReport,
  MailchimpEmailActivity,
  MailchimpList,
  MailchimpMember,
} from '@/lib/mailchimp/types'

/**
 * Fake transports for the Mailchimp client.
 *
 * `createFakeMailchimpApi` serves real-shaped payloads with real pagination,
 * so the sync tests exercise the actual client rather than a stubbed one — the
 * pagination and the idempotency claims are then about the code that ships.
 * `scriptedFetch` is the blunter one, for asserting transport behaviour such
 * as retries and error mapping.
 */

export interface FakeApiData {
  lists?: MailchimpList[]
  membersByList?: Record<string, MailchimpMember[]>
  campaigns?: MailchimpCampaign[]
  reports?: Record<string, MailchimpCampaignReport>
  activityByCampaign?: Record<string, MailchimpEmailActivity[]>
}

export interface FakeApi {
  fetch: FetchLike
  /** Every request path with its query string, in order. */
  requests: string[]
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

function problem(status: number, detail: string): Response {
  return json({ type: 'about:blank', title: 'Error', status, detail }, status)
}

function page<T>(items: T[], url: URL, key: string): Response {
  const count = Number.parseInt(url.searchParams.get('count') ?? '10', 10)
  const offset = Number.parseInt(url.searchParams.get('offset') ?? '0', 10)
  return json({ [key]: items.slice(offset, offset + count), total_items: items.length })
}

export function createFakeMailchimpApi(data: FakeApiData): FakeApi {
  const requests: string[] = []

  const fetchImpl: FetchLike = async (input) => {
    const url = new URL(input)
    requests.push(`${url.pathname}${url.search}`)
    const path = url.pathname.replace(/^\/3\.0/, '')

    if (path === '/lists') {
      return page(data.lists ?? [], url, 'lists')
    }

    const members = /^\/lists\/([^/]+)\/members$/.exec(path)
    if (members) {
      const listId = decodeURIComponent(members[1]!)
      const all = data.membersByList?.[listId]
      if (!all) return problem(404, `List ${listId} not found`)
      const since = url.searchParams.get('since_last_changed')
      const filtered = since
        ? all.filter((member) => (member.last_changed ?? '') >= since)
        : all
      return page(filtered, url, 'members')
    }

    if (path === '/campaigns') {
      const sent = (data.campaigns ?? []).filter(
        (campaign) => url.searchParams.get('status') !== 'sent' || campaign.status === 'sent',
      )
      const since = url.searchParams.get('since_send_time')
      const filtered = since ? sent.filter((campaign) => (campaign.send_time ?? '') >= since) : sent
      const sorted = [...filtered].sort((a, b) => (b.send_time ?? '').localeCompare(a.send_time ?? ''))
      return page(sorted, url, 'campaigns')
    }

    const activity = /^\/reports\/([^/]+)\/email-activity$/.exec(path)
    if (activity) {
      const campaignId = decodeURIComponent(activity[1]!)
      return page(data.activityByCampaign?.[campaignId] ?? [], url, 'emails')
    }

    const report = /^\/reports\/([^/]+)$/.exec(path)
    if (report) {
      const campaignId = decodeURIComponent(report[1]!)
      const found = data.reports?.[campaignId]
      return found ? json(found) : problem(404, `No report for ${campaignId}`)
    }

    return problem(404, `Unhandled path ${path}`)
  }

  return { fetch: fetchImpl, requests }
}

export interface ScriptedStep {
  status?: number
  body?: unknown
  headers?: Record<string, string>
}

export interface ScriptedFetch {
  fetch: FetchLike
  requests: string[]
  slept: number[]
  sleep: (ms: number) => Promise<void>
}

/** Replays a fixed sequence of responses, repeating the last one thereafter. */
export function scriptedFetch(steps: ScriptedStep[]): ScriptedFetch {
  const requests: string[] = []
  const slept: number[] = []
  let index = 0

  const fetchImpl: FetchLike = async (input) => {
    requests.push(input)
    const step = steps[Math.min(index, steps.length - 1)] ?? {}
    index += 1
    return new Response(step.body === undefined ? '{}' : JSON.stringify(step.body), {
      status: step.status ?? 200,
      headers: { 'content-type': 'application/json', ...step.headers },
    })
  }

  return {
    fetch: fetchImpl,
    requests,
    slept,
    sleep: async (ms) => {
      slept.push(ms)
    },
  }
}
