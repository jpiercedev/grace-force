import { describe, expect, it } from 'vitest'
import {
  MailchimpClient,
  MailchimpError,
  isMailchimpError,
  retryDelayMs,
} from '@/lib/mailchimp/client'
import { createFakeMailchimpApi, scriptedFetch } from './helpers/fake-mailchimp'

/**
 * Transport behaviour: the parts of the integration that fail in production
 * long before any business logic does — pagination that stops one page short,
 * a rate limit that is retried forever, an error whose provider detail is
 * thrown away and cannot be diagnosed afterwards.
 */

function clientWith(fetchImpl: ReturnType<typeof scriptedFetch>) {
  return new MailchimpClient(
    { apiKey: 'key-us21', serverPrefix: 'us21' },
    { fetchImpl: fetchImpl.fetch, sleep: fetchImpl.sleep, maxRetries: 2 },
  )
}

describe('request construction', () => {
  it('targets the datacenter in the configured prefix', async () => {
    const scripted = scriptedFetch([{ body: { lists: [], total_items: 0 } }])
    await clientWith(scripted).listAudiences()

    expect(scripted.requests[0]).toMatch(/^https:\/\/us21\.api\.mailchimp\.com\/3\.0\/lists\?/)
  })

  it('authenticates with the key as a Basic password', async () => {
    let authorization: string | null = null
    const client = new MailchimpClient(
      { apiKey: 'secret-key', serverPrefix: 'us7' },
      {
        fetchImpl: async (_input, init) => {
          authorization = new Headers(init?.headers).get('authorization')
          return new Response(JSON.stringify({ lists: [], total_items: 0 }), { status: 200 })
        },
      },
    )
    await client.listAudiences()

    expect(authorization).toBe(`Basic ${Buffer.from('anystring:secret-key').toString('base64')}`)
  })

  it('asks only for sent campaigns', async () => {
    const scripted = scriptedFetch([{ body: { campaigns: [], total_items: 0 } }])
    await clientWith(scripted).listCampaigns({ sinceSendTime: '2026-01-01T00:00:00.000Z' })

    const url = new URL(scripted.requests[0]!)
    expect(url.searchParams.get('status')).toBe('sent')
    expect(url.searchParams.get('since_send_time')).toBe('2026-01-01T00:00:00.000Z')
  })

  it('leaves absent options out of the query string entirely', async () => {
    const scripted = scriptedFetch([{ body: { members: [], total_items: 0 } }])
    await clientWith(scripted).listMembers('list-1')

    const url = new URL(scripted.requests[0]!)
    expect(url.searchParams.has('since_last_changed')).toBe(false)
    expect(url.pathname).toBe('/3.0/lists/list-1/members')
  })
})

describe('pagination', () => {
  it('assembles every page of a collection', async () => {
    const members = Array.from({ length: 25 }, (_, index) => ({
      id: `member-${index}`,
      email_address: `person${index}@example.org`,
      status: 'subscribed',
    }))
    const api = createFakeMailchimpApi({ membersByList: { 'list-1': members } })
    const client = new MailchimpClient(
      { apiKey: 'key', serverPrefix: 'us1' },
      { fetchImpl: api.fetch, pageSize: 10 },
    )

    const collected = await client.listMembers('list-1')

    expect(collected).toHaveLength(25)
    expect(collected.map((member) => member.id)).toEqual(members.map((member) => member.id))
    // 10 + 10 + 5: the short third page ends the walk without a fourth request.
    expect(api.requests).toHaveLength(3)
    expect(api.requests.map((request) => new URL(`https://x${request}`).searchParams.get('offset')))
      .toEqual(['0', '10', '20'])
  })

  it('stops on an exactly-full final page without a wasted request', async () => {
    const members = Array.from({ length: 20 }, (_, index) => ({
      id: `member-${index}`,
      email_address: `person${index}@example.org`,
    }))
    const api = createFakeMailchimpApi({ membersByList: { 'list-1': members } })
    const client = new MailchimpClient(
      { apiKey: 'key', serverPrefix: 'us1' },
      { fetchImpl: api.fetch, pageSize: 10 },
    )

    expect(await client.listMembers('list-1')).toHaveLength(20)
    // Two full pages reach the reported total, so no third request is made.
    expect(api.requests).toHaveLength(2)
  })

  it('stops on a short page even when the reported total disagrees', async () => {
    const scripted = scriptedFetch([
      { body: { lists: [{ id: 'list-1' }], total_items: 999 } },
    ])
    const client = new MailchimpClient(
      { apiKey: 'key', serverPrefix: 'us1' },
      { fetchImpl: scripted.fetch, pageSize: 10 },
    )

    // A wrong `total_items` must not turn into two hundred requests.
    expect(await client.listAudiences()).toHaveLength(1)
    expect(scripted.requests).toHaveLength(1)
  })

  it('honours an explicit starting offset', async () => {
    const lists = Array.from({ length: 6 }, (_, index) => ({ id: `list-${index}` }))
    const api = createFakeMailchimpApi({ lists })
    const client = new MailchimpClient({ apiKey: 'key', serverPrefix: 'us1' }, { fetchImpl: api.fetch })

    const collected = await client.listAudiences({ count: 2, offset: 4 })

    expect(collected.map((list) => list.id)).toEqual(['list-4', 'list-5'])
  })
})

describe('rate limiting', () => {
  it('waits for the interval the provider asked for, then succeeds', async () => {
    const scripted = scriptedFetch([
      { status: 429, headers: { 'retry-after': '3' } },
      { status: 200, body: { lists: [{ id: 'list-1' }], total_items: 1 } },
    ])

    const lists = await clientWith(scripted).listAudiences()

    expect(lists.map((list) => list.id)).toEqual(['list-1'])
    expect(scripted.slept).toEqual([3000])
  })

  it('backs off exponentially when no Retry-After is given', async () => {
    const scripted = scriptedFetch([
      { status: 429 },
      { status: 429 },
      { status: 200, body: { lists: [], total_items: 0 } },
    ])

    await clientWith(scripted).listAudiences()

    expect(scripted.slept).toEqual([1000, 2000])
  })

  it('gives up after the bounded number of retries', async () => {
    const scripted = scriptedFetch([
      { status: 429, headers: { 'retry-after': '1' }, body: { detail: 'Too many requests' } },
    ])

    await expect(clientWith(scripted).listAudiences()).rejects.toBeInstanceOf(MailchimpError)
    // Two retries were configured, so three requests were made and no more.
    expect(scripted.requests).toHaveLength(3)
    expect(scripted.slept).toEqual([1000, 1000])
  })

  it('caps a preposterous Retry-After rather than sleeping for an hour', () => {
    expect(retryDelayMs('86400', 0)).toBe(60_000)
    expect(retryDelayMs(null, 3)).toBe(8000)
    expect(retryDelayMs('not a number', 0)).toBe(1000)
  })
})

describe('error handling', () => {
  it('throws a MailchimpError carrying the status and the provider detail', async () => {
    const scripted = scriptedFetch([
      {
        status: 401,
        body: { title: 'API Key Invalid', detail: 'Your API key may be invalid, or you have attempted to access the wrong datacenter.' },
      },
    ])

    const error = await clientWith(scripted)
      .listAudiences()
      .catch((caught: unknown) => caught)

    expect(isMailchimpError(error)).toBe(true)
    if (!isMailchimpError(error)) return
    expect(error.status).toBe(401)
    expect(error.title).toBe('API Key Invalid')
    expect(error.detail).toContain('wrong datacenter')
    expect(error.path).toBe('/lists')
    expect(error.message).toContain('401')
  })

  it('still reports the status when the body is not a problem document', async () => {
    const client = new MailchimpClient(
      { apiKey: 'key', serverPrefix: 'us1' },
      {
        fetchImpl: async () => new Response('<html>gateway timeout</html>', { status: 504 }),
      },
    )

    const error = await client.listAudiences().catch((caught: unknown) => caught)

    expect(isMailchimpError(error)).toBe(true)
    if (!isMailchimpError(error)) return
    expect(error.status).toBe(504)
    expect(error.detail).toBeNull()
  })

  it('does not retry a 500 — only a rate limit is worth waiting out', async () => {
    const scripted = scriptedFetch([{ status: 500, body: { detail: 'Internal error' } }])

    await expect(clientWith(scripted).listAudiences()).rejects.toBeInstanceOf(MailchimpError)
    expect(scripted.requests).toHaveLength(1)
  })

  it('reports a missing campaign report as a 404 rather than an empty report', async () => {
    const api = createFakeMailchimpApi({ reports: {} })
    const client = new MailchimpClient({ apiKey: 'key', serverPrefix: 'us1' }, { fetchImpl: api.fetch })

    const error = await client.getCampaignReport('campaign-1').catch((caught: unknown) => caught)

    expect(isMailchimpError(error)).toBe(true)
    if (isMailchimpError(error)) expect(error.status).toBe(404)
  })
})
