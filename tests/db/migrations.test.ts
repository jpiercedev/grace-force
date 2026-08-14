import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDb, migrationFiles, type TestDb } from './helpers/db'

/**
 * Applies the full migration set to a real Postgres and asserts the resulting
 * schema is the one the application expects: every table protected by RLS,
 * every external-facing table carrying its idempotency key, and the sensitive
 * views running with the invoker's privileges rather than the owner's.
 */
describe('migrations', () => {
  let db: TestDb

  beforeAll(async () => {
    db = await createTestDb()
  }, 180_000)

  afterAll(async () => {
    await db?.close()
  })

  it('applies every migration file in order', async () => {
    const files = migrationFiles()
    expect(files.length).toBeGreaterThan(0)
    // Filenames must sort chronologically for a deterministic apply order.
    expect([...files].sort()).toEqual(files)
  })

  it('creates the expected tables', async () => {
    const { rows } = await db.asPostgres((sql) =>
      sql.query<{ table_name: string }>(
        `select table_name from information_schema.tables
          where table_schema = 'public' and table_type = 'BASE TABLE'
          order by table_name`,
      ),
    )
    const names = rows.map((r) => r.table_name)

    expect(names).toEqual(
      expect.arrayContaining([
        'activities',
        'contacts',
        'engagement_types',
        'engagements',
        'follow_ups',
        'gifts',
        'import_batches',
        'import_rows',
        'integration_sync_runs',
        'leads',
        'mailchimp_audiences',
        'mailchimp_campaign_activity',
        'mailchimp_campaigns',
        'mailchimp_members',
        'notifications',
        'pipeline_cards',
        'pipeline_stages',
        'pipelines',
        'profiles',
        'rate_limit_hits',
      ]),
    )
  })

  it('enables row level security on every public table', async () => {
    const { rows } = await db.asPostgres((sql) =>
      sql.query<{ tablename: string; rowsecurity: boolean }>(
        `select tablename, rowsecurity from pg_tables
          where schemaname = 'public' order by tablename`,
      ),
    )

    const unprotected = rows.filter((r) => !r.rowsecurity).map((r) => r.tablename)
    expect(unprotected).toEqual([])
  })

  it('gives every RLS-protected table at least one policy, except the deliberately sealed ones', async () => {
    const { rows } = await db.asPostgres((sql) =>
      sql.query<{ tablename: string; policy_count: number }>(
        `select t.tablename, count(p.policyname)::int as policy_count
           from pg_tables t
           left join pg_policies p
             on p.schemaname = t.schemaname and p.tablename = t.tablename
          where t.schemaname = 'public'
          group by t.tablename
          order by t.tablename`,
      ),
    )

    const sealed = rows.filter((r) => r.policy_count === 0).map((r) => r.tablename)
    // rate_limit_hits is service-role-only by design: RLS on, zero policies.
    expect(sealed).toEqual(['rate_limit_hits'])
  })

  it('runs sensitive views with security_invoker so RLS is not bypassed', async () => {
    const { rows } = await db.asPostgres((sql) =>
      sql.query<{ viewname: string; options: string[] | null }>(
        `select c.relname as viewname, c.reloptions as options
           from pg_class c
           join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relkind = 'v'
          order by c.relname`,
      ),
    )

    expect(rows.length).toBeGreaterThan(0)
    for (const view of rows) {
      expect(
        (view.options ?? []).some((o) => o.replace(/\s/g, '') === 'security_invoker=on'),
        `view ${view.viewname} must set security_invoker=on`,
      ).toBe(true)
    }
  })

  it('locks the search_path on every SECURITY DEFINER function', async () => {
    const { rows } = await db.asPostgres((sql) =>
      sql.query<{ proname: string; config: string[] | null }>(
        `select p.proname, p.proconfig as config
           from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and p.prosecdef
          order by p.proname`,
      ),
    )

    expect(rows.length).toBeGreaterThan(0)
    for (const fn of rows) {
      expect(
        (fn.config ?? []).some((c) => c.startsWith('search_path=')),
        `SECURITY DEFINER function ${fn.proname} must pin its search_path`,
      ).toBe(true)
    }
  })

  it('does not expose SECURITY DEFINER trigger functions as RPCs', async () => {
    const { rows } = await db.asPostgres((sql) =>
      sql.query<{
        proname: string
        anon_execute: boolean
        authenticated_execute: boolean
      }>(
        `select p.proname,
                has_function_privilege('anon', p.oid, 'execute') as anon_execute,
                has_function_privilege('authenticated', p.oid, 'execute') as authenticated_execute
           from pg_proc p
           join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public'
            and p.prosecdef
            and p.prorettype = 'pg_catalog.trigger'::regtype
          order by p.proname`,
      ),
    )

    expect(rows.length).toBeGreaterThan(0)
    for (const fn of rows) {
      expect(fn.anon_execute, `${fn.proname} is executable by anon`).toBe(false)
      expect(fn.authenticated_execute, `${fn.proname} is executable by authenticated`).toBe(false)
    }
  })

  it('gives anon no privilege on any current public relation or sequence', async () => {
    const relations = await db.asPostgres((sql) =>
      sql.query<{ relation: string; privilege: string }>(
        `select c.relname as relation, wanted.privilege
           from pg_class c
           join pg_namespace n on n.oid = c.relnamespace
          cross join (values
            ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'),
            ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')
          ) as wanted(privilege)
          where n.nspname = 'public'
            and c.relkind in ('r', 'p', 'v', 'm', 'f')
            and has_table_privilege('anon', c.oid, wanted.privilege)
          order by c.relname, wanted.privilege`,
      ),
    )
    const sequences = await db.asPostgres((sql) =>
      sql.query<{ sequence: string; privilege: string }>(
        `select c.relname as sequence, wanted.privilege
           from pg_class c
           join pg_namespace n on n.oid = c.relnamespace
          cross join (values ('USAGE'), ('SELECT'), ('UPDATE')) as wanted(privilege)
          where n.nspname = 'public'
            and c.relkind = 'S'
            and has_sequence_privilege('anon', c.oid, wanted.privilege)
          order by c.relname, wanted.privilege`,
      ),
    )

    expect(relations.rows).toEqual([])
    expect(sequences.rows).toEqual([])
  })

  it('locks future relations away from anon and future functions away from API roles', async () => {
    await db.asPostgres((sql) =>
      sql.exec(`
        create table public.default_privilege_table_probe (
          id bigint generated always as identity primary key
        );
        create function public.default_execute_probe()
        returns integer language sql as 'select 1';
      `),
    )

    const { rows } = await db.asPostgres((sql) =>
      sql.query<{
        anon_table: boolean
        authenticated_table: boolean
        anon_sequence: boolean
        authenticated_sequence: boolean
        anon_execute: boolean
        authenticated_execute: boolean
        service_execute: boolean
      }>(
        `select
           has_table_privilege('anon', 'public.default_privilege_table_probe', 'select')
             or has_table_privilege('anon', 'public.default_privilege_table_probe', 'insert')
             or has_table_privilege('anon', 'public.default_privilege_table_probe', 'update')
             or has_table_privilege('anon', 'public.default_privilege_table_probe', 'delete')
             or has_table_privilege('anon', 'public.default_privilege_table_probe', 'truncate')
             or has_table_privilege('anon', 'public.default_privilege_table_probe', 'references')
             or has_table_privilege('anon', 'public.default_privilege_table_probe', 'trigger')
             as anon_table,
           has_table_privilege('authenticated', 'public.default_privilege_table_probe', 'select')
             and has_table_privilege('authenticated', 'public.default_privilege_table_probe', 'insert')
             and has_table_privilege('authenticated', 'public.default_privilege_table_probe', 'update')
             and has_table_privilege('authenticated', 'public.default_privilege_table_probe', 'delete')
             as authenticated_table,
           has_sequence_privilege('anon', 'public.default_privilege_table_probe_id_seq', 'usage')
             or has_sequence_privilege('anon', 'public.default_privilege_table_probe_id_seq', 'select')
             or has_sequence_privilege('anon', 'public.default_privilege_table_probe_id_seq', 'update')
             as anon_sequence,
           has_sequence_privilege('authenticated', 'public.default_privilege_table_probe_id_seq', 'usage')
             and has_sequence_privilege('authenticated', 'public.default_privilege_table_probe_id_seq', 'select')
             as authenticated_sequence,
           has_function_privilege('anon', 'public.default_execute_probe()', 'execute') as anon_execute,
           has_function_privilege('authenticated', 'public.default_execute_probe()', 'execute') as authenticated_execute,
           has_function_privilege('service_role', 'public.default_execute_probe()', 'execute') as service_execute`,
      ),
    )

    expect(rows[0]).toEqual({
      anon_table: false,
      authenticated_table: true,
      anon_sequence: false,
      authenticated_sequence: true,
      anon_execute: false,
      authenticated_execute: false,
      service_execute: true,
    })
    await db.asPostgres((sql) =>
      sql.exec(`
        drop function public.default_execute_probe();
        drop table public.default_privilege_table_probe;
      `),
    )
  })

  it('carries a unique idempotency key on every externally-synced table', async () => {
    const expectations: Array<[string, string]> = [
      ['activities', 'activities_dedupe_key_uniq'],
      ['leads', 'leads_dedupe_key_uniq'],
      ['contacts', 'contacts_external_key'],
      ['engagements', 'engagements_external_key'],
      ['gifts', 'gifts_external_key'],
      ['mailchimp_campaign_activity', 'mailchimp_campaign_activity_dedupe_uniq'],
      ['mailchimp_members', 'mailchimp_members_audience_email_uniq'],
    ]

    const { rows } = await db.asPostgres((sql) =>
      sql.query<{ indexname: string; tablename: string; indexdef: string }>(
        `select indexname, tablename, indexdef from pg_indexes where schemaname = 'public'`,
      ),
    )

    for (const [table, index] of expectations) {
      const found = rows.find((r) => r.indexname === index)
      expect(found, `${table} is missing unique index ${index}`).toBeDefined()
      expect(found!.tablename).toBe(table)
      expect(found!.indexdef).toContain('UNIQUE')
    }
  })

  it('seeds the reference data the application relies on', async () => {
    const types = await db.asPostgres((sql) =>
      sql.query<{ slug: string }>('select slug from public.engagement_types order by sort_order'),
    )
    expect(types.rows.map((r) => r.slug)).toEqual(
      expect.arrayContaining(['donor', 'volunteer', 'newsletter']),
    )

    const pipelines = await db.asPostgres((sql) =>
      sql.query<{ slug: string; is_default: boolean }>(
        'select slug, is_default from public.pipelines',
      ),
    )
    expect(pipelines.rows.filter((p) => p.is_default)).toHaveLength(1)

    const stages = await db.asPostgres((sql) =>
      sql.query<{ count: number }>('select count(*)::int as count from public.pipeline_stages'),
    )
    expect(stages.rows[0]!.count).toBeGreaterThanOrEqual(15)
  })

  it('is idempotent — reference data re-applies without duplicating', async () => {
    const before = await db.asPostgres((sql) =>
      sql.query<{ count: number }>('select count(*)::int as count from public.engagement_types'),
    )

    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const file = migrationFiles().find((f) => f.includes('reference_data'))!
    await db.asPostgres((sql) =>
      sql.exec(readFileSync(join(process.cwd(), 'supabase', 'migrations', file), 'utf8')),
    )

    const after = await db.asPostgres((sql) =>
      sql.query<{ count: number }>('select count(*)::int as count from public.engagement_types'),
    )
    expect(after.rows[0]!.count).toBe(before.rows[0]!.count)
  })
})
