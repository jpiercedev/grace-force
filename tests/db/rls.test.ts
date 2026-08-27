import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, expectRejected, type TestDb, type TestUser } from './helpers/db'

/**
 * Row Level Security verification.
 *
 * These run against a real Postgres with the request executing as the same
 * `anon` / `authenticated` / `service_role` roles the hosted platform uses, so
 * a passing test means Postgres actually enforced the policy — not that the
 * application remembered to filter.
 */
describe('row level security', () => {
  let db: TestDb
  let admin: TestUser
  let staff: TestUser
  let viewer: TestUser
  let giftViewer: TestUser
  let deactivated: TestUser
  let contactId: string

  beforeAll(async () => {
    db = await createTestDb()

    // The first profile is promoted to admin by the provisioning trigger.
    admin = await db.createUser({ email: 'admin@gracelead.test' })
    staff = await db.createUser({ email: 'staff@gracelead.test', role: 'staff' })
    viewer = await db.createUser({ email: 'viewer@gracelead.test', role: 'viewer' })
    giftViewer = await db.createUser({
      email: 'finance@gracelead.test',
      role: 'staff',
      canViewGiving: true,
    })
    deactivated = await db.createUser({
      email: 'former@gracelead.test',
      role: 'staff',
      isActive: false,
    })

    const created = await db.asUser(staff.id, (sql) =>
      sql.query<{ id: string }>(
        `insert into public.contacts (first_name, last_name, email, created_by)
         values ('Ada', 'Lovelace', 'ada@example.org', $1) returning id`,
        [staff.id],
      ),
    )
    contactId = created.rows[0]!.id
  }, 180_000)

  afterAll(async () => {
    await db?.close()
  })

  describe('provisioning', () => {
    it('makes the first user an admin and later users staff', async () => {
      expect(admin.role).toBe('admin')
      const fresh = await db.createUser({ email: 'later@gracelead.test' })
      expect(fresh.role).toBe('staff')
    })
  })

  describe('anonymous access', () => {
    it('cannot read contacts', async () => {
      const message = await expectRejected(
        db.asAnon((sql) => sql.query('select * from public.contacts')),
      )
      expect(message).toMatch(/permission denied/i)
    })

    it('cannot read leads or write them', async () => {
      expect(
        await expectRejected(db.asAnon((sql) => sql.query('select * from public.leads'))),
      ).toMatch(/permission denied/i)

      expect(
        await expectRejected(
          db.asAnon((sql) =>
            sql.query(`insert into public.leads (email) values ('spam@example.org')`),
          ),
        ),
      ).toMatch(/permission denied/i)
    })

    it('cannot reach the rate limiter', async () => {
      expect(
        await expectRejected(
          db.asAnon((sql) => sql.query(`select public.consume_rate_limit('x', 5, 60)`)),
        ),
      ).toMatch(/permission denied/i)
    })
  })

  describe('deactivated users', () => {
    it('see no contacts even though they authenticate', async () => {
      const { rows } = await db.asUser(deactivated.id, (sql) =>
        sql.query('select id from public.contacts'),
      )
      expect(rows).toEqual([])
    })

    it('can still read their own profile so the UI can explain why', async () => {
      const { rows } = await db.asUser(deactivated.id, (sql) =>
        sql.query<{ id: string }>('select id from public.profiles'),
      )
      expect(rows.map((r) => r.id)).toEqual([deactivated.id])
    })

    it('cannot create contacts', async () => {
      expect(
        await expectRejected(
          db.asUser(deactivated.id, (sql) =>
            sql.query(`insert into public.contacts (first_name) values ('Nope')`),
          ),
        ),
      ).toMatch(/row-level security/i)
    })
  })

  describe('viewers are read-only', () => {
    it('can read contacts', async () => {
      const { rows } = await db.asUser(viewer.id, (sql) =>
        sql.query('select id from public.contacts'),
      )
      expect(rows.length).toBeGreaterThan(0)
    })

    it('cannot insert a contact', async () => {
      expect(
        await expectRejected(
          db.asUser(viewer.id, (sql) =>
            sql.query(`insert into public.contacts (first_name) values ('Blocked')`),
          ),
        ),
      ).toMatch(/row-level security/i)
    })

    it('cannot update a contact', async () => {
      const { rows } = await db.asUser(viewer.id, (sql) =>
        sql.query(`update public.contacts set first_name = 'Hacked' where id = $1 returning id`, [
          contactId,
        ]),
      )
      // No matching row passes the USING clause, so the update is a no-op.
      expect(rows).toEqual([])

      const check = await db.asUser(admin.id, (sql) =>
        sql.query<{ first_name: string }>(
          'select first_name from public.contacts where id = $1',
          [contactId],
        ),
      )
      expect(check.rows[0]!.first_name).toBe('Ada')
    })

    it('can read leads but cannot triage them', async () => {
      await db.asServiceRole((sql) =>
        sql.query(
          `insert into public.leads (email, message, form_key) values ('lead@example.org','Hi','web')`,
        ),
      )
      const { rows } = await db.asUser(viewer.id, (sql) => sql.query('select * from public.leads'))
      expect(rows.length).toBeGreaterThan(0)

      const triage = await db.asUser(viewer.id, (sql) =>
        sql.query(`update public.leads set status = 'in_review' where status = 'new' returning id`),
      )
      expect(triage.rows).toEqual([])

      const staffView = await db.asUser(staff.id, (sql) =>
        sql.query('select * from public.leads'),
      )
      expect(staffView.rows.length).toBeGreaterThan(0)
    })
  })

  describe('staff write access', () => {
    it('can create and update contacts', async () => {
      const created = await db.asUser(staff.id, (sql) =>
        sql.query<{ id: string }>(
          `insert into public.contacts (first_name, last_name) values ('Grace','Hopper') returning id`,
        ),
      )
      const id = created.rows[0]!.id

      const updated = await db.asUser(staff.id, (sql) =>
        sql.query<{ id: string }>(
          `update public.contacts set city = 'Arlington' where id = $1 returning id`,
          [id],
        ),
      )
      expect(updated.rows).toHaveLength(1)
    })

    it('cannot delete contacts — that is an admin action', async () => {
      const { rows } = await db.asUser(staff.id, (sql) =>
        sql.query('delete from public.contacts where id = $1 returning id', [contactId]),
      )
      expect(rows).toEqual([])
    })

    it('admins can delete contacts', async () => {
      const created = await db.asUser(admin.id, (sql) =>
        sql.query<{ id: string }>(
          `insert into public.contacts (first_name) values ('Temporary') returning id`,
        ),
      )
      const { rows } = await db.asUser(admin.id, (sql) =>
        sql.query('delete from public.contacts where id = $1 returning id', [
          created.rows[0]!.id,
        ]),
      )
      expect(rows).toHaveLength(1)
    })

    it('cannot edit the engagement type catalogue', async () => {
      const { rows } = await db.asUser(staff.id, (sql) =>
        sql.query(
          `update public.engagement_types set label = 'Renamed' where slug = 'donor' returning id`,
        ),
      )
      expect(rows).toEqual([])
    })
  })

  describe('giving history is shared with the team; writes stay admin-only', () => {
    beforeAll(async () => {
      await db.asServiceRole((sql) =>
        sql.query(
          `insert into public.gifts (contact_id, amount_cents, given_on, fund)
           values ($1, 25000, current_date, 'General Fund')`,
          [contactId],
        ),
      )
    })

    it('shows gifts to every active user, with or without the legacy flag', async () => {
      for (const reader of [staff.id, giftViewer.id, admin.id, viewer.id]) {
        const { rows } = await db.asUser(reader, (sql) =>
          sql.query('select id from public.gifts'),
        )
        expect(rows.length).toBeGreaterThan(0)
      }
    })

    it('keeps gifts away from deactivated profiles', async () => {
      const { rows } = await db.asUser(deactivated.id, (sql) =>
        sql.query('select id from public.gifts'),
      )
      expect(rows).toEqual([])
    })

    it('shares gift activity metadata on the team timeline', async () => {
      const { rows } = await db.asUser(staff.id, (sql) =>
        sql.query<{ metadata: Record<string, unknown> }>(
          `select metadata from public.activities where type = 'gift_recorded'`,
        ),
      )
      expect(rows).toHaveLength(1)
      expect(rows[0]!.metadata.amount_cents).toBe(25000)
    })

    it('shares the giving summary view the same way', async () => {
      // security_invoker=on: the view follows the gifts policy either way.
      const { rows } = await db.asUser(staff.id, (sql) =>
        sql.query<{ total_cents: string }>('select * from public.contact_giving_summary'),
      )
      expect(rows.length).toBeGreaterThan(0)
    })

    it('refuses gift writes from non-admins', async () => {
      expect(
        await expectRejected(
          db.asUser(giftViewer.id, (sql) =>
            sql.query(
              `insert into public.gifts (contact_id, amount_cents, given_on) values ($1, 100, current_date)`,
              [contactId],
            ),
          ),
        ),
      ).toMatch(/row-level security/i)
    })
  })

  describe('privilege escalation', () => {
    it('silently reverts a staff member promoting themselves', async () => {
      await db.asUser(staff.id, (sql) =>
        sql.query(
          `update public.profiles set role = 'admin', can_view_giving = true where id = $1`,
          [staff.id],
        ),
      )

      const { rows } = await db.asPostgres((sql) =>
        sql.query<{ role: string; can_view_giving: boolean }>(
          'select role, can_view_giving from public.profiles where id = $1',
          [staff.id],
        ),
      )
      expect(rows[0]!.role).toBe('staff')
      expect(rows[0]!.can_view_giving).toBe(false)
    })

    it('lets a staff member edit their own display fields', async () => {
      await db.asUser(staff.id, (sql) =>
        sql.query(`update public.profiles set full_name = 'Staff Person' where id = $1`, [
          staff.id,
        ]),
      )
      const { rows } = await db.asPostgres((sql) =>
        sql.query<{ full_name: string }>('select full_name from public.profiles where id = $1', [
          staff.id,
        ]),
      )
      expect(rows[0]!.full_name).toBe('Staff Person')
    })

    it('does not let a staff member edit someone else', async () => {
      const { rows } = await db.asUser(staff.id, (sql) =>
        sql.query(`update public.profiles set full_name = 'Hijacked' where id = $1 returning id`, [
          viewer.id,
        ]),
      )
      expect(rows).toEqual([])
    })

    it('lets an admin change roles', async () => {
      await db.asUser(admin.id, (sql) =>
        sql.query(`update public.profiles set can_view_giving = true where id = $1`, [viewer.id]),
      )
      const { rows } = await db.asPostgres((sql) =>
        sql.query<{ can_view_giving: boolean }>(
          'select can_view_giving from public.profiles where id = $1',
          [viewer.id],
        ),
      )
      expect(rows[0]!.can_view_giving).toBe(true)

      // Restore for later assertions.
      await db.asUser(admin.id, (sql) =>
        sql.query(`update public.profiles set can_view_giving = false where id = $1`, [viewer.id]),
      )
    })

    it('refuses to remove the last active administrator', async () => {
      const message = await expectRejected(
        db.asPostgres((sql) =>
          sql.query(`update public.profiles set is_active = false where role = 'admin'`),
        ),
      )
      expect(message).toMatch(/last active administrator/i)
    })
  })

  describe('follow-up ownership', () => {
    let assignedToStaff: string

    beforeAll(async () => {
      const created = await db.asUser(admin.id, (sql) =>
        sql.query<{ id: string }>(
          `insert into public.follow_ups (contact_id, title, due_at, assigned_to, created_by)
           values ($1, 'Call Ada', now() + interval '1 day', $2, $3) returning id`,
          [contactId, staff.id, admin.id],
        ),
      )
      assignedToStaff = created.rows[0]!.id
    })

    it('lets the assignee complete their own follow-up', async () => {
      const { rows } = await db.asUser(staff.id, (sql) =>
        sql.query<{ id: string }>(
          `update public.follow_ups
              set status = 'completed', completed_at = now(), completed_by = $2
            where id = $1 returning id`,
          [assignedToStaff, staff.id],
        ),
      )
      expect(rows).toHaveLength(1)
    })

    it('does not let an unrelated staff member touch it', async () => {
      const other = await db.createUser({ email: 'other@gracelead.test', role: 'staff' })
      const created = await db.asUser(admin.id, (sql) =>
        sql.query<{ id: string }>(
          `insert into public.follow_ups (contact_id, title, due_at, assigned_to, created_by)
           values ($1, 'Private task', now() + interval '2 days', $2, $3) returning id`,
          [contactId, admin.id, admin.id],
        ),
      )

      const { rows } = await db.asUser(other.id, (sql) =>
        sql.query(`update public.follow_ups set title = 'Stolen' where id = $1 returning id`, [
          created.rows[0]!.id,
        ]),
      )
      expect(rows).toEqual([])
    })
  })

  describe('integration tables are read-only to the team', () => {
    let audienceId: string

    beforeAll(async () => {
      const created = await db.asServiceRole((sql) =>
        sql.query<{ id: string }>(
          `insert into public.mailchimp_audiences (mailchimp_list_id, name)
           values ('list-1', 'Main List') returning id`,
        ),
      )
      audienceId = created.rows[0]!.id
    })

    it('lets staff read audiences', async () => {
      const { rows } = await db.asUser(staff.id, (sql) =>
        sql.query('select id from public.mailchimp_audiences'),
      )
      expect(rows).toHaveLength(1)
    })

    it('refuses staff writes', async () => {
      expect(
        await expectRejected(
          db.asUser(staff.id, (sql) =>
            sql.query(
              `insert into public.mailchimp_audiences (mailchimp_list_id, name) values ('list-2','Nope')`,
            ),
          ),
        ),
      ).toMatch(/row-level security/i)
    })

    it('lets an admin re-link a subscriber to the right contact', async () => {
      const member = await db.asServiceRole((sql) =>
        sql.query<{ id: string }>(
          `insert into public.mailchimp_members (audience_id, mailchimp_member_id, email_address)
           values ($1, 'hash-1', 'ada@example.org') returning id`,
          [audienceId],
        ),
      )
      const { rows } = await db.asUser(admin.id, (sql) =>
        sql.query<{ id: string }>(
          `update public.mailchimp_members set contact_id = $2 where id = $1 returning id`,
          [member.rows[0]!.id, contactId],
        ),
      )
      expect(rows).toHaveLength(1)
    })
  })

  describe('notification outbox', () => {
    beforeAll(async () => {
      await db.asServiceRole((sql) =>
        sql.query(
          `insert into public.notifications (kind, dedupe_key, recipients, subject)
           values ('lead_created', 'lead_created:test', array['team@gracelead.test'], 'New lead')`,
        ),
      )
    })

    it('is visible to admins only', async () => {
      const asAdmin = await db.asUser(admin.id, (sql) =>
        sql.query('select id from public.notifications'),
      )
      expect(asAdmin.rows).toHaveLength(1)

      const asStaff = await db.asUser(staff.id, (sql) =>
        sql.query('select id from public.notifications'),
      )
      expect(asStaff.rows).toEqual([])
    })

    it('cannot be written by the team', async () => {
      expect(
        await expectRejected(
          db.asUser(admin.id, (sql) =>
            sql.query(
              `insert into public.notifications (kind, dedupe_key, recipients, subject)
               values ('x','y',array['a@b.c'],'s')`,
            ),
          ),
        ),
      ).toMatch(/row-level security/i)
    })
  })

  describe('service role', () => {
    it('sees through RLS for sync jobs', async () => {
      const { rows } = await db.asServiceRole((sql) =>
        sql.query<{ count: number }>('select count(*)::int as count from public.contacts'),
      )
      expect(rows[0]!.count).toBeGreaterThan(0)
    })

    it('can read gifts regardless of the giving flag', async () => {
      const { rows } = await db.asServiceRole((sql) =>
        sql.query('select id from public.gifts'),
      )
      expect(rows.length).toBeGreaterThan(0)
    })
  })
})
