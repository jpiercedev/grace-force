import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  followUpAssignedKey,
  followUpDueKey,
  leadCreatedKey,
  notifyFollowUpAssigned,
  notifyFollowUpDue,
  notifyLeadCreated,
  type FollowUpNotificationInput,
  type LeadNotificationInput,
  type NotificationProfile,
} from '@/lib/notifications/events'
import { normalizeRecipients, sendNotification } from '@/lib/notifications/send'
import { escapeHtml, renderEmail } from '@/lib/notifications/templates'
import {
  FAKE_FROM,
  createNotificationStore,
  createTransport,
  unconfiguredTransport,
} from './helpers/notifications-fakes'

/**
 * The guarantee under test is "notify once per real-world event, and never
 * throw at the caller". Everything here runs against an in-memory store that
 * enforces the unique `dedupe_key` and the recipients check constraint, so a
 * regression in the claim ordering fails here rather than in production inboxes.
 */

const NOW = new Date('2026-08-05T09:30:00.000Z')

const LEAD: LeadNotificationInput = {
  id: 'lead-1',
  first_name: 'Jane',
  last_name: 'Okafor',
  email: 'jane@example.org',
  phone: null,
  organization_name: 'Hope Church',
  message: 'We would love to host a Grace Force team this autumn.',
  form_key: 'default',
  interest: 'volunteer',
}

const FOLLOW_UP: FollowUpNotificationInput = {
  id: 'fu-1',
  contact_id: 'contact-1',
  title: 'Call about the autumn visit',
  details: 'She asked for dates before the end of the month.',
  due_at: '2026-08-05T15:00:00.000Z',
  priority: 'high',
  contact: {
    full_name: 'Jane Okafor',
    preferred_name: null,
    first_name: 'Jane',
    last_name: 'Okafor',
    organization_name: 'Hope Church',
    email: 'jane@example.org',
  },
}

const ASSIGNEE: NotificationProfile = {
  id: 'profile-1',
  email: 'sam@graceforce.test',
  full_name: 'Sam Alvarez',
}

const ASSIGNER: NotificationProfile = {
  id: 'profile-2',
  email: 'dana@graceforce.test',
  full_name: 'Dana Reid',
}

beforeEach(() => {
  process.env.NOTIFY_INTERNAL_EMAILS = 'team@graceforce.test, director@graceforce.test'
  process.env.NEXT_PUBLIC_SITE_URL = 'https://crm.graceforce.test'
})

afterEach(() => {
  delete process.env.NOTIFY_INTERNAL_EMAILS
  delete process.env.NEXT_PUBLIC_SITE_URL
})

function harness() {
  const store = createNotificationStore()
  const transport = createTransport()
  return { store, transport, deps: { client: store.client, transport: transport.transport } }
}

describe('claim-then-send', () => {
  it('sends the first time and reports a duplicate the second', async () => {
    const { store, transport, deps } = harness()

    const first = await notifyLeadCreated(LEAD, deps)
    const second = await notifyLeadCreated(LEAD, deps)

    expect(first.sent).toBe(true)
    expect(second).toMatchObject({ sent: false, reason: 'duplicate' })
    expect(transport.sent).toHaveLength(1)
    expect(store.rows).toHaveLength(1)
    expect(store.rows[0]?.status).toBe('sent')
  })

  it('sends exactly once when two callers race the same event', async () => {
    const { store, transport, deps } = harness()

    const results = await Promise.all([
      notifyLeadCreated(LEAD, deps),
      notifyLeadCreated(LEAD, deps),
      notifyLeadCreated(LEAD, deps),
    ])

    expect(results.filter((result) => result.sent)).toHaveLength(1)
    expect(
      results.filter((result) => !result.sent && result.reason === 'duplicate'),
    ).toHaveLength(2)
    expect(transport.sent).toHaveLength(1)
    expect(store.rows).toHaveLength(1)
  })

  it('records the delivery details on the row it claimed', async () => {
    const { store, transport, deps } = harness()

    const result = await notifyLeadCreated(LEAD, deps)
    const row = store.byKey(leadCreatedKey(LEAD.id))

    expect(result).toMatchObject({ sent: true, providerMessageId: 'resend_1' })
    expect(row).toMatchObject({
      kind: 'lead_created',
      status: 'sent',
      provider_message_id: 'resend_1',
      attempts: 1,
      error: null,
      related_lead_id: 'lead-1',
    })
    expect(row?.sent_at).not.toBeNull()
    expect(transport.sent[0]).toMatchObject({
      from: FAKE_FROM,
      to: ['team@graceforce.test', 'director@graceforce.test'],
    })
  })
})

describe('unconfigured Resend', () => {
  it('records the event as skipped and sends nothing', async () => {
    const store = createNotificationStore()
    const transport = createTransport()

    const result = await notifyLeadCreated(LEAD, {
      client: store.client,
      transport: unconfiguredTransport,
    })

    expect(result).toMatchObject({ sent: false, reason: 'unconfigured' })
    expect(transport.sent).toHaveLength(0)
    expect(store.rows[0]).toMatchObject({ status: 'skipped', attempts: 0, sent_at: null })
    // The body is still stored, so an admin can see what would have gone out.
    expect(store.rows[0]?.body_html).toContain('Hope Church')
  })

  it('still claims the key, so configuring Resend later does not replay the backlog', async () => {
    const store = createNotificationStore()
    const transport = createTransport()

    await notifyLeadCreated(LEAD, { client: store.client, transport: unconfiguredTransport })
    const afterConfiguring = await notifyLeadCreated(LEAD, {
      client: store.client,
      transport: transport.transport,
    })

    expect(afterConfiguring).toMatchObject({ sent: false, reason: 'duplicate' })
    expect(transport.sent).toHaveLength(0)
  })
})

describe('empty recipient list', () => {
  it('is a skipped row rather than an error, even with Resend configured', async () => {
    delete process.env.NOTIFY_INTERNAL_EMAILS
    const { store, transport, deps } = harness()

    const result = await notifyLeadCreated(LEAD, deps)

    expect(result).toMatchObject({ sent: false, reason: 'unconfigured' })
    expect(transport.sent).toHaveLength(0)
    // The check constraint only tolerates an empty list on a skipped row, so a
    // row claimed as 'pending' here would have been rejected outright.
    expect(store.rows[0]).toMatchObject({ status: 'skipped', recipients: [] })
    expect(result.sent === false && result.error).toBeUndefined()
  })

  it('drops blanks and repeats before deciding there is nobody to email', () => {
    expect(normalizeRecipients([' team@graceforce.test ', 'team@graceforce.test'])).toEqual([
      'team@graceforce.test',
    ])
    expect(normalizeRecipients(['', '   ', 'not-an-address'])).toEqual([])
  })
})

describe('provider failure', () => {
  it('marks the row failed with the provider error and does not throw', async () => {
    const { store, transport, deps } = harness()
    transport.failWith('Resend: domain graceforce.test is not verified')

    const result = await notifyLeadCreated(LEAD, deps)

    expect(result).toMatchObject({
      sent: false,
      reason: 'failed',
      error: 'Resend: domain graceforce.test is not verified',
    })
    expect(store.rows[0]).toMatchObject({
      status: 'failed',
      attempts: 1,
      error: 'Resend: domain graceforce.test is not verified',
      sent_at: null,
    })
  })

  it('keeps the claim, so a retry inside the same window does not double-send', async () => {
    const { store, transport, deps } = harness()
    transport.failWith('temporary provider outage')

    await notifyLeadCreated(LEAD, deps)
    transport.failWith(null)
    const retry = await notifyLeadCreated(LEAD, deps)

    expect(retry).toMatchObject({ sent: false, reason: 'duplicate' })
    expect(store.rows).toHaveLength(1)
    expect(store.rows[0]?.status).toBe('failed')
  })

  it('reports a database failure as a failure rather than throwing', async () => {
    const { transport } = harness()
    const rejectingClient = {
      from: () => ({
        upsert: () => ({
          select: () => Promise.resolve({ data: null, error: { message: 'connection refused' } }),
        }),
        update: () => ({ eq: () => Promise.resolve({ error: null }) }),
      }),
    }

    const result = await sendNotification(
      {
        kind: 'lead_created',
        dedupeKey: 'lead_created:lead-1',
        recipients: ['team@graceforce.test'],
        subject: 'New enquiry',
        text: 'body',
      },
      { client: rejectingClient, transport: transport.transport },
    )

    expect(result).toMatchObject({ sent: false, reason: 'failed', error: 'connection refused' })
    expect(transport.sent).toHaveLength(0)
  })
})

describe('dedupe keys', () => {
  it('identifies a lead by its id alone', () => {
    expect(leadCreatedKey('lead-1')).toBe('lead_created:lead-1')
  })

  it('carries the date for a due reminder, so it repeats daily and never twice a day', () => {
    expect(followUpDueKey('fu-1', NOW)).toBe('follow_up_due:fu-1:2026-08-05')
    expect(followUpDueKey('fu-1', new Date('2026-08-05T23:59:59.000Z'))).toBe(
      followUpDueKey('fu-1', NOW),
    )
    expect(followUpDueKey('fu-1', new Date('2026-08-06T00:00:01.000Z'))).toBe(
      'follow_up_due:fu-1:2026-08-06',
    )
  })

  it('identifies an assignment by follow-up and assignee together', () => {
    expect(followUpAssignedKey('fu-1', 'profile-1')).toBe('follow_up_assigned:fu-1:profile-1')
    expect(followUpAssignedKey('fu-1', 'profile-2')).not.toBe(
      followUpAssignedKey('fu-1', 'profile-1'),
    )
  })

  it('are the keys the events actually claim', async () => {
    const { store, deps } = harness()

    await notifyLeadCreated(LEAD, deps)
    await notifyFollowUpDue(FOLLOW_UP, ASSIGNEE, { ...deps, now: NOW })
    await notifyFollowUpAssigned(FOLLOW_UP, ASSIGNEE, ASSIGNER, deps)

    expect(store.rows.map((row) => row.dedupe_key)).toEqual([
      'lead_created:lead-1',
      'follow_up_due:fu-1:2026-08-05',
      'follow_up_assigned:fu-1:profile-1',
    ])
  })

  it('lets the same follow-up remind again the next day', async () => {
    const { store, transport, deps } = harness()

    await notifyFollowUpDue(FOLLOW_UP, ASSIGNEE, { ...deps, now: NOW })
    const sameDay = await notifyFollowUpDue(FOLLOW_UP, ASSIGNEE, {
      ...deps,
      now: new Date('2026-08-05T18:00:00.000Z'),
    })
    const nextDay = await notifyFollowUpDue(FOLLOW_UP, ASSIGNEE, {
      ...deps,
      now: new Date('2026-08-06T09:30:00.000Z'),
    })

    expect(sameDay).toMatchObject({ sent: false, reason: 'duplicate' })
    expect(nextDay.sent).toBe(true)
    expect(transport.sent).toHaveLength(2)
    expect(store.rows).toHaveLength(2)
  })
})

describe('follow-up notifications', () => {
  it('go to the assignee, not the internal list', async () => {
    const { transport, deps } = harness()

    await notifyFollowUpDue(FOLLOW_UP, ASSIGNEE, { ...deps, now: NOW })

    expect(transport.sent[0]?.to).toEqual(['sam@graceforce.test'])
    expect(transport.sent[0]?.subject).toBe('Follow-up due: Call about the autumn visit')
  })

  it('name the person who made the assignment, and link to the contact record', async () => {
    const { transport, deps } = harness()

    await notifyFollowUpAssigned(FOLLOW_UP, ASSIGNEE, ASSIGNER, deps)

    expect(transport.sent[0]?.text).toContain('Dana Reid assigned you a follow-up with Jane Okafor')
    expect(transport.sent[0]?.text).toContain('https://crm.graceforce.test/contacts/contact-1')
  })

  it('survive an unknown assigner rather than emailing "null"', async () => {
    const { transport, deps } = harness()

    await notifyFollowUpAssigned(FOLLOW_UP, ASSIGNEE, null, deps)

    expect(transport.sent[0]?.text).toContain('Someone on the team assigned you')
    expect(transport.sent[0]?.text).not.toContain('null')
  })
})

describe('html escaping', () => {
  it('neutralises a hostile lead message and name', async () => {
    const { store, transport, deps } = harness()
    const hostile: LeadNotificationInput = {
      ...LEAD,
      first_name: '<img src=x onerror="alert(1)">',
      last_name: null,
      message: `<script>alert("xss")</script> & don't trust "input"`,
    }

    await notifyLeadCreated(hostile, deps)
    const html = store.rows[0]?.body_html ?? ''

    expect(html).not.toContain('<script>')
    expect(html).not.toContain('<img src=x')
    expect(html).not.toContain('onerror="alert(1)"')
    expect(html).toContain('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;')
    expect(html).toContain('&amp;')
    expect(html).toContain('don&#39;t')

    // The plain-text alternative needs no escaping, and must not be mangled.
    expect(transport.sent[0]?.text).toContain(`<script>alert("xss")</script>`)
  })

  it('escapes every character that could break out of markup or an attribute', () => {
    expect(escapeHtml(`<a href="x">&'</a>`)).toBe(
      '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;',
    )
    // A single pass, so an escaped ampersand is not escaped again.
    expect(escapeHtml('&lt;')).toBe('&amp;lt;')
  })
})

describe('renderEmail', () => {
  it('always produces both a text and an html body', () => {
    const body = renderEmail({
      title: 'New enquiry',
      intro: 'Someone got in touch.',
      details: [
        { label: 'Email', value: 'jane@example.org' },
        { label: 'Phone', value: null },
        { label: 'Organisation', value: '   ' },
      ],
      action: { label: 'Open the lead queue', url: 'https://crm.graceforce.test/leads' },
    })

    expect(body.text).toContain('Email: jane@example.org')
    expect(body.html).toContain('jane@example.org')
    // Empty details are dropped rather than rendered as blanks.
    expect(body.text).not.toContain('Phone')
    expect(body.html).not.toContain('Organisation')
    expect(body.text).toContain('https://crm.graceforce.test/leads')
  })

  it('carries no images, so a client blocking remote content still shows everything', () => {
    const body = renderEmail({ title: 'New enquiry', quote: { label: 'Message', body: 'Hello' } })
    expect(body.html).not.toContain('<img')
    expect(body.text).toContain('> Hello')
  })
})
