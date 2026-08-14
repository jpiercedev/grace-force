import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, expectRejected, migrationFiles, type TestDb, type TestUser } from './helpers/db'

/**
 * The shared sales model introduced by the 20260814 migrations: staff-managed
 * pipelines, opportunities generalized from pipeline_cards, and one-workspace
 * visibility. Everything here is a database property — the guards must hold
 * against raw SQL, not only against well-behaved application code.
 */
describe('shared sales pipelines', () => {
  let db: TestDb
  let admin: TestUser
  let alice: TestUser // staff
  let bob: TestUser // staff
  let viewer: TestUser
  let inactive: TestUser
  let personId: string

  beforeAll(async () => {
    db = await createTestDb()
    admin = await db.createUser({ email: 'sales-admin@graceforce.test' })
    alice = await db.createUser({ email: 'sales-alice@graceforce.test', role: 'staff' })
    bob = await db.createUser({ email: 'sales-bob@graceforce.test', role: 'staff' })
    viewer = await db.createUser({ email: 'sales-viewer@graceforce.test', role: 'viewer' })
    inactive = await db.createUser({
      email: 'sales-inactive@graceforce.test',
      role: 'staff',
      isActive: false,
    })

    const person = await db.asUser(alice.id, (sql) =>
      sql.query<{ id: string }>(
        `insert into public.contacts (first_name, last_name, email, organization_name, created_by)
         values ('Marlowe','Hale','marlowe@example.org','Hale & Daughters',$1)
         returning id`,
        [alice.id],
      ),
    )
    personId = person.rows[0]!.id
  }, 180_000)

  afterAll(async () => {
    await db?.close()
  })

  describe('seeded sales pipelines', () => {
    it('ships General Sales and Relationship Development, shared and staged', async () => {
      const { rows } = await db.asUser(viewer.id, (sql) =>
        sql.query<{ slug: string; name: string; stages: number }>(
          `select p.slug, p.name,
                  (select count(*)::int from public.pipeline_stages s where s.pipeline_id = p.id) as stages
             from public.pipelines p
            where p.slug in ('general_sales','relationship_development')
            order by p.sort_order`,
        ),
      )
      expect(rows.map((r) => r.name)).toEqual(['General Sales', 'Relationship Development'])
      expect(rows[0]!.stages).toBe(6)
      expect(rows[1]!.stages).toBe(5)
    })

    it('re-applying the seed migration creates no duplicates', async () => {
      const count = () =>
        db.asPostgres((sql) =>
          sql.query<{ pipelines: number; stages: number }>(
            `select (select count(*)::int from public.pipelines) as pipelines,
                    (select count(*)::int from public.pipeline_stages) as stages`,
          ),
        )
      const before = (await count()).rows[0]!

      const file = migrationFiles().find((f) => f.includes('sales_reference_data'))!
      await db.asPostgres((sql) =>
        sql.exec(readFileSync(join(process.cwd(), 'supabase', 'migrations', file), 'utf8')),
      )

      const after = (await count()).rows[0]!
      expect(after).toEqual(before)
    })
  })

  describe('one shared workspace', () => {
    let opportunityId: string
    let pipelineId: string
    let firstStage: string
    let secondStage: string

    beforeAll(async () => {
      const pipeline = await db.asPostgres((sql) =>
        sql.query<{ id: string }>(`select id from public.pipelines where slug = 'general_sales'`),
      )
      pipelineId = pipeline.rows[0]!.id
      const stages = await db.asPostgres((sql) =>
        sql.query<{ id: string }>(
          `select id from public.pipeline_stages where pipeline_id = $1 order by position`,
          [pipelineId],
        ),
      )
      firstStage = stages.rows[0]!.id
      secondStage = stages.rows[1]!.id

      const card = await db.asUser(alice.id, (sql) =>
        sql.query<{ id: string }>(
          `insert into public.pipeline_cards
             (pipeline_id, stage_id, contact_id, title, organization_name, next_step,
              value_cents, expected_close_on, owner_id, created_by)
           values ($1, $2, $3, 'Website rebuild', 'Hale & Daughters', 'Send the estimate',
                   1250000, current_date + 30, $4, $4)
           returning id`,
          [pipelineId, firstStage, personId, alice.id],
        ),
      )
      opportunityId = card.rows[0]!.id
    })

    it('lets user B see the person and opportunity user A created', async () => {
      const person = await db.asUser(bob.id, (sql) =>
        sql.query('select id from public.contacts where id = $1', [personId]),
      )
      expect(person.rows).toHaveLength(1)

      const card = await db.asUser(bob.id, (sql) =>
        sql.query<{ title: string; next_step: string; organization_name: string }>(
          'select title, next_step, organization_name from public.pipeline_cards where id = $1',
          [opportunityId],
        ),
      )
      expect(card.rows[0]).toMatchObject({
        title: 'Website rebuild',
        next_step: 'Send the estimate',
        organization_name: 'Hale & Daughters',
      })
    })

    it('lets another staff member update the shared opportunity', async () => {
      const moved = await db.asUser(bob.id, (sql) =>
        sql.query('update public.pipeline_cards set stage_id = $2 where id = $1 returning id', [
          opportunityId,
          secondStage,
        ]),
      )
      expect(moved.rows).toHaveLength(1)
    })

    it('keeps the opportunity visible to everyone after assigning it away', async () => {
      await db.asUser(alice.id, (sql) =>
        sql.query('update public.pipeline_cards set owner_id = $2 where id = $1', [
          opportunityId,
          bob.id,
        ]),
      )

      for (const reader of [alice.id, bob.id, viewer.id, admin.id]) {
        const { rows } = await db.asUser(reader, (sql) =>
          sql.query('select id from public.pipeline_cards where id = $1', [opportunityId]),
        )
        expect(rows).toHaveLength(1)
      }
    })

    it('lets a viewer read but not touch the opportunity', async () => {
      const read = await db.asUser(viewer.id, (sql) =>
        sql.query('select id from public.pipeline_cards where id = $1', [opportunityId]),
      )
      expect(read.rows).toHaveLength(1)

      const write = await db.asUser(viewer.id, (sql) =>
        sql.query(
          `update public.pipeline_cards set next_step = 'Hijacked' where id = $1 returning id`,
          [opportunityId],
        ),
      )
      expect(write.rows).toEqual([])

      const insert = await expectRejected(
        db.asUser(viewer.id, (sql) =>
          sql.query(
            `insert into public.pipeline_cards (pipeline_id, stage_id, contact_id, title)
             values ($1, $2, $3, 'Not allowed')`,
            [pipelineId, firstStage, personId],
          ),
        ),
      )
      expect(insert).toMatch(/row-level security/i)
    })

    it('shows nothing to anonymous or deactivated users', async () => {
      expect(
        await expectRejected(db.asAnon((sql) => sql.query('select * from public.pipeline_cards'))),
      ).toMatch(/permission denied/i)
      expect(
        await expectRejected(db.asAnon((sql) => sql.query('select * from public.pipelines'))),
      ).toMatch(/permission denied/i)

      const asInactive = await db.asUser(inactive.id, (sql) =>
        sql.query('select id from public.pipeline_cards'),
      )
      expect(asInactive.rows).toEqual([])
    })

    it('frees the one-open-slot when an opportunity is archived', async () => {
      // The same person cannot be worked twice in one pipeline at once…
      const duplicate = await expectRejected(
        db.asUser(alice.id, (sql) =>
          sql.query(
            `insert into public.pipeline_cards (pipeline_id, stage_id, contact_id, title)
             values ($1, $2, $3, 'Second open card')`,
            [pipelineId, firstStage, personId],
          ),
        ),
      )
      expect(duplicate).toMatch(/pipeline_cards_one_open_per_contact/)

      // …but archiving the first frees the slot without deleting history.
      await db.asUser(alice.id, (sql) =>
        sql.query(
          `update public.pipeline_cards set status = 'archived', closed_at = now() where id = $1`,
          [opportunityId],
        ),
      )
      const replacement = await db.asUser(alice.id, (sql) =>
        sql.query<{ id: string }>(
          `insert into public.pipeline_cards (pipeline_id, stage_id, contact_id, title)
           values ($1, $2, $3, 'Fresh start') returning id`,
          [pipelineId, firstStage, personId],
        ),
      )
      expect(replacement.rows).toHaveLength(1)

      const archived = await db.asUser(bob.id, (sql) =>
        sql.query<{ status: string }>(
          'select status from public.pipeline_cards where id = $1',
          [opportunityId],
        ),
      )
      expect(archived.rows[0]!.status).toBe('archived')
    })
  })

  describe('staff-managed pipelines', () => {
    let customPipeline: string
    let customStage: string

    it('lets staff create a pipeline with stages', async () => {
      const pipeline = await db.asUser(alice.id, (sql) =>
        sql.query<{ id: string }>(
          `insert into public.pipelines (slug, name, description, tracks_value)
           values ('grant_applications', 'Grant Applications', 'Foundation asks.', true)
           returning id`,
        ),
      )
      customPipeline = pipeline.rows[0]!.id

      const stage = await db.asUser(alice.id, (sql) =>
        sql.query<{ id: string }>(
          `insert into public.pipeline_stages (pipeline_id, slug, name, position)
           values ($1, 'drafting', 'Drafting', 10) returning id`,
          [customPipeline],
        ),
      )
      customStage = stage.rows[0]!.id

      const seen = await db.asUser(bob.id, (sql) =>
        sql.query('select id from public.pipelines where id = $1', [customPipeline]),
      )
      expect(seen.rows).toHaveLength(1)
    })

    it('lets a different staff member rename and reorder what a colleague built', async () => {
      const renamed = await db.asUser(bob.id, (sql) =>
        sql.query(
          `update public.pipelines set name = 'Grants' where id = $1 returning id`,
          [customPipeline],
        ),
      )
      expect(renamed.rows).toHaveLength(1)

      const reordered = await db.asUser(bob.id, (sql) =>
        sql.query(
          `update public.pipeline_stages set position = 5, name = 'Draft' where id = $1 returning id`,
          [customStage],
        ),
      )
      expect(reordered.rows).toHaveLength(1)
    })

    it('refuses pipeline management from viewers', async () => {
      const insert = await expectRejected(
        db.asUser(viewer.id, (sql) =>
          sql.query(`insert into public.pipelines (slug, name) values ('sneaky', 'Sneaky')`),
        ),
      )
      expect(insert).toMatch(/row-level security/i)

      const update = await db.asUser(viewer.id, (sql) =>
        sql.query(`update public.pipelines set name = 'Blocked' where id = $1 returning id`, [
          customPipeline,
        ]),
      )
      expect(update.rows).toEqual([])
    })

    it('refuses to delete a pipeline that still holds opportunities — even as admin', async () => {
      await db.asUser(alice.id, (sql) =>
        sql.query(
          `insert into public.pipeline_cards (pipeline_id, stage_id, contact_id, title)
           values ($1, $2, $3, 'Spring foundation ask')`,
          [customPipeline, customStage, personId],
        ),
      )

      const asStaff = await expectRejected(
        db.asUser(alice.id, (sql) =>
          sql.query('delete from public.pipelines where id = $1', [customPipeline]),
        ),
      )
      expect(asStaff).toMatch(/still holds opportunities/i)

      const asAdmin = await expectRejected(
        db.asUser(admin.id, (sql) =>
          sql.query('delete from public.pipelines where id = $1', [customPipeline]),
        ),
      )
      expect(asAdmin).toMatch(/still holds opportunities/i)

      // Archiving is the safe path and leaves every card in place.
      await db.asUser(alice.id, (sql) =>
        sql.query('update public.pipelines set is_active = false where id = $1', [customPipeline]),
      )
      const cards = await db.asUser(bob.id, (sql) =>
        sql.query('select id from public.pipeline_cards where pipeline_id = $1', [customPipeline]),
      )
      expect(cards.rows).toHaveLength(1)
    })

    it('refuses to delete or archive a stage that still holds work', async () => {
      const deleteStage = await expectRejected(
        db.asUser(alice.id, (sql) =>
          sql.query('delete from public.pipeline_stages where id = $1', [customStage]),
        ),
      )
      expect(deleteStage).toMatch(/still holds opportunities/i)

      const archiveStage = await expectRejected(
        db.asUser(alice.id, (sql) =>
          sql.query('update public.pipeline_stages set archived_at = now() where id = $1', [
            customStage,
          ]),
        ),
      )
      expect(archiveStage).toMatch(/still has open opportunities/i)
    })

    it('archives a stage cleanly once its open work is resolved, and deletes an emptied pipeline', async () => {
      await db.asUser(alice.id, (sql) =>
        sql.query(
          `update public.pipeline_cards set status = 'archived', closed_at = now()
            where pipeline_id = $1 and status = 'open'`,
          [customPipeline],
        ),
      )

      // No open cards left: archiving the stage now succeeds.
      const archived = await db.asUser(alice.id, (sql) =>
        sql.query(
          'update public.pipeline_stages set archived_at = now() where id = $1 returning id',
          [customStage],
        ),
      )
      expect(archived.rows).toHaveLength(1)

      // Deleting still refuses while archived cards remain…
      const stillGuarded = await expectRejected(
        db.asUser(alice.id, (sql) =>
          sql.query('delete from public.pipelines where id = $1', [customPipeline]),
        ),
      )
      expect(stillGuarded).toMatch(/still holds opportunities/i)

      // …and succeeds only once the pipeline is genuinely empty.
      await db.asPostgres((sql) =>
        sql.query('delete from public.pipeline_cards where pipeline_id = $1', [customPipeline]),
      )
      const deleted = await db.asUser(alice.id, (sql) =>
        sql.query('delete from public.pipelines where id = $1 returning id', [customPipeline]),
      )
      expect(deleted.rows).toHaveLength(1)
    })
  })

  describe('migration safety', () => {
    it('re-applying the pipeline migrations preserves existing opportunities', async () => {
      const survivor = await db.asUser(alice.id, (sql) =>
        sql.query<{ id: string; stage_id: string }>(
          `insert into public.pipeline_cards (pipeline_id, stage_id, contact_id, title, value_cents)
           select p.id, s.id, $1, 'Migration survivor', 990000
             from public.pipelines p
             join public.pipeline_stages s on s.pipeline_id = p.id
            where p.slug = 'relationship_development'
            order by s.position
            limit 1
           returning id, stage_id`,
          [personId],
        ),
      )
      const cardId = survivor.rows[0]!.id
      const stageId = survivor.rows[0]!.stage_id

      for (const marker of ['configurable_pipelines', 'sales_reference_data', 'shared_team_visibility']) {
        const file = migrationFiles().find((f) => f.includes(marker))!
        await db.asPostgres((sql) =>
          sql.exec(readFileSync(join(process.cwd(), 'supabase', 'migrations', file), 'utf8')),
        )
      }

      const after = await db.asUser(bob.id, (sql) =>
        sql.query<{ id: string; stage_id: string; value_cents: number; status: string }>(
          'select id, stage_id, value_cents::int as value_cents, status from public.pipeline_cards where id = $1',
          [cardId],
        ),
      )
      expect(after.rows[0]).toMatchObject({
        id: cardId,
        stage_id: stageId,
        value_cents: 990000,
        status: 'open',
      })
    })
  })
})
