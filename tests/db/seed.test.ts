import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './helpers/db'

/**
 * The development seed is the first thing a new contributor sees, and the
 * fixture every local screen is exercised against. It has to apply cleanly to a
 * freshly migrated database, satisfy every constraint the schema enforces, and
 * survive being re-run — otherwise `supabase db reset` produces a subtly
 * different database each time.
 */
describe('development seed', () => {
  let db: TestDb
  const seedSql = readFileSync(join(process.cwd(), 'supabase', 'seed.sql'), 'utf8')

  beforeAll(async () => {
    db = await createTestDb()
    await db.asPostgres((sql) => sql.exec(seedSql))
  }, 180_000)

  afterAll(async () => {
    await db?.close()
  })

  async function count(table: string): Promise<number> {
    const { rows } = await db.asPostgres((sql) =>
      sql.query<{ count: number }>(`select count(*)::int as count from public.${table}`),
    )
    return rows[0]!.count
  }

  it('populates every area the interface renders', async () => {
    expect(await count('contacts')).toBeGreaterThanOrEqual(8)
    expect(await count('engagements')).toBeGreaterThanOrEqual(10)
    expect(await count('follow_ups')).toBeGreaterThanOrEqual(6)
    expect(await count('gifts')).toBeGreaterThanOrEqual(10)
    expect(await count('pipeline_cards')).toBeGreaterThanOrEqual(3)
    expect(await count('leads')).toBeGreaterThanOrEqual(3)
  })

  it('gives contacts several concurrent engagements, which is the point of the model', async () => {
    const { rows } = await db.asPostgres((sql) =>
      sql.query<{ full_name: string; engagement_count: number }>(
        `select c.full_name, count(e.id)::int as engagement_count
           from public.contacts c
           join public.engagements e on e.contact_id = c.id
          group by c.id, c.full_name
         having count(e.id) > 1
          order by c.full_name`,
      ),
    )
    expect(rows.length).toBeGreaterThanOrEqual(3)
  })

  it('produces a timeline that includes both logged and trigger-written entries', async () => {
    const { rows } = await db.asPostgres((sql) =>
      sql.query<{ type: string; count: number }>(
        `select type::text, count(*)::int as count from public.activities group by type`,
      ),
    )
    const byType = new Map(rows.map((r) => [r.type, r.count]))

    // Manually logged by the seed.
    expect(byType.get('call')).toBeGreaterThanOrEqual(1)
    expect(byType.get('meeting')).toBeGreaterThanOrEqual(1)
    // Written by triggers as a consequence of the seed's other inserts.
    expect(byType.get('engagement_started')).toBeGreaterThanOrEqual(10)
    expect(byType.get('gift_recorded')).toBeGreaterThanOrEqual(10)
    expect(byType.get('follow_up_created')).toBeGreaterThanOrEqual(6)
    expect(byType.get('pipeline_card_created')).toBeGreaterThanOrEqual(3)
  })

  it('spreads follow-ups across overdue, due and upcoming so every queue segment fills', async () => {
    const { rows } = await db.asPostgres((sql) =>
      sql.query<{ overdue: number; upcoming: number }>(
        `select
           count(*) filter (where due_at < now())::int as overdue,
           count(*) filter (where due_at >= now())::int as upcoming
         from public.follow_ups where status = 'open'`,
      ),
    )
    expect(rows[0]!.overdue).toBeGreaterThanOrEqual(2)
    expect(rows[0]!.upcoming).toBeGreaterThanOrEqual(2)
  })

  it('records money as integer cents that the giving summary can aggregate', async () => {
    const { rows } = await db.asPostgres((sql) =>
      sql.query<{ contact_id: string; total_cents: number; gift_count: number }>(
        `select contact_id, total_cents, gift_count from public.contact_giving_summary
          order by total_cents desc limit 1`,
      ),
    )
    expect(rows[0]!.total_cents).toBeGreaterThan(0)
    expect(Number.isInteger(rows[0]!.total_cents)).toBe(true)
  })

  it('contains no real-looking contact data', async () => {
    // A seed that ever picked up production data would be a serious problem;
    // pinning every address to example.org makes that visible immediately.
    const { rows } = await db.asPostgres((sql) =>
      sql.query<{ email: string }>(
        `select email from public.contacts where email is not null
          union all
         select email from public.leads where email is not null`,
      ),
    )
    expect(rows.length).toBeGreaterThan(0)
    for (const { email } of rows) {
      expect(email.endsWith('example.org')).toBe(true)
    }
  })

  it('is idempotent — re-running changes nothing', async () => {
    const before = {
      contacts: await count('contacts'),
      engagements: await count('engagements'),
      activities: await count('activities'),
      follow_ups: await count('follow_ups'),
      gifts: await count('gifts'),
      pipeline_cards: await count('pipeline_cards'),
      leads: await count('leads'),
    }

    await db.asPostgres((sql) => sql.exec(seedSql))

    expect({
      contacts: await count('contacts'),
      engagements: await count('engagements'),
      activities: await count('activities'),
      follow_ups: await count('follow_ups'),
      gifts: await count('gifts'),
      pipeline_cards: await count('pipeline_cards'),
      leads: await count('leads'),
    }).toEqual(before)
  })
})
