import { beforeEach, describe, expect, it } from 'vitest'
import { MailchimpClient } from '@/lib/mailchimp/client'
import {
  campaignActivityDedupeKey,
  campaignTimelineDedupeKey,
  canonicalTimestamp,
  matchContact,
  memberStatusDedupeKey,
  type ContactCandidate,
} from '@/lib/mailchimp/matching'
import {
  runMailchimpJobs,
  syncAudiences,
  syncCampaignActivity,
  syncCampaigns,
  syncMembers,
  type SyncDatabase,
  type SyncDeps,
  type SyncOptions,
} from '@/lib/mailchimp/sync'
import { MAILCHIMP_JOBS } from '@/lib/mailchimp/jobs'
import type {
  MailchimpCampaign,
  MailchimpCampaignReport,
  MailchimpEmailActivity,
  MailchimpMember,
} from '@/lib/mailchimp/types'
import { createFakeMailchimpApi, type FakeApiData } from './helpers/fake-mailchimp'
import { FakeSupabase } from './helpers/fake-supabase'

/**
 * The sync engine, run against a fake HTTP transport and a fake database that
 * enforces the real unique indexes.
 *
 * The headline assertion is the same one the integration promises: run a job
 * twice against the same provider payload and the second run must change
 * nothing. Everything else here — matching precedence, key determinism, event
 * counting — is what that promise rests on.
 */

const NOW = '2026-08-05T12:00:00.000Z'
const LIST_ID = 'list-abc'
const NEWSLETTER_TYPE = 'type-newsletter'

const MEMBERS: MailchimpMember[] = [
  {
    id: 'hash-ruth',
    email_address: 'Ruth@example.org',
    status: 'subscribed',
    merge_fields: { FNAME: 'Ruth', LNAME: 'Alvarez' },
    timestamp_opt: '2026-02-01T09:00:00+00:00',
    last_changed: '2026-07-01T10:00:00+00:00',
    vip: true,
    member_rating: 4,
  },
  {
    id: 'hash-sam',
    email_address: 'sam@example.org',
    status: 'subscribed',
    merge_fields: { FNAME: 'Sam', LNAME: 'Okoye' },
    last_changed: '2026-07-02T10:00:00+00:00',
  },
  {
    id: 'hash-new',
    email_address: 'newcomer@example.org',
    status: 'subscribed',
    merge_fields: { FNAME: 'Nia', LNAME: 'Bello' },
    last_changed: '2026-07-03T10:00:00+00:00',
  },
  {
    id: 'hash-gone',
    email_address: 'gone@example.org',
    status: 'unsubscribed',
    merge_fields: {},
    last_changed: '2026-07-04T10:00:00+00:00',
    unsubscribe_reason: 'Too many emails',
  },
]

const CAMPAIGN: MailchimpCampaign = {
  id: 'camp-1',
  web_id: 991,
  type: 'regular',
  status: 'sent',
  send_time: '2026-08-01T09:00:00+00:00',
  emails_sent: 4,
  archive_url: 'https://mailchi.mp/example/august',
  recipients: { list_id: LIST_ID, list_name: 'Ministry Update' },
  settings: { title: 'August update', subject_line: 'What God is doing this month' },
  report_summary: { opens: 1, unique_opens: 1, open_rate: 0.25 },
}

const REPORT: MailchimpCampaignReport = {
  id: 'camp-1',
  campaign_title: 'August update',
  emails_sent: 4,
  unsubscribed: 1,
  send_time: '2026-08-01T09:00:00+00:00',
  bounces: { hard_bounces: 1, soft_bounces: 0, syntax_errors: 0 },
  opens: { opens_total: 5, unique_opens: 2, open_rate: 0.5 },
  clicks: { clicks_total: 3, unique_subscriber_clicks: 1, click_rate: 0.25 },
}

const EMAIL_ACTIVITY: MailchimpEmailActivity[] = [
  {
    email_id: 'hash-ruth',
    email_address: 'Ruth@example.org',
    activity: [
      { action: 'open', timestamp: '2026-08-01T10:00:00+00:00' },
      { action: 'open', timestamp: '2026-08-01T12:00:00+00:00' },
      { action: 'click', timestamp: '2026-08-01T12:05:00+00:00', url: 'https://graceforce.example/give' },
    ],
  },
  {
    email_id: 'hash-new',
    email_address: 'newcomer@example.org',
    activity: [{ action: 'bounce', timestamp: '2026-08-01T09:05:00+00:00', type: 'hard' }],
  },
  {
    email_address: 'stranger@example.org',
    activity: [{ action: 'open', timestamp: '2026-08-01T11:00:00+00:00' }],
  },
]

const FULL_API: FakeApiData = {
  lists: [
    {
      id: LIST_ID,
      name: 'Ministry Update',
      web_id: 4242,
      permission_reminder: 'You signed up at a Grace Force event.',
      stats: { member_count: 4, unsubscribe_count: 1, cleaned_count: 0 },
    },
  ],
  membersByList: { [LIST_ID]: MEMBERS },
  campaigns: [CAMPAIGN],
  reports: { 'camp-1': REPORT },
  activityByCampaign: { 'camp-1': EMAIL_ACTIVITY },
}

interface Harness {
  db: FakeSupabase
  deps: SyncDeps
  requests: string[]
}

function harness(data: FakeApiData = FULL_API, options: Partial<SyncOptions> = {}): Harness {
  const db = new FakeSupabase()
  db.seed('engagement_types', [
    { id: NEWSLETTER_TYPE, slug: 'newsletter', label: 'Newsletter' },
    { id: 'type-donor', slug: 'donor', label: 'Donor' },
  ])

  const api = createFakeMailchimpApi(data)
  // A small page size makes every job walk more than one page.
  const client = new MailchimpClient(
    { apiKey: 'key', serverPrefix: 'us1' },
    { fetchImpl: api.fetch, pageSize: 2 },
  )

  return {
    db,
    requests: api.requests,
    deps: {
      client,
      db: db as unknown as SyncDatabase,
      options: { autoCreateContacts: true, now: () => new Date(NOW), ...options },
    },
  }
}

/** The contacts the CRM already knows, before any Mailchimp data arrives. */
function seedContacts(db: FakeSupabase): void {
  db.seed('contacts', [
    { first_name: 'Ruth', last_name: 'Alvarez', email: 'RUTH@example.org' },
    { first_name: 'Sam', last_name: 'Okoye', email: 'samuel@work.example', secondary_email: 'Sam@Example.org' },
    { first_name: 'Gerald', last_name: 'Onslow', email: 'gone@example.org' },
  ])
}

/** Clears the incremental watermark so a job re-reads everything it saw before. */
function forceFullRepull(db: FakeSupabase): void {
  for (const audience of db.rows('mailchimp_audiences')) audience.last_synced_at = null
}

// --- Contact matching -------------------------------------------------------

describe('matchContact', () => {
  const candidates: ContactCandidate[] = [
    {
      id: 'contact-primary',
      email_normalized: 'ruth@example.org',
      secondary_email: null,
      created_at: '2026-03-01T00:00:00.000Z',
    },
    {
      id: 'contact-secondary',
      email_normalized: 'other@example.org',
      secondary_email: 'Ruth@Example.ORG',
      created_at: '2026-01-01T00:00:00.000Z',
    },
  ]

  it('prefers the primary email even when a secondary match is older', () => {
    expect(matchContact({ email_address: 'ruth@example.org' }, candidates, { autoCreateContacts: true })).toEqual({
      kind: 'matched',
      contactId: 'contact-primary',
      method: 'email',
    })
  })

  it('falls back to a case-insensitive secondary email', () => {
    const withoutPrimary = candidates.filter((candidate) => candidate.id !== 'contact-primary')
    expect(
      matchContact({ email_address: 'RUTH@example.org' }, withoutPrimary, { autoCreateContacts: true }),
    ).toEqual({ kind: 'matched', contactId: 'contact-secondary', method: 'secondary_email' })
  })

  it('breaks a tie on the oldest contact, so the answer never moves', () => {
    const duplicates: ContactCandidate[] = [
      { id: 'newer', email_normalized: 'ruth@example.org', secondary_email: null, created_at: '2026-05-01T00:00:00.000Z' },
      { id: 'older', email_normalized: 'ruth@example.org', secondary_email: null, created_at: '2026-02-01T00:00:00.000Z' },
    ]
    const forwards = matchContact({ email_address: 'ruth@example.org' }, duplicates, { autoCreateContacts: true })
    const backwards = matchContact({ email_address: 'ruth@example.org' }, [...duplicates].reverse(), {
      autoCreateContacts: true,
    })

    expect(forwards).toEqual({ kind: 'matched', contactId: 'older', method: 'email' })
    expect(backwards).toEqual(forwards)
  })

  it('drafts a contact from the merge fields when nothing matches', () => {
    expect(
      matchContact(
        { email_address: ' New@Example.org ', merge_fields: { FNAME: ' Nia ', LNAME: 'Bello', PHONE: 5551234 } },
        [],
        { autoCreateContacts: true },
      ),
    ).toEqual({
      kind: 'create',
      draft: { first_name: 'Nia', last_name: 'Bello', email: 'New@Example.org' },
    })
  })

  it('leaves the subscriber for review when auto-creation is off', () => {
    expect(matchContact({ email_address: 'new@example.org' }, [], { autoCreateContacts: false })).toEqual({
      kind: 'unmatched',
    })
  })

  it('cannot resolve a member with no address', () => {
    expect(matchContact({ email_address: '  ' }, [], { autoCreateContacts: true })).toEqual({
      kind: 'unmatched',
    })
  })
})

// --- Dedupe keys ------------------------------------------------------------

describe('dedupe keys', () => {
  it('reduces provider and database timestamp formats to one key', () => {
    const fromProvider = memberStatusDedupeKey({
      status: 'subscribed',
      listId: LIST_ID,
      memberHash: 'hash-ruth',
      lastChanged: '2026-07-01T10:00:00+00:00',
    })
    const fromDatabase = memberStatusDedupeKey({
      status: 'subscribed',
      listId: LIST_ID,
      memberHash: 'hash-ruth',
      lastChanged: '2026-07-01T10:00:00.000Z',
    })

    expect(fromProvider).toBe('mailchimp:subscribed:list-abc:hash-ruth:2026-07-01T10:00:00.000Z')
    expect(fromDatabase).toBe(fromProvider)
  })

  it('separates a re-subscription from the original', () => {
    const first = memberStatusDedupeKey({
      status: 'subscribed',
      listId: LIST_ID,
      memberHash: 'hash-ruth',
      lastChanged: '2026-01-01T00:00:00Z',
    })
    const later = memberStatusDedupeKey({
      status: 'subscribed',
      listId: LIST_ID,
      memberHash: 'hash-ruth',
      lastChanged: '2026-07-01T00:00:00Z',
    })
    expect(first).not.toBe(later)
  })

  it('normalises the address in a campaign activity key', () => {
    expect(campaignActivityDedupeKey({ campaignId: 'camp-1', action: 'open', email: 'Ruth@Example.ORG' })).toBe(
      'mc:camp-1:open:ruth@example.org',
    )
  })

  it('distinguishes clicks by URL but keeps opens together', () => {
    const give = campaignActivityDedupeKey({
      campaignId: 'camp-1',
      action: 'click',
      email: 'ruth@example.org',
      url: 'https://graceforce.example/give',
    })
    const pray = campaignActivityDedupeKey({
      campaignId: 'camp-1',
      action: 'click',
      email: 'ruth@example.org',
      url: 'https://graceforce.example/pray',
    })

    expect(give).not.toBe(pray)
    expect(campaignActivityDedupeKey({ campaignId: 'camp-1', action: 'open', email: 'ruth@example.org' })).toBe(
      campaignActivityDedupeKey({ campaignId: 'camp-1', action: 'open', email: 'RUTH@EXAMPLE.ORG' }),
    )
  })

  it('gives a timeline entry one key per person per campaign per action', () => {
    expect(
      campaignTimelineDedupeKey({ campaignId: 'camp-1', action: 'click', email: 'Ruth@example.org' }),
    ).toBe('mailchimp:click:camp-1:ruth@example.org')
  })

  it('leaves an unparseable timestamp alone rather than inventing one', () => {
    expect(canonicalTimestamp('not a date')).toBe('not a date')
    expect(canonicalTimestamp(null)).toBe('')
  })
})

// --- Audiences --------------------------------------------------------------

describe('syncAudiences', () => {
  it('mirrors a list and records the run', async () => {
    const { db, deps } = harness()

    const result = await syncAudiences(deps)

    expect(result.status).toBe('succeeded')
    expect(result.stats).toMatchObject({ fetched: 1, created: 1, updated: 0 })
    expect(db.count('mailchimp_audiences')).toBe(1)

    const audience = db.rows('mailchimp_audiences')[0]!
    expect(audience.name).toBe('Ministry Update')
    expect(audience.member_count).toBe(4)
    expect(audience.web_id).toBe('4242')
    // The members job owns this stamp; the audiences job must not claim it.
    expect(audience.last_synced_at).toBeNull()

    const run = db.rows('integration_sync_runs')[0]!
    expect(run).toMatchObject({ integration: 'mailchimp', job: 'audiences', status: 'succeeded' })
    expect(run.finished_at).toBe(NOW)
  })

  it('creates nothing on a second run', async () => {
    const { db, deps } = harness()

    await syncAudiences(deps)
    const second = await syncAudiences(deps)

    expect(second.stats).toMatchObject({ created: 0, updated: 1 })
    expect(db.count('mailchimp_audiences')).toBe(1)
    expect(db.upserts.every((call) => call.onConflict === 'mailchimp_list_id')).toBe(true)
  })

  it('records a failure with the provider detail rather than throwing', async () => {
    const { db, deps } = harness()
    deps.client = new MailchimpClient(
      { apiKey: 'key', serverPrefix: 'us1' },
      {
        fetchImpl: async () =>
          new Response(JSON.stringify({ detail: 'API key revoked' }), { status: 401 }),
      },
    )

    const result = await syncAudiences(deps)

    expect(result.status).toBe('failed')
    expect(result.error).toContain('401')
    expect(result.error).toContain('API key revoked')
    expect(db.rows('integration_sync_runs')[0]).toMatchObject({ status: 'failed' })
  })

  it('says so when the configured audience is not visible to the key', async () => {
    const { deps } = harness(FULL_API, { audienceId: 'list-missing' })

    const result = await syncAudiences(deps)

    expect(result.status).toBe('partial')
    expect(result.warnings[0]).toContain('list-missing')
  })
})

// --- Members ----------------------------------------------------------------

describe('syncMembers', () => {
  let context: Harness

  beforeEach(async () => {
    context = harness()
    seedContacts(context.db)
    await syncAudiences(context.deps)
  })

  it('applies the matching rules in order and links every subscriber it can', async () => {
    const result = await syncMembers(context.deps)

    expect(result.status).toBe('succeeded')
    expect(result.stats).toMatchObject({ fetched: 4, members_upserted: 4, contacts_created: 1 })

    const byMember = new Map(
      context.db.rows('mailchimp_members').map((row) => [row.mailchimp_member_id, row]),
    )
    expect(byMember.get('hash-ruth')!.match_method).toBe('email')
    expect(byMember.get('hash-sam')!.match_method).toBe('secondary_email')
    expect(byMember.get('hash-new')!.match_method).toBe('created')
    expect(byMember.get('hash-gone')!.match_method).toBe('email')
    for (const row of byMember.values()) {
      expect(row.contact_id).not.toBeNull()
      expect(row.matched_at).toBe(NOW)
    }

    // The created contact carries a stable natural key, so a re-import updates.
    const created = context.db
      .rows('contacts')
      .find((row) => row.email_normalized === 'newcomer@example.org')!
    expect(created).toMatchObject({
      first_name: 'Nia',
      last_name: 'Bello',
      source: 'mailchimp',
      external_source: 'mailchimp',
      external_id: 'hash-new',
      source_detail: 'Ministry Update',
    })
  })

  it('leaves a subscriber for review when auto-creation is off', async () => {
    const { db, deps } = harness(FULL_API, { autoCreateContacts: false })
    seedContacts(db)
    await syncAudiences(deps)

    const result = await syncMembers(deps)

    expect(result.stats).toMatchObject({ matched: 3, unmatched: 1 })
    expect(result.stats.contacts_created).toBeUndefined()
    const newcomer = db
      .rows('mailchimp_members')
      .find((row) => row.mailchimp_member_id === 'hash-new')!
    expect(newcomer.contact_id).toBeNull()
    expect(newcomer.match_method).toBeNull()
    expect(db.rows('contacts')).toHaveLength(3)
  })

  it('posts one timeline entry per subscribe or unsubscribe', async () => {
    await syncMembers(context.deps)

    const timeline = context.db.rows('activities')
    expect(timeline).toHaveLength(4)

    const unsubscribed = timeline.find((row) => row.type === 'mailchimp_unsubscribed')!
    expect(unsubscribed).toMatchObject({
      source: 'mailchimp',
      direction: 'inbound',
      actor_label: 'Mailchimp',
      subject: 'Unsubscribed from Ministry Update',
      body: 'Too many emails',
      occurred_at: '2026-07-04T10:00:00.000Z',
    })
    expect(unsubscribed.dedupe_key).toBe(
      'mailchimp:unsubscribed:list-abc:hash-gone:2026-07-04T10:00:00.000Z',
    )
  })

  it('starts a newsletter engagement for each subscribed contact, and only those', async () => {
    await syncMembers(context.deps)

    const engagements = context.db.rows('engagements')
    expect(engagements).toHaveLength(3)
    for (const engagement of engagements) {
      expect(engagement).toMatchObject({
        engagement_type_id: NEWSLETTER_TYPE,
        status: 'active',
        role_detail: 'Ministry Update',
      })
      expect(engagement.ended_on).toBeNull()
    }
    // Opt-in date where Mailchimp knows it, otherwise the last change.
    expect(engagements.map((row) => row.started_on).sort()).toEqual([
      '2026-02-01',
      '2026-07-02',
      '2026-07-03',
    ])
  })

  it('creates nothing on a full re-pull of unchanged members', async () => {
    await syncMembers(context.deps)
    const before = {
      members: context.db.snapshot('mailchimp_members', ['mailchimp_member_id', 'contact_id', 'status', 'match_method']),
      activities: context.db.snapshot('activities', ['dedupe_key']),
      engagements: context.db.snapshot('engagements', ['contact_id', 'engagement_type_id']),
      contacts: context.db.count('contacts'),
    }

    forceFullRepull(context.db)
    const second = await syncMembers(context.deps)

    expect(second.status).toBe('succeeded')
    expect(second.stats).toMatchObject({ fetched: 4, timeline_entries: 0 })
    expect(second.stats.contacts_created).toBeUndefined()
    expect(context.db.snapshot('mailchimp_members', ['mailchimp_member_id', 'contact_id', 'status', 'match_method']))
      .toEqual(before.members)
    expect(context.db.snapshot('activities', ['dedupe_key'])).toEqual(before.activities)
    expect(context.db.snapshot('engagements', ['contact_id', 'engagement_type_id'])).toEqual(
      before.engagements,
    )
    expect(context.db.count('contacts')).toBe(before.contacts)
  })

  it('never overwrites a link an admin made by hand', async () => {
    await syncMembers(context.deps)

    // An admin decides this address belongs to someone other than the contact
    // whose primary email matches it — a shared household mailbox, say.
    const corrected = context.db
      .rows('contacts')
      .find((row) => row.email_normalized === 'gone@example.org')!.id
    const member = context.db
      .rows('mailchimp_members')
      .find((row) => row.mailchimp_member_id === 'hash-ruth')!
    member.contact_id = corrected
    member.match_method = 'manual'
    member.matched_at = '2026-08-04T00:00:00.000Z'

    forceFullRepull(context.db)
    await syncMembers(context.deps)

    const after = context.db
      .rows('mailchimp_members')
      .find((row) => row.mailchimp_member_id === 'hash-ruth')!
    expect(after.contact_id).toBe(corrected)
    expect(after.match_method).toBe('manual')
    expect(after.matched_at).toBe('2026-08-04T00:00:00.000Z')
  })

  it('asks only for members changed since the last pull', async () => {
    await syncMembers(context.deps)
    context.requests.length = 0

    await syncMembers(context.deps)

    const since = new URL(`https://x${context.requests[0]}`).searchParams.get('since_last_changed')
    // Now minus the overlap window, so a clock skew cannot drop a member.
    expect(since).toBe('2026-08-05T11:59:00.000Z')
  })

  it('refuses to guess when no audience has been synced yet', async () => {
    const { deps } = harness()

    const result = await syncMembers(deps)

    expect(result.status).toBe('partial')
    expect(result.warnings[0]).toContain('audiences job')
  })
})

// --- Campaigns --------------------------------------------------------------

describe('syncCampaigns', () => {
  it('merges the report figures over the campaign summary', async () => {
    const { db, deps } = harness()
    await syncAudiences(deps)

    const result = await syncCampaigns(deps)

    expect(result.status).toBe('succeeded')
    expect(result.stats).toMatchObject({ fetched: 1, created: 1, reports_fetched: 1 })

    const campaign = db.rows('mailchimp_campaigns')[0]!
    expect(campaign).toMatchObject({
      mailchimp_campaign_id: 'camp-1',
      audience_id: db.rows('mailchimp_audiences')[0]!.id,
      subject_line: 'What God is doing this month',
      emails_sent: 4,
      // The report wins over `report_summary`, which is only a fallback.
      unique_opens: 2,
      open_rate: 0.5,
      subscriber_clicks: 1,
      unsubscribed: 1,
      bounces: 1,
      send_time: '2026-08-01T09:00:00.000Z',
    })
  })

  it('falls back to the inline summary when no report exists yet', async () => {
    const { db, deps } = harness({ ...FULL_API, reports: {} })
    await syncAudiences(deps)

    const result = await syncCampaigns(deps)

    expect(result.status).toBe('partial')
    expect(result.stats).toMatchObject({ reports_missing: 1 })
    expect(db.rows('mailchimp_campaigns')[0]).toMatchObject({ unique_opens: 1, open_rate: 0.25 })
  })

  it('creates nothing on a second run', async () => {
    const { db, deps } = harness()
    await syncAudiences(deps)

    await syncCampaigns(deps)
    const second = await syncCampaigns(deps)

    expect(second.stats).toMatchObject({ created: 0, updated: 1 })
    expect(db.count('mailchimp_campaigns')).toBe(1)
  })
})

// --- Campaign activity ------------------------------------------------------

describe('syncCampaignActivity', () => {
  let context: Harness

  beforeEach(async () => {
    context = harness()
    seedContacts(context.db)
    await syncAudiences(context.deps)
    await syncMembers(context.deps)
    await syncCampaigns(context.deps)
  })

  it('collapses repeated opens into one counted row', async () => {
    const result = await syncCampaignActivity(context.deps)

    expect(result.status).toBe('succeeded')

    const rows = context.db.rows('mailchimp_campaign_activity')
    // Ruth: two opens folded into one row, plus a click. Newcomer: a bounce.
    // Stranger: an open with nothing to link it to, still mirrored.
    expect(rows).toHaveLength(4)

    const open = rows.find((row) => row.dedupe_key === 'mc:camp-1:open:ruth@example.org')!
    expect(open).toMatchObject({ event_count: 2, action: 'open', url: null })
    expect(open.action_at).toBe('2026-08-01T12:00:00.000Z')
    expect(open.contact_id).not.toBeNull()

    const click = rows.find((row) => row.action === 'click')!
    expect(click.dedupe_key).toBe('mc:camp-1:click:ruth@example.org:https://graceforce.example/give')

    const stranger = rows.find((row) => row.email_address === 'stranger@example.org')!
    expect(stranger.contact_id).toBeNull()
    expect(stranger.member_id).toBeNull()
  })

  it('posts opens and clicks to the timeline, once each', async () => {
    const before = context.db.count('activities')

    await syncCampaignActivity(context.deps)

    const added = context.db.rows('activities').slice(before)
    expect(added).toHaveLength(2)
    expect(added.map((row) => row.type).sort()).toEqual([
      'mailchimp_campaign_clicked',
      'mailchimp_campaign_opened',
    ])

    const opened = added.find((row) => row.type === 'mailchimp_campaign_opened')!
    expect(opened.subject).toBe('Opened “August update”')
    expect(opened.dedupe_key).toBe('mailchimp:open:camp-1:ruth@example.org')
    // The first open is when they engaged, not the most recent one.
    expect(opened.occurred_at).toBe('2026-08-01T10:00:00.000Z')
  })

  it('does not post a timeline entry for a bounce', async () => {
    await syncCampaignActivity(context.deps)

    expect(
      context.db.rows('activities').some((row) => row.metadata?.action === 'bounce'),
    ).toBe(false)
  })

  it('creates nothing on a second run', async () => {
    await syncCampaignActivity(context.deps)
    const before = {
      activity: context.db.snapshot('mailchimp_campaign_activity', ['dedupe_key', 'event_count']),
      timeline: context.db.snapshot('activities', ['dedupe_key']),
    }

    const second = await syncCampaignActivity(context.deps)

    expect(second.status).toBe('succeeded')
    expect(second.stats.timeline_entries).toBe(0)
    expect(context.db.snapshot('mailchimp_campaign_activity', ['dedupe_key', 'event_count'])).toEqual(
      before.activity,
    )
    expect(context.db.snapshot('activities', ['dedupe_key'])).toEqual(before.timeline)
    expect(
      context.db.upserts
        .filter((call) => call.table === 'mailchimp_campaign_activity')
        .every((call) => call.onConflict === 'dedupe_key'),
    ).toBe(true)
  })
})

// --- Everything, twice ------------------------------------------------------

describe('runMailchimpJobs', () => {
  it('runs the jobs in dependency order whatever order they were asked for', async () => {
    const { db, deps } = harness()
    seedContacts(db)

    const results = await runMailchimpJobs(deps, ['activity', 'audiences', 'campaigns', 'members'])

    expect(results.map((result) => result.job)).toEqual([...MAILCHIMP_JOBS])
    expect(results.every((result) => result.status === 'succeeded')).toBe(true)
  })

  it('leaves the database identical when the whole sync is run twice', async () => {
    const { db, deps } = harness()
    seedContacts(db)

    await runMailchimpJobs(deps, [...MAILCHIMP_JOBS])
    forceFullRepull(db)

    const before = {
      audiences: db.snapshot('mailchimp_audiences', ['mailchimp_list_id', 'member_count']),
      members: db.snapshot('mailchimp_members', ['mailchimp_member_id', 'contact_id', 'status']),
      campaigns: db.snapshot('mailchimp_campaigns', ['mailchimp_campaign_id', 'unique_opens']),
      activity: db.snapshot('mailchimp_campaign_activity', ['dedupe_key', 'event_count']),
      timeline: db.snapshot('activities', ['dedupe_key', 'type']),
      contacts: db.snapshot('contacts', ['email_normalized']),
      engagements: db.snapshot('engagements', ['contact_id', 'engagement_type_id', 'status']),
    }

    await runMailchimpJobs(deps, [...MAILCHIMP_JOBS])

    expect(db.snapshot('mailchimp_audiences', ['mailchimp_list_id', 'member_count'])).toEqual(before.audiences)
    expect(db.snapshot('mailchimp_members', ['mailchimp_member_id', 'contact_id', 'status'])).toEqual(before.members)
    expect(db.snapshot('mailchimp_campaigns', ['mailchimp_campaign_id', 'unique_opens'])).toEqual(before.campaigns)
    expect(db.snapshot('mailchimp_campaign_activity', ['dedupe_key', 'event_count'])).toEqual(before.activity)
    expect(db.snapshot('activities', ['dedupe_key', 'type'])).toEqual(before.timeline)
    expect(db.snapshot('contacts', ['email_normalized'])).toEqual(before.contacts)
    expect(db.snapshot('engagements', ['contact_id', 'engagement_type_id', 'status'])).toEqual(before.engagements)

    // Eight runs recorded: four jobs, twice. The audit trail is the one thing
    // that is meant to grow.
    expect(db.count('integration_sync_runs')).toBe(8)
  })

  it('carries on after a failing job instead of abandoning the rest', async () => {
    const { db, deps } = harness({ ...FULL_API, membersByList: {} })
    seedContacts(db)

    const results = await runMailchimpJobs(deps, [...MAILCHIMP_JOBS])

    const byJob = new Map(results.map((result) => [result.job, result]))
    expect(byJob.get('members')!.status).toBe('failed')
    expect(byJob.get('campaigns')!.status).toBe('succeeded')
    expect(db.count('mailchimp_campaigns')).toBe(1)
  })
})
