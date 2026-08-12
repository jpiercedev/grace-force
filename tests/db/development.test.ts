import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, expectRejected, type TestDb, type TestUser } from './helpers/db'

/**
 * The relationship-development schema: related constituents, interests,
 * capability, events, proposals, call reports and attachments.
 *
 * The same principle as `behaviour.test.ts` — much of the correctness here is
 * delegated to Postgres on purpose. The timeline is complete because triggers
 * write it; the paired fields stay honest because check constraints refuse the
 * alternative; capability and proposals stay private because a policy says so,
 * not because a component remembered to hide them.
 */
describe('relationship development schema', () => {
  let db: TestDb
  let admin: TestUser
  let staff: TestUser
  let fundraiser: TestUser
  let viewer: TestUser
  let ada: string
  let grace: string

  beforeAll(async () => {
    db = await createTestDb()
    admin = await db.createUser({ email: 'dev-admin@graceforce.test' })
    staff = await db.createUser({ email: 'dev-staff@graceforce.test', role: 'staff' })
    // Staff *with* the giving capability: the only kind that may read a
    // proposal or a capability estimate.
    fundraiser = await db.createUser({
      email: 'dev-fundraiser@graceforce.test',
      role: 'staff',
      canViewGiving: true,
    })
    viewer = await db.createUser({ email: 'dev-viewer@graceforce.test', role: 'viewer' })

    const contacts = await db.asUser(staff.id, (sql) =>
      sql.query<{ id: string }>(
        `insert into public.contacts (first_name, last_name, email, created_by)
         values ('Ada','Lovelace','ada@example.org',$1),
                ('Grace','Hopper','grace@example.org',$1)
         returning id`,
        [staff.id],
      ),
    )
    ada = contacts.rows[0]!.id
    grace = contacts.rows[1]!.id
  }, 180_000)

  afterAll(async () => {
    await db?.close()
  })

  async function activitiesFor(contactId: string, type?: string) {
    const { rows } = await db.asPostgres((sql) =>
      sql.query<{ type: string; subject: string; metadata: Record<string, unknown> }>(
        `select type, subject, metadata from public.activities
          where contact_id = $1 ${type ? 'and type = $2' : ''}
          order by created_at`,
        type ? [contactId, type] : [contactId],
      ),
    )
    return rows
  }

  // --- Related constituents -------------------------------------------------

  describe('related constituents', () => {
    it('stores one directed row that answers both directions', async () => {
      await db.asUser(staff.id, (sql) =>
        sql.query(
          `insert into public.contact_relationships (from_contact_id, to_contact_id, kind, created_by)
           values ($1, $2, 'spouse', $3)`,
          [grace, ada, staff.id],
        ),
      )

      // Reading from Ada's side finds it as an incoming link; reading from
      // Grace's side finds the same row outgoing. One fact, two views.
      const { rows } = await db.asUser(staff.id, (sql) =>
        sql.query<{ count: number }>(
          `select count(*) from public.contact_relationships
            where from_contact_id = $1 or to_contact_id = $1`,
          [ada],
        ),
      )
      expect(Number(rows[0]!.count)).toBe(1)

      const fromGrace = await db.asUser(staff.id, (sql) =>
        sql.query<{ count: number }>(
          `select count(*) from public.contact_relationships
            where from_contact_id = $1 or to_contact_id = $1`,
          [grace],
        ),
      )
      expect(Number(fromGrace.rows[0]!.count)).toBe(1)
    })

    it('refuses to link a person to themselves', async () => {
      const message = await expectRejected(
        db.asUser(staff.id, (sql) =>
          sql.query(
            `insert into public.contact_relationships (from_contact_id, to_contact_id, kind)
             values ($1, $1, 'friend')`,
            [ada],
          ),
        ),
      )
      expect(message).toMatch(/contact_relationships_not_self/)
    })

    it('refuses the identical link twice', async () => {
      const message = await expectRejected(
        db.asUser(staff.id, (sql) =>
          sql.query(
            `insert into public.contact_relationships (from_contact_id, to_contact_id, kind)
             values ($1, $2, 'spouse')`,
            [grace, ada],
          ),
        ),
      )
      expect(message).toMatch(/contact_relationships_unique_link/)
    })

    it('allows a different kind between the same two people', async () => {
      await db.asUser(staff.id, (sql) =>
        sql.query(
          `insert into public.contact_relationships (from_contact_id, to_contact_id, kind)
           values ($1, $2, 'business_associate')`,
          [grace, ada],
        ),
      )
      const { rows } = await db.asUser(staff.id, (sql) =>
        sql.query<{ count: number }>(
          `select count(*) from public.contact_relationships where to_contact_id = $1`,
          [ada],
        ),
      )
      expect(Number(rows[0]!.count)).toBe(2)
    })

    it('disappears when one of the two people is deleted', async () => {
      const temp = await db.asUser(staff.id, (sql) =>
        sql.query<{ id: string }>(
          `insert into public.contacts (first_name, last_name) values ('Temp','Person') returning id`,
        ),
      )
      const tempId = temp.rows[0]!.id
      await db.asUser(staff.id, (sql) =>
        sql.query(
          `insert into public.contact_relationships (from_contact_id, to_contact_id, kind)
           values ($1, $2, 'friend')`,
          [tempId, ada],
        ),
      )
      await db.asUser(admin.id, (sql) =>
        sql.query('delete from public.contacts where id = $1', [tempId]),
      )
      const { rows } = await db.asPostgres((sql) =>
        sql.query<{ count: number }>(
          `select count(*) from public.contact_relationships where from_contact_id = $1`,
          [tempId],
        ),
      )
      expect(Number(rows[0]!.count)).toBe(0)
    })
  })

  // --- Interests ------------------------------------------------------------

  describe('interests', () => {
    it('ships the catalogue the application links to by slug', async () => {
      const { rows } = await db.asUser(staff.id, (sql) =>
        sql.query<{ slug: string }>('select slug from public.interest_areas order by sort_order'),
      )
      const slugs = rows.map((row) => row.slug)
      expect(slugs).toEqual(
        expect.arrayContaining(['life-centre', 'legacy-event', 'planned-giving', 'capital-projects']),
      )
    })

    it('records an interest once per person', async () => {
      const area = await db.asPostgres((sql) =>
        sql.query<{ id: string }>(`select id from public.interest_areas where slug = 'life-centre'`),
      )
      const areaId = area.rows[0]!.id

      await db.asUser(staff.id, (sql) =>
        sql.query(
          `insert into public.contact_interests (contact_id, interest_area_id, note)
           values ($1, $2, 'Wants it finished before her grandchildren are grown')`,
          [ada, areaId],
        ),
      )

      const message = await expectRejected(
        db.asUser(staff.id, (sql) =>
          sql.query(
            `insert into public.contact_interests (contact_id, interest_area_id) values ($1, $2)`,
            [ada, areaId],
          ),
        ),
      )
      expect(message).toMatch(/contact_interests_contact_id_interest_area_id_key/)
    })
  })

  // --- Giving capability ----------------------------------------------------

  describe('giving capability', () => {
    beforeAll(async () => {
      await db.asUser(fundraiser.id, (sql) =>
        sql.query(
          `insert into public.contact_capability
             (contact_id, level, range_low_cents, range_high_cents, confidence, source, updated_by)
           values ($1, 'significant', 1000000, 5000000, 'medium', 'She mentioned the farm sale', $2)`,
          [ada, fundraiser.id],
        ),
      )
    })

    it('refuses a range that runs backwards', async () => {
      const message = await expectRejected(
        db.asUser(fundraiser.id, (sql) =>
          sql.query(
            `insert into public.contact_capability (contact_id, range_low_cents, range_high_cents)
             values ($1, 5000000, 1000000)`,
            [grace],
          ),
        ),
      )
      expect(message).toMatch(/contact_capability_range_ordered/)
    })

    it('is readable by staff granted giving access', async () => {
      const { rows } = await db.asUser(fundraiser.id, (sql) =>
        sql.query('select level from public.contact_capability where contact_id = $1', [ada]),
      )
      expect(rows).toHaveLength(1)
    })

    it('is invisible to staff without giving access, even though they can read the person', async () => {
      const person = await db.asUser(staff.id, (sql) =>
        sql.query('select id from public.contacts where id = $1', [ada]),
      )
      expect(person.rows).toHaveLength(1)

      const capability = await db.asUser(staff.id, (sql) =>
        sql.query('select level from public.contact_capability where contact_id = $1', [ada]),
      )
      expect(capability.rows).toHaveLength(0)
    })

    it('is invisible to a viewer', async () => {
      const { rows } = await db.asUser(viewer.id, (sql) =>
        sql.query('select level from public.contact_capability where contact_id = $1', [ada]),
      )
      expect(rows).toHaveLength(0)
    })
  })

  // --- Events ---------------------------------------------------------------

  describe('events and attendance', () => {
    let eventId: string

    beforeAll(async () => {
      const event = await db.asUser(staff.id, (sql) =>
        sql.query<{ id: string }>(
          `insert into public.events (name, kind, event_date, location, created_by)
           values ('Legacy dinner', 'banquet', date '2026-05-14', 'The Life Centre', $1)
           returning id`,
          [staff.id],
        ),
      )
      eventId = event.rows[0]!.id
    })

    it('does not post an invitation to the timeline', async () => {
      await db.asUser(staff.id, (sql) =>
        sql.query(
          `insert into public.event_attendees (event_id, contact_id, status)
           values ($1, $2, 'invited')`,
          [eventId, grace],
        ),
      )
      expect(await activitiesFor(grace, 'event_attended')).toHaveLength(0)
    })

    it('posts to the timeline once attendance is recorded', async () => {
      await db.asUser(staff.id, (sql) =>
        sql.query(
          `update public.event_attendees set status = 'attended', note = 'Sat with the Hendersons'
            where event_id = $1 and contact_id = $2`,
          [eventId, grace],
        ),
      )
      const entries = await activitiesFor(grace, 'event_attended')
      expect(entries).toHaveLength(1)
      expect(entries[0]!.subject).toBe('Attended Legacy dinner')
      expect(entries[0]!.metadata.location).toBe('The Life Centre')
    })

    it('does not post twice when attendance is toggled away and back', async () => {
      await db.asUser(staff.id, (sql) =>
        sql.query(
          `update public.event_attendees set status = 'no_show' where event_id = $1 and contact_id = $2`,
          [eventId, grace],
        ),
      )
      await db.asUser(staff.id, (sql) =>
        sql.query(
          `update public.event_attendees set status = 'attended' where event_id = $1 and contact_id = $2`,
          [eventId, grace],
        ),
      )
      expect(await activitiesFor(grace, 'event_attended')).toHaveLength(1)
    })

    it('records a person at an event only once', async () => {
      const message = await expectRejected(
        db.asUser(staff.id, (sql) =>
          sql.query(
            `insert into public.event_attendees (event_id, contact_id) values ($1, $2)`,
            [eventId, grace],
          ),
        ),
      )
      expect(message).toMatch(/event_attendees_event_id_contact_id_key/)
    })
  })

  // --- Proposals ------------------------------------------------------------

  describe('proposals', () => {
    let proposalId: string

    beforeAll(async () => {
      const proposal = await db.asUser(fundraiser.id, (sql) =>
        sql.query<{ id: string }>(
          `insert into public.proposals
             (contact_id, title, kind, status, charitable_amount_cents, owner_id, created_by)
           values ($1, 'Charitable remainder trust', 'trust', 'exploring', 25000000, $2, $2)
           returning id`,
          [ada, fundraiser.id],
        ),
      )
      proposalId = proposal.rows[0]!.id
    })

    it('posts its creation to the donor timeline', async () => {
      const entries = await activitiesFor(ada, 'proposal_created')
      expect(entries).toHaveLength(1)
      expect(entries[0]!.subject).toBe('Proposal opened — Charitable remainder trust')
    })

    it('posts a stage move', async () => {
      await db.asUser(fundraiser.id, (sql) =>
        sql.query(`update public.proposals set status = 'presented' where id = $1`, [proposalId]),
      )
      const entries = await activitiesFor(ada, 'proposal_stage_changed')
      expect(entries).toHaveLength(1)
      expect(entries[0]!.metadata).toMatchObject({ from: 'exploring', to: 'presented' })
    })

    it('refuses a settled status without a settlement time', async () => {
      const message = await expectRejected(
        db.asUser(fundraiser.id, (sql) =>
          sql.query(`update public.proposals set status = 'funded' where id = $1`, [proposalId]),
        ),
      )
      expect(message).toMatch(/proposals_closed_consistency/)
    })

    it('refuses an open status that claims to have settled', async () => {
      const message = await expectRejected(
        db.asUser(fundraiser.id, (sql) =>
          sql.query(`update public.proposals set closed_at = now() where id = $1`, [proposalId]),
        ),
      )
      expect(message).toMatch(/proposals_closed_consistency/)
    })

    it('posts a close when the two fields agree', async () => {
      await db.asUser(fundraiser.id, (sql) =>
        sql.query(
          `update public.proposals set status = 'funded', closed_at = now() where id = $1`,
          [proposalId],
        ),
      )
      const entries = await activitiesFor(ada, 'proposal_closed')
      expect(entries).toHaveLength(1)
    })

    it('refuses a joint donor who is the donor', async () => {
      const message = await expectRejected(
        db.asUser(fundraiser.id, (sql) =>
          sql.query(
            `insert into public.proposals (contact_id, joint_contact_id, title)
             values ($1, $1, 'Nonsense')`,
            [ada],
          ),
        ),
      )
      expect(message).toMatch(/proposals_joint_is_someone_else/)
    })

    it('is invisible to staff without giving access', async () => {
      const { rows } = await db.asUser(staff.id, (sql) =>
        sql.query('select id from public.proposals where contact_id = $1', [ada]),
      )
      expect(rows).toHaveLength(0)
    })

    it('cannot be written by staff without giving access', async () => {
      const message = await expectRejected(
        db.asUser(staff.id, (sql) =>
          sql.query(`insert into public.proposals (contact_id, title) values ($1, 'Sneaky')`, [ada]),
        ),
      )
      expect(message).toMatch(/row-level security|violates/i)
    })
  })

  // --- Call reports ---------------------------------------------------------

  describe('call reports', () => {
    let draftId: string

    beforeAll(async () => {
      const report = await db.asUser(staff.id, (sql) =>
        sql.query<{ id: string }>(
          `insert into public.call_reports (contact_id, author_id, met_on, summary)
           values ($1, $2, date '2026-05-20', 'Long conversation about the land')
           returning id`,
          [ada, staff.id],
        ),
      )
      draftId = report.rows[0]!.id
    })

    it('keeps a draft off the timeline', async () => {
      expect(await activitiesFor(ada, 'call_report')).toHaveLength(0)
    })

    it('hides a draft from everyone but its author and administrators', async () => {
      const asAuthor = await db.asUser(staff.id, (sql) =>
        sql.query('select id from public.call_reports where id = $1', [draftId]),
      )
      expect(asAuthor.rows).toHaveLength(1)

      const asColleague = await db.asUser(fundraiser.id, (sql) =>
        sql.query('select id from public.call_reports where id = $1', [draftId]),
      )
      expect(asColleague.rows).toHaveLength(0)

      const asAdmin = await db.asUser(admin.id, (sql) =>
        sql.query('select id from public.call_reports where id = $1', [draftId]),
      )
      expect(asAdmin.rows).toHaveLength(1)
    })

    it('refuses a filed report with no filing time', async () => {
      const message = await expectRejected(
        db.asUser(staff.id, (sql) =>
          sql.query(`update public.call_reports set status = 'filed' where id = $1`, [draftId]),
        ),
      )
      expect(message).toMatch(/call_reports_filed_consistency/)
    })

    it('posts to the timeline once filed, and only once', async () => {
      await db.asUser(staff.id, (sql) =>
        sql.query(
          `update public.call_reports set status = 'filed', filed_at = now() where id = $1`,
          [draftId],
        ),
      )
      expect(await activitiesFor(ada, 'call_report')).toHaveLength(1)

      // Editing a filed report must not post a second entry.
      await db.asUser(staff.id, (sql) =>
        sql.query(`update public.call_reports set summary = 'Edited' where id = $1`, [draftId]),
      )
      expect(await activitiesFor(ada, 'call_report')).toHaveLength(1)
    })

    it('becomes visible to colleagues once filed', async () => {
      const { rows } = await db.asUser(fundraiser.id, (sql) =>
        sql.query('select id from public.call_reports where id = $1', [draftId]),
      )
      expect(rows).toHaveLength(1)
    })
  })

  // --- Attachments ----------------------------------------------------------

  describe('attachments', () => {
    let attachmentId: string

    beforeAll(async () => {
      const attachment = await db.asUser(staff.id, (sql) =>
        sql.query<{ id: string }>(
          `insert into public.attachments (contact_id, storage_path, file_name, mime_type, size_bytes, uploaded_by)
           values ($1, $2, 'estate-plan.pdf', 'application/pdf', 482910, $3)
           returning id`,
          [ada, `${ada}/abc-estate-plan.pdf`, staff.id],
        ),
      )
      attachmentId = attachment.rows[0]!.id
    })

    it('refuses two rows claiming the same object', async () => {
      const message = await expectRejected(
        db.asUser(staff.id, (sql) =>
          sql.query(
            `insert into public.attachments (contact_id, storage_path, file_name)
             values ($1, $2, 'copy.pdf')`,
            [ada, `${ada}/abc-estate-plan.pdf`],
          ),
        ),
      )
      expect(message).toMatch(/attachments_storage_path_key/)
    })

    it('is readable by any active user, including a viewer', async () => {
      const { rows } = await db.asUser(viewer.id, (sql) =>
        sql.query('select file_name from public.attachments where id = $1', [attachmentId]),
      )
      expect(rows).toHaveLength(1)
    })

    it('can only be removed by whoever uploaded it, or an administrator', async () => {
      const byOtherStaff = await db.asUser(fundraiser.id, (sql) =>
        sql.query('delete from public.attachments where id = $1 returning id', [attachmentId]),
      )
      expect(byOtherStaff.rows).toHaveLength(0)

      const byUploader = await db.asUser(staff.id, (sql) =>
        sql.query('delete from public.attachments where id = $1 returning id', [attachmentId]),
      )
      expect(byUploader.rows).toHaveLength(1)
    })
  })

  // --- Write permissions ----------------------------------------------------

  describe('write permissions', () => {
    it('refuses every development write from a viewer', async () => {
      const statements: Array<[string, string[]]> = [
        [
          `insert into public.contact_relationships (from_contact_id, to_contact_id, kind) values ($1, $2, 'friend')`,
          [ada, grace],
        ],
        [
          `insert into public.contact_interests (contact_id, interest_area_id)
             select $1, id from public.interest_areas limit 1`,
          [ada],
        ],
        [`insert into public.events (name, event_date) values ('Sneaky', current_date)`, []],
        [`insert into public.call_reports (contact_id, met_on) values ($1, current_date)`, [ada]],
        [
          `insert into public.attachments (contact_id, storage_path, file_name) values ($1, 'x/y.pdf', 'y.pdf')`,
          [ada],
        ],
      ]

      for (const [statement, args] of statements) {
        const message = await expectRejected(
          db.asUser(viewer.id, (sql) => sql.query(statement, args)),
        )
        expect(message).toMatch(/row-level security|violates/i)
      }
    })
  })
})
