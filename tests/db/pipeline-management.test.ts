import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, expectRejected, type TestDb, type TestUser } from './helpers/db'

/**
 * Configurable pipelines.
 *
 * 20260814183153 turns pipelines from admin-only reference data into shared
 * working structure: any active staff member may create, rename, reorder,
 * archive and (when empty) delete pipelines and stages. What makes that safe
 * to hand out is enforced by the database, not the application — deletion and
 * archive guards run as triggers, so no buggy form or raw PostgREST call can
 * cascade an opportunity away or strand one in a retired stage.
 */
describe('configurable pipelines', () => {
  const MIGRATIONS = join(process.cwd(), 'supabase', 'migrations')
  const salesReferenceSql = readFileSync(
    join(MIGRATIONS, '20260814183201_sales_reference_data.sql'),
    'utf8',
  )
  const configurablePipelinesSql = readFileSync(
    join(MIGRATIONS, '20260814183153_configurable_pipelines.sql'),
    'utf8',
  )

  let db: TestDb
  let admin: TestUser
  let staff: TestUser
  let viewer: TestUser

  beforeAll(async () => {
    db = await createTestDb()
    // The provisioning trigger promotes the first profile to admin; the
    // interesting actor here is ordinary staff, who could not touch pipelines
    // before this release.
    admin = await db.createUser({ email: 'pm-admin@graceforce.test' })
    staff = await db.createUser({ email: 'pm-staff@graceforce.test', role: 'staff' })
    viewer = await db.createUser({ email: 'pm-viewer@graceforce.test', role: 'viewer' })
    expect(admin.role).toBe('admin')
  }, 180_000)

  afterAll(async () => {
    await db?.close()
  })

  // Every open opportunity needs its own contact — one open card per contact
  // per pipeline is a schema invariant, not a test convenience.
  let fixtureSeq = 0
  async function newPerson(): Promise<string> {
    fixtureSeq += 1
    const { rows } = await db.asUser(staff.id, (sql) =>
      sql.query<{ id: string }>(
        `insert into public.contacts (first_name, last_name, created_by)
         values ($1, 'Fixture', $2) returning id`,
        [`Person${fixtureSeq}`, staff.id],
      ),
    )
    return rows[0]!.id
  }

  async function newPipeline(slug: string, name: string): Promise<string> {
    const { rows } = await db.asUser(staff.id, (sql) =>
      sql.query<{ id: string }>(
        `insert into public.pipelines (slug, name) values ($1, $2) returning id`,
        [slug, name],
      ),
    )
    return rows[0]!.id
  }

  async function newStage(pipelineId: string, slug: string, position: number): Promise<string> {
    const { rows } = await db.asUser(staff.id, (sql) =>
      sql.query<{ id: string }>(
        `insert into public.pipeline_stages (pipeline_id, slug, name, position)
         values ($1, $2, initcap(replace($2, '_', ' ')), $3) returning id`,
        [pipelineId, slug, position],
      ),
    )
    return rows[0]!.id
  }

  async function openOpportunity(
    pipelineId: string,
    stageId: string,
    title = 'An opportunity',
  ): Promise<string> {
    const contactId = await newPerson()
    const { rows } = await db.asUser(staff.id, (sql) =>
      sql.query<{ id: string }>(
        `insert into public.pipeline_cards (pipeline_id, stage_id, contact_id, title, created_by)
         values ($1, $2, $3, $4, $5) returning id`,
        [pipelineId, stageId, contactId, title, staff.id],
      ),
    )
    return rows[0]!.id
  }

  // --- Staff shape the board --------------------------------------------------

  describe('staff shape the board', () => {
    let renewalsId: string
    let firstStageId: string
    let secondStageId: string

    beforeAll(async () => {
      renewalsId = await newPipeline('renewals', 'Renewals')
      firstStageId = await newStage(renewalsId, 'first_contact', 10)
      secondStageId = await newStage(renewalsId, 'second_meeting', 20)
    })

    it('staff can create a pipeline and its stages', async () => {
      const { rows } = await db.asUser(staff.id, (sql) =>
        sql.query<{ name: string }>(
          `select s.name from public.pipeline_stages s
            where s.pipeline_id = $1 order by s.position`,
          [renewalsId],
        ),
      )
      expect(rows.map((r) => r.name)).toEqual(['First Contact', 'Second Meeting'])
    })

    it('staff can rename a pipeline and a stage', async () => {
      const pipeline = await db.asUser(staff.id, (sql) =>
        sql.query<{ id: string }>(
          `update public.pipelines set name = 'Membership Renewals' where id = $1 returning id`,
          [renewalsId],
        ),
      )
      expect(pipeline.rows).toHaveLength(1)

      const stage = await db.asUser(staff.id, (sql) =>
        sql.query<{ id: string }>(
          `update public.pipeline_stages set name = 'Reached Out' where id = $1 returning id`,
          [firstStageId],
        ),
      )
      expect(stage.rows).toHaveLength(1)
    })

    it('staff can reorder stages', async () => {
      await db.asUser(staff.id, (sql) =>
        sql.query(`update public.pipeline_stages set position = 30 where id = $1`, [firstStageId]),
      )
      const { rows } = await db.asUser(staff.id, (sql) =>
        sql.query<{ slug: string }>(
          `select slug from public.pipeline_stages where pipeline_id = $1 order by position`,
          [renewalsId],
        ),
      )
      expect(rows.map((r) => r.slug)).toEqual(['second_meeting', 'first_contact'])
    })

    it('staff can archive a stage nobody is working in', async () => {
      const { rows } = await db.asUser(staff.id, (sql) =>
        sql.query<{ archived_at: string | null }>(
          `update public.pipeline_stages set archived_at = now()
            where id = $1 returning archived_at`,
          [secondStageId],
        ),
      )
      expect(rows).toHaveLength(1)
      expect(rows[0]!.archived_at).not.toBeNull()
    })

    it('staff can retire a whole pipeline from the board', async () => {
      // Archiving a pipeline is just is_active = false — history stays put.
      const { rows } = await db.asUser(staff.id, (sql) =>
        sql.query<{ id: string }>(
          `update public.pipelines set is_active = false where id = $1 returning id`,
          [renewalsId],
        ),
      )
      expect(rows).toHaveLength(1)
    })

    it('staff can delete a pipeline that was never used', async () => {
      const mistakeId = await newPipeline('created_by_mistake', 'Created By Mistake')
      const { rows } = await db.asUser(staff.id, (sql) =>
        sql.query('delete from public.pipelines where id = $1 returning id', [mistakeId]),
      )
      expect(rows).toHaveLength(1)
    })

    it('a viewer can do none of that', async () => {
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
              `insert into public.pipeline_stages (pipeline_id, slug, name, position)
               values ($1, 'sneaky', 'Sneaky', 99)`,
              [renewalsId],
            ),
          ),
        ),
      ).toMatch(/row-level security/i)

      // No row passes the USING clause, so every viewer update and delete is
      // a no-op rather than an error — the same shape rls.test.ts asserts.
      const renamed = await db.asUser(viewer.id, (sql) =>
        sql.query(`update public.pipelines set name = 'Hijacked' where id = $1 returning id`, [
          renewalsId,
        ]),
      )
      expect(renamed.rows).toEqual([])

      const reordered = await db.asUser(viewer.id, (sql) =>
        sql.query(
          `update public.pipeline_stages set position = 1 where id = $1 returning id`,
          [firstStageId],
        ),
      )
      expect(reordered.rows).toEqual([])

      const archived = await db.asUser(viewer.id, (sql) =>
        sql.query(
          `update public.pipeline_stages set archived_at = now() where id = $1 returning id`,
          [firstStageId],
        ),
      )
      expect(archived.rows).toEqual([])

      const deleted = await db.asUser(viewer.id, (sql) =>
        sql.query('delete from public.pipelines where id = $1 returning id', [renewalsId]),
      )
      expect(deleted.rows).toEqual([])
    })
  })

  // --- Deletion guards ---------------------------------------------------------

  describe('deletion is guarded by the database, not the application', () => {
    let pipelineId: string
    let stageId: string

    beforeAll(async () => {
      pipelineId = await newPipeline('guarded_delete', 'Guarded Delete')
      stageId = await newStage(pipelineId, 'only_stage', 10)
      // Closed, not open: the guard protects history, not just live work.
      const cardId = await openOpportunity(pipelineId, stageId, 'Closed but precious')
      await db.asUser(staff.id, (sql) =>
        sql.query(
          `update public.pipeline_cards set status = 'won', closed_at = now() where id = $1`,
          [cardId],
        ),
      )
    })

    it('a pipeline holding an opportunity refuses deletion, even a closed one', async () => {
      // The FK is ON DELETE CASCADE, so without the trigger this delete would
      // silently take the opportunity and its history with it.
      const message = await expectRejected(
        db.asUser(staff.id, (sql) =>
          sql.query('delete from public.pipelines where id = $1', [pipelineId]),
        ),
      )
      expect(message).toMatch(/still holds opportunities/)
    })

    it('a stage holding an opportunity refuses deletion the same way', async () => {
      const message = await expectRejected(
        db.asUser(staff.id, (sql) =>
          sql.query('delete from public.pipeline_stages where id = $1', [stageId]),
        ),
      )
      expect(message).toMatch(/still holds opportunities/)
    })
  })

  // --- Archive guards ----------------------------------------------------------

  describe('stage archiving is guarded both ways', () => {
    let pipelineId: string
    let workingStageId: string
    let liveStageId: string
    let cardId: string

    beforeAll(async () => {
      pipelineId = await newPipeline('guarded_archive', 'Guarded Archive')
      workingStageId = await newStage(pipelineId, 'working', 10)
      liveStageId = await newStage(pipelineId, 'still_live', 20)
      cardId = await openOpportunity(pipelineId, workingStageId, 'In flight')
    })

    it('a stage with open opportunities cannot be archived', async () => {
      const message = await expectRejected(
        db.asUser(staff.id, (sql) =>
          sql.query(`update public.pipeline_stages set archived_at = now() where id = $1`, [
            workingStageId,
          ]),
        ),
      )
      expect(message).toMatch(/still has open opportunities/)
    })

    it('archiving succeeds once the work there is closed', async () => {
      await db.asUser(staff.id, (sql) =>
        sql.query(
          `update public.pipeline_cards set status = 'won', closed_at = now() where id = $1`,
          [cardId],
        ),
      )
      const { rows } = await db.asUser(staff.id, (sql) =>
        sql.query<{ archived_at: string | null }>(
          `update public.pipeline_stages set archived_at = now()
            where id = $1 returning archived_at`,
          [workingStageId],
        ),
      )
      expect(rows).toHaveLength(1)
      expect(rows[0]!.archived_at).not.toBeNull()
    })

    it('an open opportunity cannot be created in an archived stage', async () => {
      const contactId = await newPerson()
      const message = await expectRejected(
        db.asUser(staff.id, (sql) =>
          sql.query(
            `insert into public.pipeline_cards (pipeline_id, stage_id, contact_id, title)
             values ($1, $2, $3, 'Stranded on arrival')`,
            [pipelineId, workingStageId, contactId],
          ),
        ),
      )
      expect(message).toMatch(/has been archived/)
    })

    it('an open opportunity cannot be moved into an archived stage', async () => {
      // The stale-board-form case: the column vanished from the UI, but a
      // queued drag (or a raw PostgREST write) still names its stage id.
      const liveCardId = await openOpportunity(pipelineId, liveStageId, 'Still moving')
      const message = await expectRejected(
        db.asUser(staff.id, (sql) =>
          sql.query(`update public.pipeline_cards set stage_id = $2 where id = $1`, [
            liveCardId,
            workingStageId,
          ]),
        ),
      )
      expect(message).toMatch(/has been archived/)
    })
  })

  // --- The archived status -----------------------------------------------------

  describe("the 'archived' status closes an opportunity", () => {
    let cardId: string

    beforeAll(async () => {
      const pipelineId = await newPipeline('status_check', 'Status Check')
      const stageId = await newStage(pipelineId, 'open_stage', 10)
      cardId = await openOpportunity(pipelineId, stageId, 'Going quiet')
    })

    it('refuses archived without a close time — archived is a closed state', async () => {
      const message = await expectRejected(
        db.asUser(staff.id, (sql) =>
          sql.query(`update public.pipeline_cards set status = 'archived' where id = $1`, [cardId]),
        ),
      )
      expect(message).toMatch(/pipeline_cards_closed_consistency/)
    })

    it('accepts archived with a close time, like won and lost', async () => {
      const { rows } = await db.asUser(staff.id, (sql) =>
        sql.query<{ status: string }>(
          `update public.pipeline_cards set status = 'archived', closed_at = now()
            where id = $1 returning status`,
          [cardId],
        ),
      )
      expect(rows).toHaveLength(1)
      expect(rows[0]!.status).toBe('archived')
    })
  })

  // --- The sales reference seed ------------------------------------------------

  describe('the sales reference seed', () => {
    async function inventory() {
      return db.asPostgres(async (sql) => {
        const pipelines = await sql.query<{ count: number }>(
          'select count(*)::int as count from public.pipelines',
        )
        const stages = await sql.query<{ slug: string; count: number }>(
          `select p.slug, count(s.id)::int as count
             from public.pipelines p
             left join public.pipeline_stages s on s.pipeline_id = p.id
            group by p.slug order by p.slug`,
        )
        return { pipelines: pipelines.rows[0]!.count, stagesByPipeline: stages.rows }
      })
    }

    it('ships General Sales and Relationship Development with their stages', async () => {
      const { rows } = await db.asUser(staff.id, (sql) =>
        sql.query<{ slug: string; count: number }>(
          `select p.slug, count(s.id)::int as count
             from public.pipelines p
             join public.pipeline_stages s on s.pipeline_id = p.id
            where p.slug in ('general_sales', 'relationship_development')
            group by p.slug order by p.slug`,
        ),
      )
      expect(rows).toEqual([
        { slug: 'general_sales', count: 6 },
        { slug: 'relationship_development', count: 5 },
      ])
    })

    it('re-running the seed changes nothing and preserves an operator rename', async () => {
      // Templates, not fixtures: an operator's rename must survive the next
      // deploy re-applying the seed migration.
      const renamed = await db.asUser(staff.id, (sql) =>
        sql.query<{ id: string }>(
          `update public.pipelines set name = 'Business Development'
            where slug = 'general_sales' returning id`,
        ),
      )
      expect(renamed.rows).toHaveLength(1)

      const before = await inventory()
      await db.asPostgres((sql) => sql.exec(salesReferenceSql))
      expect(await inventory()).toEqual(before)

      const { rows } = await db.asPostgres((sql) =>
        sql.query<{ name: string }>(
          `select name from public.pipelines where slug = 'general_sales'`,
        ),
      )
      expect(rows[0]!.name).toBe('Business Development')
    })

    it('existing opportunities survive a redeploy of both migrations', async () => {
      const stage = await db.asPostgres((sql) =>
        sql.query<{ id: string; pipeline_id: string }>(
          `select s.id, s.pipeline_id from public.pipeline_stages s
             join public.pipelines p on p.id = s.pipeline_id
            where p.slug = 'general_sales' and s.slug = 'new'`,
        ),
      )
      const cardId = await openOpportunity(
        stage.rows[0]!.pipeline_id,
        stage.rows[0]!.id,
        'Live deal mid-deploy',
      )

      // Both files are idempotent by construction; re-running them is exactly
      // what a redeploy does.
      await db.asPostgres((sql) => sql.exec(salesReferenceSql))
      await db.asPostgres((sql) => sql.exec(configurablePipelinesSql))

      const { rows } = await db.asUser(staff.id, (sql) =>
        sql.query<{ stage_id: string; status: string; title: string }>(
          'select stage_id, status, title from public.pipeline_cards where id = $1',
          [cardId],
        ),
      )
      expect(rows).toHaveLength(1)
      expect(rows[0]!.stage_id).toBe(stage.rows[0]!.id)
      expect(rows[0]!.status).toBe('open')
      expect(rows[0]!.title).toBe('Live deal mid-deploy')
    })
  })
})
