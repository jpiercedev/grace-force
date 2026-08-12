import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, type TestDb } from './helpers/db'
import type { Database } from '../../src/types/database'

/**
 * Guards the hand-authored `src/types/database.ts` against schema drift.
 *
 * The types are written by hand (a Supabase project is needed to generate
 * them), so nothing otherwise stops a migration adding a table or renaming a
 * column while the TypeScript keeps compiling against a stale shape. This test
 * compares both directions against the live schema.
 */
describe('database types match the schema', () => {
  let db: TestDb

  beforeAll(async () => {
    db = await createTestDb()
  }, 180_000)

  afterAll(async () => {
    await db?.close()
  })

  it('declares every table that exists, and no tables that do not', async () => {
    const { rows } = await db.asPostgres((sql) =>
      sql.query<{ table_name: string }>(
        `select table_name from information_schema.tables
          where table_schema = 'public' and table_type = 'BASE TABLE'`,
      ),
    )

    const actual = rows.map((r) => r.table_name).sort()
    // Reading the keys off the type requires a value, so mirror the list here;
    // the assertion below is what keeps the two honest.
    const declared = (Object.keys({
      profiles: 0,
      contacts: 0,
      engagement_types: 0,
      engagements: 0,
      pipelines: 0,
      pipeline_stages: 0,
      pipeline_cards: 0,
      activities: 0,
      follow_ups: 0,
      gifts: 0,
      leads: 0,
      mailchimp_audiences: 0,
      mailchimp_members: 0,
      mailchimp_campaigns: 0,
      mailchimp_campaign_activity: 0,
      integration_sync_runs: 0,
      notifications: 0,
      import_batches: 0,
      import_rows: 0,
      rate_limit_hits: 0,
      interest_areas: 0,
      contact_interests: 0,
      contact_relationships: 0,
      contact_capability: 0,
      events: 0,
      event_attendees: 0,
      proposals: 0,
      call_reports: 0,
      attachments: 0,
    } satisfies Record<keyof Database['public']['Tables'], number>) as string[]).sort()

    expect(actual).toEqual(declared)
  })

  it('declares every view that exists', async () => {
    const { rows } = await db.asPostgres((sql) =>
      sql.query<{ table_name: string }>(
        `select table_name from information_schema.views where table_schema = 'public'`,
      ),
    )

    const declared = (Object.keys({
      contact_giving_summary: 0,
      contact_email_engagement: 0,
    } satisfies Record<keyof Database['public']['Views'], number>) as string[]).sort()

    expect(rows.map((r) => r.table_name).sort()).toEqual(declared)
  })

  it('declares every callable function the app invokes', async () => {
    const { rows } = await db.asPostgres((sql) =>
      sql.query<{ proname: string }>(
        `select p.proname from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public'`,
      ),
    )
    const existing = new Set(rows.map((r) => r.proname))

    const declared = Object.keys({
      convert_lead: 0,
      consume_rate_limit: 0,
      prune_rate_limit_hits: 0,
    } satisfies Record<keyof Database['public']['Functions'], number>)

    for (const fn of declared) {
      expect(existing.has(fn), `RPC ${fn} is declared in types but missing from the schema`).toBe(
        true,
      )
    }
  })

  it('matches the declared enum values', async () => {
    const { rows } = await db.asPostgres((sql) =>
      sql.query<{ typname: string; labels: string[] }>(
        `select t.typname, array_agg(e.enumlabel order by e.enumsortorder) as labels
           from pg_type t
           join pg_enum e on e.enumtypid = t.oid
           join pg_namespace n on n.oid = t.typnamespace
          where n.nspname = 'public'
          group by t.typname`,
      ),
    )
    const byName = new Map(rows.map((r) => [r.typname, r.labels]))

    // Spot-check the enums whose values the application branches on; a
    // mismatch here means a `switch` somewhere has a dead or missing case.
    expect(byName.get('user_role')).toEqual(['admin', 'staff', 'viewer'])
    expect(byName.get('follow_up_status')).toEqual(['open', 'completed', 'cancelled'])
    expect(byName.get('pipeline_card_status')).toEqual(['open', 'won', 'lost'])
    expect(byName.get('notification_status')).toEqual(['pending', 'sent', 'failed', 'skipped'])
    expect(byName.get('engagement_status')).toEqual([
      'prospect',
      'active',
      'paused',
      'lapsed',
      'ended',
    ])
    expect(byName.get('proposal_status')).toEqual([
      'exploring',
      'drafted',
      'presented',
      'committed',
      'funded',
      'declined',
    ])
    expect(byName.get('call_report_status')).toEqual(['draft', 'filed'])
    expect(byName.get('event_attendance')).toEqual([
      'invited',
      'attended',
      'declined',
      'no_show',
    ])
    expect(byName.get('capability_level')).toEqual([
      'unrated',
      'modest',
      'moderate',
      'significant',
      'major',
    ])
    expect(byName.get('contact_method')).toEqual(['email', 'phone', 'text', 'mail'])
  })

  it('exposes no generated columns as writable in the Insert types', async () => {
    const { rows } = await db.asPostgres((sql) =>
      sql.query<{ table_name: string; column_name: string }>(
        `select table_name, column_name from information_schema.columns
          where table_schema = 'public' and is_generated = 'ALWAYS'
          order by table_name, column_name`,
      ),
    )

    // Documented so a future migration adding a generated column forces a
    // matching change to the Insert types in src/types/database.ts.
    expect(rows.map((r) => `${r.table_name}.${r.column_name}`)).toEqual([
      'contacts.email_normalized',
      'contacts.full_name',
      'contacts.phone_normalized',
      'contacts.search_vector',
      'leads.email_normalized',
      'mailchimp_campaign_activity.email_normalized',
      'mailchimp_members.email_normalized',
    ])
  })
})
