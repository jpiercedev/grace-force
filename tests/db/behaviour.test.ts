import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, expectRejected, type TestDb, type TestUser } from './helpers/db'

/**
 * Behavioural verification of the schema: the triggers that build the unified
 * timeline, the constraints that keep paired fields honest, and the
 * idempotency guarantees the integrations depend on.
 *
 * These matter because much of the application's correctness is delegated to
 * the database on purpose — the timeline is complete *because* triggers write
 * it, not because every code path remembers to.
 */
describe('schema behaviour', () => {
  let db: TestDb
  let admin: TestUser
  let staff: TestUser
  let contactId: string
  let donorTypeId: string
  let volunteerTypeId: string

  beforeAll(async () => {
    db = await createTestDb()
    admin = await db.createUser({ email: 'admin@gracelead.test' })
    staff = await db.createUser({ email: 'staff@gracelead.test', role: 'staff' })

    const types = await db.asPostgres((sql) =>
      sql.query<{ id: string; slug: string }>(
        `select id, slug from public.engagement_types where slug in ('donor','volunteer')`,
      ),
    )
    donorTypeId = types.rows.find((r) => r.slug === 'donor')!.id
    volunteerTypeId = types.rows.find((r) => r.slug === 'volunteer')!.id

    const contact = await db.asUser(staff.id, (sql) =>
      sql.query<{ id: string }>(
        `insert into public.contacts (first_name, last_name, email, created_by)
         values ('Ada','Lovelace','ada@example.org',$1) returning id`,
        [staff.id],
      ),
    )
    contactId = contact.rows[0]!.id
  }, 180_000)

  afterAll(async () => {
    await db?.close()
  })

  async function activitiesFor(id: string) {
    const { rows } = await db.asPostgres((sql) =>
      sql.query<{ type: string; subject: string; metadata: Record<string, unknown> }>(
        `select type, subject, metadata from public.activities
          where contact_id = $1 order by created_at, subject`,
        [id],
      ),
    )
    return rows
  }

  describe('engagements', () => {
    let engagementId: string

    it('writes an engagement_started activity on insert', async () => {
      const created = await db.asUser(staff.id, (sql) =>
        sql.query<{ id: string }>(
          `insert into public.engagements (contact_id, engagement_type_id, created_by)
           values ($1,$2,$3) returning id`,
          [contactId, donorTypeId, staff.id],
        ),
      )
      engagementId = created.rows[0]!.id

      const activities = await activitiesFor(contactId)
      const started = activities.find((a) => a.type === 'engagement_started')
      expect(started).toBeDefined()
      expect(started!.subject).toContain('Donor')
    })

    it('writes engagement_changed when the status moves', async () => {
      await db.asUser(staff.id, (sql) =>
        sql.query(`update public.engagements set status = 'active' where id = $1`, [engagementId]),
      )
      const changed = (await activitiesFor(contactId)).find((a) => a.type === 'engagement_changed')
      expect(changed).toBeDefined()
      expect(changed!.metadata).toMatchObject({ from: 'prospect', to: 'active' })
    })

    it('refuses to end an engagement without an end date', async () => {
      const message = await expectRejected(
        db.asUser(staff.id, (sql) =>
          sql.query(`update public.engagements set status = 'ended' where id = $1`, [engagementId]),
        ),
      )
      expect(message).toMatch(/engagements_ended_consistency/)
    })

    it('refuses an end date while the engagement is live', async () => {
      const message = await expectRejected(
        db.asUser(staff.id, (sql) =>
          sql.query(`update public.engagements set ended_on = current_date where id = $1`, [
            engagementId,
          ]),
        ),
      )
      expect(message).toMatch(/engagements_ended_consistency/)
    })

    it('allows one live engagement per type but keeps ended ones as history', async () => {
      const duplicate = await expectRejected(
        db.asUser(staff.id, (sql) =>
          sql.query(
            `insert into public.engagements (contact_id, engagement_type_id) values ($1,$2)`,
            [contactId, donorTypeId],
          ),
        ),
      )
      expect(duplicate).toMatch(/engagements_one_live_per_type/)

      // End it, then re-engaging later must be allowed as a second row.
      await db.asUser(staff.id, (sql) =>
        sql.query(
          `update public.engagements set status = 'ended', ended_on = current_date where id = $1`,
          [engagementId],
        ),
      )
      const reengaged = await db.asUser(staff.id, (sql) =>
        sql.query<{ id: string }>(
          `insert into public.engagements (contact_id, engagement_type_id) values ($1,$2) returning id`,
          [contactId, donorTypeId],
        ),
      )
      expect(reengaged.rows).toHaveLength(1)

      const { rows } = await db.asPostgres((sql) =>
        sql.query<{ count: number }>(
          `select count(*)::int as count from public.engagements
            where contact_id = $1 and engagement_type_id = $2`,
          [contactId, donorTypeId],
        ),
      )
      expect(rows[0]!.count).toBe(2)
    })
  })

  describe('pipelines', () => {
    let cardId: string
    let pipelineId: string
    let stages: Array<{ id: string; slug: string }>

    beforeAll(async () => {
      const pipeline = await db.asPostgres((sql) =>
        sql.query<{ id: string }>(
          `select id from public.pipelines where slug = 'supporter_journey'`,
        ),
      )
      pipelineId = pipeline.rows[0]!.id
      const stageRows = await db.asPostgres((sql) =>
        sql.query<{ id: string; slug: string }>(
          `select id, slug from public.pipeline_stages where pipeline_id = $1 order by position`,
          [pipelineId],
        ),
      )
      stages = stageRows.rows
    })

    it('writes pipeline_card_created on insert', async () => {
      const created = await db.asUser(staff.id, (sql) =>
        sql.query<{ id: string }>(
          `insert into public.pipeline_cards (pipeline_id, stage_id, contact_id, title, created_by)
           values ($1,$2,$3,'Supporter journey',$4) returning id`,
          [pipelineId, stages[0]!.id, contactId, staff.id],
        ),
      )
      cardId = created.rows[0]!.id

      const activity = (await activitiesFor(contactId)).find(
        (a) => a.type === 'pipeline_card_created',
      )
      expect(activity).toBeDefined()
    })

    it('records the stage transition with both stage names', async () => {
      await db.asUser(staff.id, (sql) =>
        sql.query(`update public.pipeline_cards set stage_id = $2 where id = $1`, [
          cardId,
          stages[1]!.id,
        ]),
      )
      const moved = (await activitiesFor(contactId)).find(
        (a) => a.type === 'pipeline_stage_changed',
      )
      expect(moved).toBeDefined()
      expect(moved!.metadata).toMatchObject({ from: 'New', to: 'Contacted' })
    })

    it('refuses a stage from a different pipeline', async () => {
      const otherStage = await db.asPostgres((sql) =>
        sql.query<{ id: string }>(
          `select s.id from public.pipeline_stages s
             join public.pipelines p on p.id = s.pipeline_id
            where p.slug = 'major_gift' limit 1`,
        ),
      )
      const message = await expectRejected(
        db.asUser(staff.id, (sql) =>
          sql.query(`update public.pipeline_cards set stage_id = $2 where id = $1`, [
            cardId,
            otherStage.rows[0]!.id,
          ]),
        ),
      )
      expect(message).toMatch(/foreign key|violates/i)
    })

    it('requires closed_at when a card leaves the open state', async () => {
      const message = await expectRejected(
        db.asUser(staff.id, (sql) =>
          sql.query(`update public.pipeline_cards set status = 'won' where id = $1`, [cardId]),
        ),
      )
      expect(message).toMatch(/pipeline_cards_closed_consistency/)
    })

    it('logs the close once status and closed_at are set together', async () => {
      await db.asUser(staff.id, (sql) =>
        sql.query(
          `update public.pipeline_cards set status = 'won', closed_at = now() where id = $1`,
          [cardId],
        ),
      )
      const closed = (await activitiesFor(contactId)).find((a) => a.type === 'pipeline_card_closed')
      expect(closed).toBeDefined()
    })

    it('permits only one open card per contact per pipeline', async () => {
      // The previous card is closed, so a new one is allowed...
      await db.asUser(staff.id, (sql) =>
        sql.query(
          `insert into public.pipeline_cards (pipeline_id, stage_id, contact_id, title)
           values ($1,$2,$3,'Second run')`,
          [pipelineId, stages[0]!.id, contactId],
        ),
      )
      // ...but a third, while that one is open, is not.
      const message = await expectRejected(
        db.asUser(staff.id, (sql) =>
          sql.query(
            `insert into public.pipeline_cards (pipeline_id, stage_id, contact_id, title)
             values ($1,$2,$3,'Third run')`,
            [pipelineId, stages[0]!.id, contactId],
          ),
        ),
      )
      expect(message).toMatch(/pipeline_cards_one_open_per_contact/)
    })
  })

  describe('follow-ups', () => {
    let followUpId: string

    it('defaults remind_at to due_at and logs creation', async () => {
      const created = await db.asUser(staff.id, (sql) =>
        sql.query<{ id: string; remind_at: string; due_at: string }>(
          `insert into public.follow_ups (contact_id, title, due_at, assigned_to, created_by)
           values ($1,'Call Ada', now() + interval '2 days', $2, $2)
           returning id, remind_at, due_at`,
          [contactId, staff.id],
        ),
      )
      followUpId = created.rows[0]!.id
      expect(created.rows[0]!.remind_at).toEqual(created.rows[0]!.due_at)

      const activity = (await activitiesFor(contactId)).find((a) => a.type === 'follow_up_created')
      expect(activity).toBeDefined()
    })

    it('requires completed_at when marking one complete', async () => {
      const message = await expectRejected(
        db.asUser(staff.id, (sql) =>
          sql.query(`update public.follow_ups set status = 'completed' where id = $1`, [
            followUpId,
          ]),
        ),
      )
      expect(message).toMatch(/follow_ups_completion_consistency/)
    })

    it('logs completion with the outcome note', async () => {
      await db.asUser(staff.id, (sql) =>
        sql.query(
          `update public.follow_ups
              set status='completed', completed_at=now(), completed_by=$2, outcome_note='Spoke by phone'
            where id = $1`,
          [followUpId, staff.id],
        ),
      )
      const done = (await activitiesFor(contactId)).find((a) => a.type === 'follow_up_completed')
      expect(done).toBeDefined()
      expect(done!.subject).toContain('Call Ada')
    })
  })

  describe('gifts and giving context', () => {
    it('writes a gift_recorded activity keyed so a re-sync cannot double-post', async () => {
      const gift = await db.asServiceRole((sql) =>
        sql.query<{ id: string }>(
          `insert into public.gifts (contact_id, amount_cents, given_on, fund, external_source, external_id)
           values ($1, 50000, current_date, 'General Fund', 'givingplatform', 'g-1')
           returning id`,
          [contactId],
        ),
      )

      const { rows } = await db.asPostgres((sql) =>
        sql.query<{ dedupe_key: string; metadata: Record<string, unknown> }>(
          `select dedupe_key, metadata from public.activities where type = 'gift_recorded'`,
        ),
      )
      expect(rows).toHaveLength(1)
      expect(rows[0]!.dedupe_key).toBe(`gift:${gift.rows[0]!.id}`)
      expect(rows[0]!.metadata).toMatchObject({ amount_cents: 50000, fund: 'General Fund' })
    })

    it('makes re-importing the same external gift a no-op', async () => {
      const before = await db.asPostgres((sql) =>
        sql.query<{ count: number }>('select count(*)::int as count from public.gifts'),
      )

      const message = await expectRejected(
        db.asServiceRole((sql) =>
          sql.query(
            `insert into public.gifts (contact_id, amount_cents, given_on, external_source, external_id)
             values ($1, 50000, current_date, 'givingplatform', 'g-1')`,
            [contactId],
          ),
        ),
      )
      expect(message).toMatch(/gifts_external_key/)

      const after = await db.asPostgres((sql) =>
        sql.query<{ count: number }>('select count(*)::int as count from public.gifts'),
      )
      expect(after.rows[0]!.count).toBe(before.rows[0]!.count)
    })

    it('rejects non-positive amounts', async () => {
      expect(
        await expectRejected(
          db.asServiceRole((sql) =>
            sql.query(
              `insert into public.gifts (contact_id, amount_cents, given_on) values ($1, 0, current_date)`,
              [contactId],
            ),
          ),
        ),
      ).toMatch(/gifts_amount_positive/)
    })

    it('aggregates the giving summary', async () => {
      await db.asServiceRole((sql) =>
        sql.query(
          `insert into public.gifts (contact_id, amount_cents, given_on, is_recurring)
           values ($1, 25000, current_date - 40, true)`,
          [contactId],
        ),
      )

      const { rows } = await db.asUser(admin.id, (sql) =>
        sql.query<{
          gift_count: number
          total_cents: number
          largest_gift_cents: number
          has_recurring: boolean
        }>(`select * from public.contact_giving_summary where contact_id = $1`, [contactId]),
      )
      expect(rows[0]).toMatchObject({
        gift_count: 2,
        total_cents: 75000,
        largest_gift_cents: 50000,
        has_recurring: true,
      })
    })
  })

  describe('activity timeline mechanics', () => {
    it('rejects a duplicate dedupe_key but allows repeated manual entries', async () => {
      await db.asUser(staff.id, (sql) =>
        sql.query(
          `insert into public.activities (contact_id, type, subject, dedupe_key)
           values ($1,'note','Synced note','external:note:1')`,
          [contactId],
        ),
      )
      expect(
        await expectRejected(
          db.asUser(staff.id, (sql) =>
            sql.query(
              `insert into public.activities (contact_id, type, subject, dedupe_key)
               values ($1,'note','Synced note','external:note:1')`,
              [contactId],
            ),
          ),
        ),
      ).toMatch(/activities_dedupe_key_uniq/)

      // Two phone calls on the same day are two events, not a duplicate.
      for (let i = 0; i < 2; i += 1) {
        await db.asUser(staff.id, (sql) =>
          sql.query(
            `insert into public.activities (contact_id, type, subject) values ($1,'call','Called Ada')`,
            [contactId],
          ),
        )
      }
      const { rows } = await db.asPostgres((sql) =>
        sql.query<{ count: number }>(
          `select count(*)::int as count from public.activities where subject = 'Called Ada'`,
        ),
      )
      expect(rows[0]!.count).toBe(2)
    })

    it('advances contacts.last_activity_at but never moves it backwards', async () => {
      await db.asUser(staff.id, (sql) =>
        sql.query(
          `insert into public.activities (contact_id, type, subject, occurred_at)
           values ($1,'note','Recent', now())`,
          [contactId],
        ),
      )
      const after = await db.asPostgres((sql) =>
        sql.query<{ last_activity_at: string }>(
          'select last_activity_at from public.contacts where id = $1',
          [contactId],
        ),
      )
      const highWater = after.rows[0]!.last_activity_at
      expect(highWater).not.toBeNull()

      // Backfilling an old activity must not rewind the recency marker.
      await db.asUser(staff.id, (sql) =>
        sql.query(
          `insert into public.activities (contact_id, type, subject, occurred_at)
           values ($1,'note','Backfilled', now() - interval '400 days')`,
          [contactId],
        ),
      )
      const unchanged = await db.asPostgres((sql) =>
        sql.query<{ last_activity_at: string }>(
          'select last_activity_at from public.contacts where id = $1',
          [contactId],
        ),
      )
      expect(unchanged.rows[0]!.last_activity_at).toEqual(highWater)
    })

    it('logs reassignment when the owner changes', async () => {
      await db.asUser(admin.id, (sql) =>
        sql.query('update public.contacts set owner_id = $2 where id = $1', [contactId, staff.id]),
      )
      const activity = (await activitiesFor(contactId)).find((a) => a.type === 'assignment_changed')
      expect(activity).toBeDefined()
      expect(activity!.subject).toContain('unassigned')
    })
  })

  describe('full-text search', () => {
    it('finds a contact by name and by organisation', async () => {
      await db.asUser(staff.id, (sql) =>
        sql.query(
          `insert into public.contacts (first_name, last_name, organization_name, notes)
           values ('Grace','Hopper','Naval Reserve','Interested in mentoring students')`,
        ),
      )

      const byName = await db.asUser(staff.id, (sql) =>
        sql.query<{ full_name: string }>(
          `select full_name from public.contacts
            where search_vector @@ websearch_to_tsquery('simple', 'Hopper')`,
        ),
      )
      expect(byName.rows.map((r) => r.full_name)).toContain('Grace Hopper')

      const byOrg = await db.asUser(staff.id, (sql) =>
        sql.query<{ full_name: string }>(
          `select full_name from public.contacts
            where search_vector @@ websearch_to_tsquery('simple', 'Naval')`,
        ),
      )
      expect(byOrg.rows.map((r) => r.full_name)).toContain('Grace Hopper')

      // Notes are indexed with English stemming, so 'mentor' matches 'mentoring'.
      const byNote = await db.asUser(staff.id, (sql) =>
        sql.query<{ full_name: string }>(
          `select full_name from public.contacts
            where search_vector @@ websearch_to_tsquery('english', 'mentor')`,
        ),
      )
      expect(byNote.rows.map((r) => r.full_name)).toContain('Grace Hopper')
    })
  })

  describe('rate limiter', () => {
    it('allows up to the limit within a window, then refuses', async () => {
      const results: boolean[] = []
      for (let i = 0; i < 4; i += 1) {
        const { rows } = await db.asServiceRole((sql) =>
          sql.query<{ consume_rate_limit: boolean }>(
            `select public.consume_rate_limit('lead:test', 3, 3600)`,
          ),
        )
        results.push(rows[0]!.consume_rate_limit)
      }
      expect(results).toEqual([true, true, true, false])
    })

    it('keeps buckets independent', async () => {
      const { rows } = await db.asServiceRole((sql) =>
        sql.query<{ consume_rate_limit: boolean }>(
          `select public.consume_rate_limit('lead:other', 3, 3600)`,
        ),
      )
      expect(rows[0]!.consume_rate_limit).toBe(true)
    })

    it('treats a non-positive limit as unlimited', async () => {
      const { rows } = await db.asServiceRole((sql) =>
        sql.query<{ consume_rate_limit: boolean }>(
          `select public.consume_rate_limit('lead:test', 0, 3600)`,
        ),
      )
      expect(rows[0]!.consume_rate_limit).toBe(true)
    })
  })

  describe('lead conversion', () => {
    let leadId: string

    beforeAll(async () => {
      const lead = await db.asServiceRole((sql) =>
        sql.query<{ id: string }>(
          `insert into public.leads (first_name, last_name, email, message, interest, form_key)
           values ('Katherine','Johnson','katherine@example.org','Would love to volunteer','volunteer','web')
           returning id`,
        ),
      )
      leadId = lead.rows[0]!.id
    })

    it('creates the contact, the engagement and both timeline entries atomically', async () => {
      const { rows } = await db.asUser(staff.id, (sql) =>
        sql.query<{ convert_lead: string }>('select public.convert_lead($1, $2)', [
          leadId,
          staff.id,
        ]),
      )
      const newContactId = rows[0]!.convert_lead
      expect(newContactId).toBeTruthy()

      const contact = await db.asPostgres((sql) =>
        sql.query<{ email: string; source: string }>(
          'select email, source from public.contacts where id = $1',
          [newContactId],
        ),
      )
      expect(contact.rows[0]).toMatchObject({
        email: 'katherine@example.org',
        source: 'web_form',
      })

      const engagements = await db.asPostgres((sql) =>
        sql.query<{ engagement_type_id: string }>(
          'select engagement_type_id from public.engagements where contact_id = $1',
          [newContactId],
        ),
      )
      expect(engagements.rows.map((r) => r.engagement_type_id)).toContain(volunteerTypeId)

      const types = (await activitiesFor(newContactId)).map((a) => a.type)
      expect(types).toEqual(expect.arrayContaining(['lead_submitted', 'lead_converted']))

      const lead = await db.asPostgres((sql) =>
        sql.query<{ status: string; contact_id: string }>(
          'select status, contact_id from public.leads where id = $1',
          [leadId],
        ),
      )
      expect(lead.rows[0]).toMatchObject({ status: 'converted', contact_id: newContactId })
    })

    it('is idempotent — converting twice returns the same contact', async () => {
      const before = await db.asPostgres((sql) =>
        sql.query<{ count: number }>('select count(*)::int as count from public.contacts'),
      )
      const { rows } = await db.asUser(staff.id, (sql) =>
        sql.query<{ convert_lead: string }>('select public.convert_lead($1, null)', [leadId]),
      )
      const after = await db.asPostgres((sql) =>
        sql.query<{ count: number }>('select count(*)::int as count from public.contacts'),
      )

      expect(rows[0]!.convert_lead).toBeTruthy()
      expect(after.rows[0]!.count).toBe(before.rows[0]!.count)
    })

    it('enriches an existing contact rather than duplicating a known supporter', async () => {
      const second = await db.asServiceRole((sql) =>
        sql.query<{ id: string }>(
          `insert into public.leads (first_name, email, message, form_key)
           values ('Ada','ada@example.org','Following up','web') returning id`,
        ),
      )
      const { rows } = await db.asUser(staff.id, (sql) =>
        sql.query<{ convert_lead: string }>('select public.convert_lead($1, null)', [
          second.rows[0]!.id,
        ]),
      )
      expect(rows[0]!.convert_lead).toBe(contactId)
    })

    it('refuses conversion by a viewer', async () => {
      const viewer = await db.createUser({ email: 'readonly@gracelead.test', role: 'viewer' })
      const third = await db.asServiceRole((sql) =>
        sql.query<{ id: string }>(
          `insert into public.leads (email, form_key) values ('nope@example.org','web') returning id`,
        ),
      )
      const message = await expectRejected(
        db.asUser(viewer.id, (sql) =>
          sql.query('select public.convert_lead($1, null)', [third.rows[0]!.id]),
        ),
      )
      expect(message).toMatch(/insufficient privilege/i)
    })
  })

  describe('notification outbox', () => {
    it('enforces one row per dedupe key, which is what makes send-once work', async () => {
      await db.asServiceRole((sql) =>
        sql.query(
          `insert into public.notifications (kind, dedupe_key, recipients, subject)
           values ('lead_created','lead_created:abc', array['team@gracelead.test'],'New lead')`,
        ),
      )

      // The claim-then-send pattern relies on this insert returning nothing.
      const { rows } = await db.asServiceRole((sql) =>
        sql.query<{ id: string }>(
          `insert into public.notifications (kind, dedupe_key, recipients, subject)
           values ('lead_created','lead_created:abc', array['team@gracelead.test'],'New lead')
           on conflict (dedupe_key) do nothing
           returning id`,
        ),
      )
      expect(rows).toEqual([])
    })

    it('allows an empty recipient list only when the notification was skipped', async () => {
      expect(
        await expectRejected(
          db.asServiceRole((sql) =>
            sql.query(
              `insert into public.notifications (kind, dedupe_key, recipients, subject, status)
               values ('lead_created','lead_created:empty', '{}', 'No recipients', 'pending')`,
            ),
          ),
        ),
      ).toMatch(/notifications_recipients_present/)

      const skipped = await db.asServiceRole((sql) =>
        sql.query<{ id: string }>(
          `insert into public.notifications (kind, dedupe_key, recipients, subject, status)
           values ('lead_created','lead_created:skipped', '{}', 'No recipients', 'skipped')
           returning id`,
        ),
      )
      expect(skipped.rows).toHaveLength(1)
    })
  })
  describe('forced password rotation', () => {
    /**
     * The guard is only worth anything if the flag cannot be dropped by the
     * account it constrains. It lives in `auth.users.raw_app_meta_data`
     * precisely because a column on `profiles` would be self-clearable through
     * `profiles_update`, so these assert the property that choice was made for.
     */
    async function flagged(email: string): Promise<TestUser> {
      const user = await db.createUser({ email })
      await db.asPostgres((sql) =>
        sql.query(
          `update auth.users
              set raw_app_meta_data =
                    coalesce(raw_app_meta_data, '{}'::jsonb)
                    || '{"must_change_password": true}'::jsonb
            where id = $1`,
          [user.id],
        ),
      )
      return user
    }

    async function isFlagged(userId: string): Promise<boolean> {
      const { rows } = await db.asPostgres((sql) =>
        sql.query<{ flagged: boolean }>(
          `select coalesce((raw_app_meta_data ->> 'must_change_password')::boolean, false) as flagged
             from auth.users where id = $1`,
          [userId],
        ),
      )
      return rows[0]!.flagged
    }

    it('drops the flag when the password hash actually changes', async () => {
      const user = await flagged('rotate-me@gracelead.test')
      expect(await isFlagged(user.id)).toBe(true)

      await db.asPostgres((sql) =>
        sql.query(`update auth.users set encrypted_password = 'new-hash' where id = $1`, [
          user.id,
        ]),
      )

      expect(await isFlagged(user.id)).toBe(false)
    })

    it('keeps the flag when some other column is touched', async () => {
      // Otherwise any incidental write — a last-sign-in stamp, a metadata
      // edit — would quietly satisfy the guard.
      const user = await flagged('unrelated-write@gracelead.test')

      await db.asPostgres((sql) =>
        sql.query(`update auth.users set updated_at = now() where id = $1`, [user.id]),
      )
      expect(await isFlagged(user.id)).toBe(true)

      await db.asPostgres((sql) =>
        sql.query(
          `update auth.users
              set raw_user_meta_data = raw_user_meta_data || '{"full_name": "Renamed"}'::jsonb
            where id = $1`,
          [user.id],
        ),
      )
      expect(await isFlagged(user.id)).toBe(true)
    })

    it('keeps the flag when the password is rewritten to the same hash', async () => {
      // Re-submitting the existing password is not a rotation.
      const user = await flagged('same-hash@gracelead.test')

      await db.asPostgres((sql) =>
        sql.query(
          `update auth.users set encrypted_password = encrypted_password where id = $1`,
          [user.id],
        ),
      )

      expect(await isFlagged(user.id)).toBe(true)
    })

    it('does not let the flagged user clear it through their own profile row', async () => {
      // The whole reason the flag is not a column on `profiles`.
      const user = await flagged('self-clear@gracelead.test')

      const { rows } = await db.asUser(user.id, (sql) =>
        sql.query<{ column_name: string }>(
          `select column_name from information_schema.columns
            where table_schema = 'public' and table_name = 'profiles'
              and column_name = 'must_change_password'`,
        ),
      )
      expect(rows).toEqual([])
      expect(await isFlagged(user.id)).toBe(true)
    })
  })
})
