import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, expectRejected, type TestDb, type TestUser } from './helpers/db'

/**
 * The shared-team visibility model, end to end.
 *
 * 20260814183353 makes Grace Lead Management one shared workspace: every
 * active, authenticated team member reads the same business records, and the
 * ownership columns (owner_id, assigned_to, created_by, author_id) record
 * responsibility without ever hiding a row. This suite proves the whole
 * promise in one place — what opened up, and just as importantly what did
 * not: anon still reaches nothing, deactivated profiles still see nothing,
 * and viewers still cannot write.
 */
describe('shared team visibility', () => {
  let db: TestDb
  let userA: TestUser
  let userB: TestUser
  let viewer: TestUser
  let inactive: TestUser
  let personId: string

  beforeAll(async () => {
    db = await createTestDb()

    // The provisioning trigger promotes the first profile to admin, and the
    // last-active-administrator guard needs one to exist throughout. Nothing
    // here acts as the admin — shared visibility is about everyone else.
    await db.createUser({ email: 'sv-admin@graceforce.test' })
    userA = await db.createUser({ email: 'sv-a@graceforce.test', role: 'staff' })
    // Explicitly without the legacy giving flag: the point of the model is
    // that this makes no difference to what userB can read.
    userB = await db.createUser({
      email: 'sv-b@graceforce.test',
      role: 'staff',
      canViewGiving: false,
    })
    viewer = await db.createUser({ email: 'sv-viewer@graceforce.test', role: 'viewer' })
    inactive = await db.createUser({
      email: 'sv-former@graceforce.test',
      role: 'staff',
      isActive: false,
    })

    const person = await db.asUser(userA.id, (sql) =>
      sql.query<{ id: string }>(
        `insert into public.contacts (first_name, last_name, email, created_by)
         values ('Margaret', 'Whitfield', 'margaret@example.org', $1) returning id`,
        [userA.id],
      ),
    )
    personId = person.rows[0]!.id
  }, 180_000)

  afterAll(async () => {
    await db?.close()
  })

  // --- People ---------------------------------------------------------------

  describe('people are visible to the whole team', () => {
    it('user B sees the person user A created', async () => {
      const { rows } = await db.asUser(userB.id, (sql) =>
        sql.query('select id from public.contacts where id = $1', [personId]),
      )
      expect(rows).toHaveLength(1)
    })

    it('a viewer sees the person too', async () => {
      const { rows } = await db.asUser(viewer.id, (sql) =>
        sql.query('select id from public.contacts where id = $1', [personId]),
      )
      expect(rows).toHaveLength(1)
    })

    it('a deactivated profile sees nothing, even though it authenticates', async () => {
      const { rows } = await db.asUser(inactive.id, (sql) =>
        sql.query('select id from public.contacts'),
      )
      expect(rows).toEqual([])
    })

    it('anon is refused at the privilege layer, not just filtered', async () => {
      const message = await expectRejected(
        db.asAnon((sql) => sql.query('select * from public.contacts')),
      )
      expect(message).toMatch(/permission denied/i)
    })
  })

  // --- Opportunities ----------------------------------------------------------

  describe('opportunities are shared working records', () => {
    let pipelineId: string
    let firstStageId: string
    let secondStageId: string
    let opportunityId: string

    beforeAll(async () => {
      const pipeline = await db.asUser(userA.id, (sql) =>
        sql.query<{ id: string }>(
          `insert into public.pipelines (slug, name) values ('field_partnerships', 'Field Partnerships')
           returning id`,
        ),
      )
      pipelineId = pipeline.rows[0]!.id

      const stages = await db.asUser(userA.id, (sql) =>
        sql.query<{ id: string }>(
          `insert into public.pipeline_stages (pipeline_id, slug, name, position)
           values ($1, 'introduced', 'Introduced', 10),
                  ($1, 'in_conversation', 'In Conversation', 20)
           returning id`,
          [pipelineId],
        ),
      )
      firstStageId = stages.rows[0]!.id
      secondStageId = stages.rows[1]!.id

      const opportunity = await db.asUser(userA.id, (sql) =>
        sql.query<{ id: string }>(
          `insert into public.pipeline_cards
             (pipeline_id, stage_id, contact_id, title, organization_name, next_step, created_by)
           values ($1, $2, $3, 'Whitfield partnership', 'Whitfield Farms', 'Send the draft MOU', $4)
           returning id`,
          [pipelineId, firstStageId, personId, userA.id],
        ),
      )
      opportunityId = opportunity.rows[0]!.id
    })

    it('user B sees the pipeline, its stages and the opportunity user A created', async () => {
      const pipeline = await db.asUser(userB.id, (sql) =>
        sql.query('select id from public.pipelines where id = $1', [pipelineId]),
      )
      expect(pipeline.rows).toHaveLength(1)

      const stages = await db.asUser(userB.id, (sql) =>
        sql.query('select id from public.pipeline_stages where pipeline_id = $1', [pipelineId]),
      )
      expect(stages.rows).toHaveLength(2)

      const opportunity = await db.asUser(userB.id, (sql) =>
        sql.query<{ organization_name: string; next_step: string }>(
          'select organization_name, next_step from public.pipeline_cards where id = $1',
          [opportunityId],
        ),
      )
      expect(opportunity.rows).toHaveLength(1)
      expect(opportunity.rows[0]!.organization_name).toBe('Whitfield Farms')
      expect(opportunity.rows[0]!.next_step).toBe('Send the draft MOU')
    })

    it('user B can move the opportunity and retitle it', async () => {
      // Any staff member works the board — there is no per-owner write fence.
      const moved = await db.asUser(userB.id, (sql) =>
        sql.query<{ id: string }>(
          `update public.pipeline_cards
              set stage_id = $2, title = 'Whitfield Farms partnership'
            where id = $1 returning id`,
          [opportunityId, secondStageId],
        ),
      )
      expect(moved.rows).toHaveLength(1)

      const check = await db.asUser(userA.id, (sql) =>
        sql.query<{ stage_id: string; title: string }>(
          'select stage_id, title from public.pipeline_cards where id = $1',
          [opportunityId],
        ),
      )
      expect(check.rows[0]!.stage_id).toBe(secondStageId)
      expect(check.rows[0]!.title).toBe('Whitfield Farms partnership')
    })

    it('a viewer can read the board but not shape it', async () => {
      const board = await db.asUser(viewer.id, (sql) =>
        sql.query('select id from public.pipeline_cards where id = $1', [opportunityId]),
      )
      expect(board.rows).toHaveLength(1)

      expect(
        await expectRejected(
          db.asUser(viewer.id, (sql) =>
            sql.query(`insert into public.pipelines (slug, name) values ('sneaky', 'Sneaky')`),
          ),
        ),
      ).toMatch(/row-level security/i)

      expect(
        await expectRejected(
          db.asUser(viewer.id, (sql) =>
            sql.query(
              `insert into public.pipeline_cards (pipeline_id, stage_id, contact_id, title)
               values ($1, $2, $3, 'Sneaky')`,
              [pipelineId, firstStageId, personId],
            ),
          ),
        ),
      ).toMatch(/row-level security/i)

      const touched = await db.asUser(viewer.id, (sql) =>
        sql.query(
          `update public.pipeline_cards set title = 'Hijacked' where id = $1 returning id`,
          [opportunityId],
        ),
      )
      // No row passes the USING clause, so the update is a no-op.
      expect(touched.rows).toEqual([])
    })

    // --- Assignment ---------------------------------------------------------

    describe('assignment records responsibility, not visibility', () => {
      let followUpId: string

      beforeAll(async () => {
        const followUp = await db.asUser(userA.id, (sql) =>
          sql.query<{ id: string }>(
            `insert into public.follow_ups (contact_id, title, due_at, assigned_to, created_by)
             values ($1, 'Walk the property', now() + interval '3 days', $2, $2) returning id`,
            [personId, userA.id],
          ),
        )
        followUpId = followUp.rows[0]!.id
      })

      async function whoSees(table: string, id: string): Promise<boolean[]> {
        const results: boolean[] = []
        for (const user of [userA, userB, viewer]) {
          const { rows } = await db.asUser(user.id, (sql) =>
            sql.query(`select id from public.${table} where id = $1`, [id]),
          )
          results.push(rows.length === 1)
        }
        return results
      }

      it('handing the opportunity to user B changes nothing about who reads it', async () => {
        await db.asUser(userA.id, (sql) =>
          sql.query(`update public.pipeline_cards set owner_id = $2 where id = $1`, [
            opportunityId,
            userB.id,
          ]),
        )
        expect(await whoSees('pipeline_cards', opportunityId)).toEqual([true, true, true])

        // And handing it back changes nothing either — ownership is a label.
        await db.asUser(userB.id, (sql) =>
          sql.query(`update public.pipeline_cards set owner_id = $2 where id = $1`, [
            opportunityId,
            userA.id,
          ]),
        )
        expect(await whoSees('pipeline_cards', opportunityId)).toEqual([true, true, true])
      })

      it('reassigning a follow-up changes nothing about who reads it', async () => {
        await db.asUser(userA.id, (sql) =>
          sql.query(`update public.follow_ups set assigned_to = $2 where id = $1`, [
            followUpId,
            userB.id,
          ]),
        )
        expect(await whoSees('follow_ups', followUpId)).toEqual([true, true, true])

        // The assignee may hand it on; everyone still reads the same row.
        await db.asUser(userB.id, (sql) =>
          sql.query(`update public.follow_ups set assigned_to = $2 where id = $1`, [
            followUpId,
            userA.id,
          ]),
        )
        expect(await whoSees('follow_ups', followUpId)).toEqual([true, true, true])
      })
    })
  })

  // --- Giving records ---------------------------------------------------------

  describe('giving records are shared with every active user', () => {
    let giftId: string
    let proposalId: string
    let callReportId: string

    beforeAll(async () => {
      // Gifts arrive by sync/import; manual entry stays an admin correction.
      // The service role records this one, as production would.
      const gift = await db.asServiceRole((sql) =>
        sql.query<{ id: string }>(
          `insert into public.gifts (contact_id, amount_cents, given_on, fund)
           values ($1, 500000, current_date, 'Land Fund') returning id`,
          [personId],
        ),
      )
      giftId = gift.rows[0]!.id

      const proposal = await db.asUser(userA.id, (sql) =>
        sql.query<{ id: string }>(
          `insert into public.proposals (contact_id, title, charitable_amount_cents, created_by)
           values ($1, 'Gift of the north field', 12500000, $2) returning id`,
          [personId, userA.id],
        ),
      )
      proposalId = proposal.rows[0]!.id

      await db.asUser(userA.id, (sql) =>
        sql.query(
          `insert into public.contact_capability (contact_id, level, updated_by)
           values ($1, 'major', $2)`,
          [personId, userA.id],
        ),
      )

      // Deliberately left a draft: draft status used to hide a report from
      // everyone but its author, and must not any more.
      const report = await db.asUser(userA.id, (sql) =>
        sql.query<{ id: string }>(
          `insert into public.call_reports (contact_id, author_id, met_on, summary)
           values ($1, $2, current_date, 'Talked through the land gift')
           returning id`,
          [personId, userA.id],
        ),
      )
      callReportId = report.rows[0]!.id
    })

    it('user B reads all four without the giving flag', async () => {
      const gift = await db.asUser(userB.id, (sql) =>
        sql.query('select id from public.gifts where id = $1', [giftId]),
      )
      expect(gift.rows).toHaveLength(1)

      const proposal = await db.asUser(userB.id, (sql) =>
        sql.query('select id from public.proposals where id = $1', [proposalId]),
      )
      expect(proposal.rows).toHaveLength(1)

      const capability = await db.asUser(userB.id, (sql) =>
        sql.query('select level from public.contact_capability where contact_id = $1', [personId]),
      )
      expect(capability.rows).toHaveLength(1)

      const draft = await db.asUser(userB.id, (sql) =>
        sql.query('select id from public.call_reports where id = $1', [callReportId]),
      )
      expect(draft.rows).toHaveLength(1)
    })

    it('a viewer reads them too', async () => {
      for (const [table, id] of [
        ['gifts', giftId],
        ['proposals', proposalId],
        ['call_reports', callReportId],
      ] as const) {
        const { rows } = await db.asUser(viewer.id, (sql) =>
          sql.query(`select id from public.${table} where id = $1`, [id]),
        )
        expect(rows, `viewer should read ${table}`).toHaveLength(1)
      }

      const capability = await db.asUser(viewer.id, (sql) =>
        sql.query('select level from public.contact_capability where contact_id = $1', [personId]),
      )
      expect(capability.rows).toHaveLength(1)
    })

    it('a viewer can record none of them', async () => {
      const statements: Array<[string, string[]]> = [
        [
          `insert into public.gifts (contact_id, amount_cents, given_on) values ($1, 100, current_date)`,
          [personId],
        ],
        [`insert into public.proposals (contact_id, title) values ($1, 'Sneaky')`, [personId]],
        [
          `insert into public.contact_capability (contact_id, level) values ($1, 'modest')`,
          [personId],
        ],
        [`insert into public.call_reports (contact_id, met_on) values ($1, current_date)`, [personId]],
      ]

      for (const [statement, args] of statements) {
        const message = await expectRejected(
          db.asUser(viewer.id, (sql) => sql.query(statement, args)),
        )
        expect(message).toMatch(/row-level security|violates/i)
      }
    })

    it('a deactivated profile reads none of them', async () => {
      for (const table of ['gifts', 'proposals', 'contact_capability', 'call_reports', 'leads']) {
        const { rows } = await db.asUser(inactive.id, (sql) =>
          sql.query(`select * from public.${table}`),
        )
        expect(rows, `deactivated profile should read nothing from ${table}`).toEqual([])
      }
    })

    it('anon reaches none of them', async () => {
      for (const table of ['gifts', 'proposals', 'contact_capability', 'call_reports', 'leads']) {
        const message = await expectRejected(
          db.asAnon((sql) => sql.query(`select * from public.${table}`)),
        )
        expect(message, `anon should be refused on ${table}`).toMatch(/permission denied/i)
      }
    })

    it('can_view_giving no longer partitions: flagged and unflagged staff read the same gifts', async () => {
      // The column and function still exist — the migration keeps them for a
      // clean rollback — but nothing references them, so the flag is inert.
      const flagged = await db.createUser({
        email: 'sv-flagged@graceforce.test',
        role: 'staff',
        canViewGiving: true,
      })

      const withFlag = await db.asUser(flagged.id, (sql) =>
        sql.query<{ id: string }>('select id from public.gifts order by id'),
      )
      const withoutFlag = await db.asUser(userB.id, (sql) =>
        sql.query<{ id: string }>('select id from public.gifts order by id'),
      )

      expect(withoutFlag.rows.length).toBeGreaterThan(0)
      expect(withoutFlag.rows).toEqual(withFlag.rows)
    })
  })
})
