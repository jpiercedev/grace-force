import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm'

/**
 * The storage half of the attachments migration.
 *
 * `20260806000600_attachments.sql` creates the private `attachments` bucket
 * and three policies on `storage.objects`, all inside a guard that skips the
 * whole block when `storage.buckets` does not exist. That guard is what lets
 * the migration apply to a bare Postgres — and it is also why the rest of the
 * suite never executes a single line of it. A syntax error, a misspelled
 * helper, or a policy referencing a column that does not exist would ship
 * undetected and only surface against a real Supabase project.
 *
 * So this file stands up a minimal `storage` schema faithful to Supabase's
 * shape, applies every migration on top, and asserts the bucket and policies
 * were genuinely created — and that the policy predicates evaluate, which is
 * what catches a bad function reference.
 *
 * This is not a substitute for a real upload; it verifies the SQL, not the
 * bytes. See `docs/IMPLEMENTATION_STATUS.md` for the manual step that remains.
 */

const MIGRATIONS_DIR = join(process.cwd(), 'supabase', 'migrations')

/**
 * The parts of Supabase's `storage` schema this migration touches. Column
 * names and types mirror the platform so a policy that compiles here compiles
 * there.
 */
const STORAGE_SCHEMA = `
  create schema if not exists storage;

  create function storage.extension(object_name text)
  returns text language sql immutable as $fn$
    select case
      when strpos(object_name, '.') = 0 then ''
      else reverse(split_part(reverse(object_name), '.', 1))
    end;
  $fn$;

  create table storage.buckets (
    id                 text primary key,
    name               text not null unique,
    owner              uuid,
    public             boolean default false,
    file_size_limit    bigint,
    allowed_mime_types text[],
    created_at         timestamptz default now(),
    updated_at         timestamptz default now()
  );

  create table storage.objects (
    id               uuid primary key default gen_random_uuid(),
    bucket_id        text references storage.buckets (id),
    name             text,
    owner            uuid,
    owner_id         text,
    metadata         jsonb,
    path_tokens      text[],
    created_at       timestamptz default now(),
    updated_at       timestamptz default now(),
    last_accessed_at timestamptz default now()
  );

  alter table storage.objects enable row level security;
  grant usage on schema storage to anon, authenticated, service_role;
  -- anon holds table privileges on the platform too; RLS is what refuses it,
  -- and that is the thing worth testing.
  grant all on storage.objects to anon, authenticated, service_role;
  grant all on storage.buckets to anon, authenticated, service_role;
`

const SUPABASE_BOOTSTRAP = `
  create role anon nologin noinherit;
  create role authenticated nologin noinherit;
  create role service_role nologin noinherit bypassrls;

  create schema if not exists auth;

  create table auth.users (
    id                 uuid primary key default gen_random_uuid(),
    email              text unique,
    encrypted_password text,
    raw_user_meta_data jsonb not null default '{}'::jsonb,
    created_at         timestamptz not null default now()
  );

  create or replace function auth.jwt() returns jsonb language sql stable as $fn$
    select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb);
  $fn$;
  create or replace function auth.uid() returns uuid language sql stable as $fn$
    select nullif(auth.jwt() ->> 'sub', '')::uuid;
  $fn$;
  create or replace function auth.role() returns text language sql stable as $fn$
    select auth.jwt() ->> 'role';
  $fn$;

  grant usage on schema auth to anon, authenticated, service_role;
  grant select on auth.users to service_role;
`

describe('attachments storage bucket', () => {
  let db: PGlite
  let adminId: string
  let staffId: string
  let otherStaffId: string
  let viewerId: string

  beforeAll(async () => {
    db = await PGlite.create({ extensions: { pg_trgm } })
    await db.exec(SUPABASE_BOOTSTRAP)
    // Crucially, *before* the migrations — so the guard takes the live branch.
    await db.exec(STORAGE_SCHEMA)

    for (const file of readdirSync(MIGRATIONS_DIR).filter((n) => n.endsWith('.sql')).sort()) {
      try {
        await db.exec(readFileSync(join(MIGRATIONS_DIR, file), 'utf8'))
      } catch (error) {
        throw new Error(
          `Migration ${file} failed with a storage schema present: ` +
            String((error as { message?: unknown })?.message ?? error),
        )
      }
    }

    // The first profile is promoted to administrator by trigger, and a
    // protection trigger refuses demoting the last one — so create the admin
    // first and leave it alone.
    const admin = await db.query<{ id: string }>(
      `insert into auth.users (email) values ('storage-admin@graceforce.test') returning id`,
    )
    adminId = admin.rows[0]!.id

    const staff = await db.query<{ id: string }>(
      `insert into auth.users (email) values ('storage-staff@graceforce.test') returning id`,
    )
    staffId = staff.rows[0]!.id
    await db.query(`update public.profiles set role = 'staff' where id = $1`, [staffId])

    const otherStaff = await db.query<{ id: string }>(
      `insert into auth.users (email) values ('storage-other@graceforce.test') returning id`,
    )
    otherStaffId = otherStaff.rows[0]!.id
    await db.query(`update public.profiles set role = 'staff' where id = $1`, [otherStaffId])

    const viewer = await db.query<{ id: string }>(
      `insert into auth.users (email) values ('storage-viewer@graceforce.test') returning id`,
    )
    viewerId = viewer.rows[0]!.id
    await db.query(`update public.profiles set role = 'viewer' where id = $1`, [viewerId])
  }, 180_000)

  afterAll(async () => {
    await db?.close()
  })

  it('creates a private bucket with platform-enforced upload limits', async () => {
    const { rows } = await db.query<{
      id: string
      public: boolean
      file_size_limit: number
      allowed_mime_types: string[]
    }>(
      `select id, public, file_size_limit, allowed_mime_types
         from storage.buckets where id = 'attachments'`,
    )
    expect(rows).toHaveLength(1)
    // Public would make every estate document world-readable by URL.
    expect(rows[0]!.public).toBe(false)
    expect(Number(rows[0]!.file_size_limit)).toBe(20 * 1024 * 1024)
    expect(rows[0]!.allowed_mime_types).toEqual([
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/rtf',
      'text/plain',
      'text/markdown',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/csv',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/vnd.apple.pages',
      'application/vnd.apple.numbers',
      'application/vnd.apple.keynote',
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      'image/heic',
      'image/heif',
      'image/tiff',
      'image/bmp',
    ])
    expect(rows[0]!.allowed_mime_types).not.toContain('application/octet-stream')
  })

  it('creates exactly the three policies the table policies mirror', async () => {
    const { rows } = await db.query<{ policyname: string; cmd: string }>(
      `select policyname, cmd from pg_policies
        where schemaname = 'storage' and tablename = 'objects'
        order by policyname`,
    )
    expect(rows.map((r) => r.policyname)).toEqual([
      'attachments_read',
      'attachments_remove',
      'attachments_write',
    ])
    expect(rows.map((r) => r.cmd).sort()).toEqual(['DELETE', 'INSERT', 'SELECT'])
  })

  it('scopes every policy to the attachments bucket', async () => {
    // Without the bucket_id predicate these policies would govern every
    // bucket the project ever adds.
    const { rows } = await db.query<{ policyname: string; qual: string | null; withcheck: string | null }>(
      `select policyname, qual, with_check as withcheck from pg_policies
        where schemaname = 'storage' and tablename = 'objects'`,
    )
    for (const row of rows) {
      expect(`${row.qual ?? ''}${row.withcheck ?? ''}`, row.policyname).toContain('attachments')
    }
  })

  it('wires the policies to the same helpers the table policies use', async () => {
    const { rows } = await db.query<{ policyname: string; expression: string }>(
      `select policyname, coalesce(qual, '') || coalesce(with_check, '') as expression
         from pg_policies where schemaname = 'storage' and tablename = 'objects'`,
    )
    const byName = new Map(rows.map((r) => [r.policyname, r.expression]))
    expect(byName.get('attachments_read')).toContain('is_active_user')
    expect(byName.get('attachments_write')).toContain('can_write')
    expect(byName.get('attachments_remove')).toContain('can_write')
    expect(byName.get('attachments_write')).toContain('extension')
    expect(byName.get('attachments_write')).toContain('pdf')
    expect(byName.get('attachments_write')).toContain('owner_id')
    expect(byName.get('attachments_remove')).toContain('owner_id')
    expect(byName.get('attachments_remove')).toContain('is_admin')
  })

  /**
   * The policies are only as good as the functions they call. Evaluating the
   * predicates for real is what catches a helper that was renamed or a
   * `search_path` that stops resolving it.
   */
  it('lets staff write an object and refuses a viewer', async () => {
    const asStaff = await db.transaction(async (tx) => {
      await tx.exec(`set local role authenticated;`)
      await tx.query('select set_config($1, $2, true)', [
        'request.jwt.claims',
        JSON.stringify({ sub: staffId, role: 'authenticated' }),
      ])
      return tx.query(
        `insert into storage.objects (bucket_id, name, owner_id)
         values ('attachments', 'c/1.pdf', $1) returning id`,
        [staffId],
      )
    })
    expect(asStaff.rows).toHaveLength(1)

    await expect(
      db.transaction(async (tx) => {
        await tx.exec(`set local role authenticated;`)
        await tx.query('select set_config($1, $2, true)', [
          'request.jwt.claims',
          JSON.stringify({ sub: viewerId, role: 'authenticated' }),
        ])
        return tx.query(
          `insert into storage.objects (bucket_id, name) values ('attachments', 'c/2.pdf')`,
        )
      }),
    ).rejects.toThrow(/row-level security|violates/i)
  })

  it('refuses an object whose extension the application does not accept', async () => {
    await expect(
      db.transaction(async (tx) => {
        await tx.exec(`set local role authenticated;`)
        await tx.query('select set_config($1, $2, true)', [
          'request.jwt.claims',
          JSON.stringify({ sub: staffId, role: 'authenticated' }),
        ])
        return tx.query(
          `insert into storage.objects (bucket_id, name, owner_id)
           values ('attachments', 'c/archive.zip', $1)`,
          [staffId],
        )
      }),
    ).rejects.toThrow(/row-level security|violates/i)
  })

  it('refuses a caller who forges the Storage object owner', async () => {
    await expect(
      db.transaction(async (tx) => {
        await tx.exec(`set local role authenticated;`)
        await tx.query('select set_config($1, $2, true)', [
          'request.jwt.claims',
          JSON.stringify({ sub: staffId, role: 'authenticated' }),
        ])
        return tx.query(
          `insert into storage.objects (bucket_id, name, owner_id)
           values ('attachments', 'c/forged-owner.pdf', $1)`,
          [otherStaffId],
        )
      }),
    ).rejects.toThrow(/row-level security|violates/i)
  })

  it('lets only the object owner or an administrator delete bytes', async () => {
    await db.transaction(async (tx) => {
      await tx.exec(`set local role authenticated;`)
      await tx.query('select set_config($1, $2, true)', [
        'request.jwt.claims',
        JSON.stringify({ sub: staffId, role: 'authenticated' }),
      ])
      return tx.query(
        `insert into storage.objects (bucket_id, name, owner_id)
         values ('attachments', 'c/owned.pdf', $1),
                ('attachments', 'c/admin-cleanup.pdf', $1)`,
        [staffId],
      )
    })

    const byOtherStaff = await db.transaction(async (tx) => {
      await tx.exec(`set local role authenticated;`)
      await tx.query('select set_config($1, $2, true)', [
        'request.jwt.claims',
        JSON.stringify({ sub: otherStaffId, role: 'authenticated' }),
      ])
      return tx.query(
        `delete from storage.objects where name = 'c/owned.pdf' returning id`,
      )
    })
    expect(byOtherStaff.rows).toHaveLength(0)

    const byOwner = await db.transaction(async (tx) => {
      await tx.exec(`set local role authenticated;`)
      await tx.query('select set_config($1, $2, true)', [
        'request.jwt.claims',
        JSON.stringify({ sub: staffId, role: 'authenticated' }),
      ])
      return tx.query(
        `delete from storage.objects where name = 'c/owned.pdf' returning id`,
      )
    })
    expect(byOwner.rows).toHaveLength(1)

    const byAdmin = await db.transaction(async (tx) => {
      await tx.exec(`set local role authenticated;`)
      await tx.query('select set_config($1, $2, true)', [
        'request.jwt.claims',
        JSON.stringify({ sub: adminId, role: 'authenticated' }),
      ])
      return tx.query(
        `delete from storage.objects where name = 'c/admin-cleanup.pdf' returning id`,
      )
    })
    expect(byAdmin.rows).toHaveLength(1)
  })

  it('lets a viewer read an object, matching the attachments table policy', async () => {
    // Read-only staff can see the files on a donor record; the table policy
    // says so, and the bucket must agree or the list would render dead links.
    const { rows } = await db.transaction(async (tx) => {
      await tx.exec(`set local role authenticated;`)
      await tx.query('select set_config($1, $2, true)', [
        'request.jwt.claims',
        JSON.stringify({ sub: viewerId, role: 'authenticated' }),
      ])
      return tx.query(`select id from storage.objects where bucket_id = 'attachments'`)
    })
    expect(rows.length).toBeGreaterThan(0)
  })

  it('refuses an anonymous read outright', async () => {
    const { rows } = await db.transaction(async (tx) => {
      await tx.exec(`set local role anon;`)
      await tx.query('select set_config($1, $2, true)', [
        'request.jwt.claims',
        JSON.stringify({ role: 'anon' }),
      ])
      return tx.query(`select id from storage.objects where bucket_id = 'attachments'`)
    })
    expect(rows).toHaveLength(0)
  })

  /**
   * The storage block is the one part of the migration that touches a schema
   * shared with the platform, so it is written to survive being run against a
   * project that already has the bucket — unlike the `public` table policies,
   * which are created unguarded here exactly as they are in every other
   * migration in the tree, because Supabase never re-applies a migration.
   */
  it('re-runs safely against a project that already has the bucket', async () => {
    const migration = readdirSync(MIGRATIONS_DIR).find((n) => n.includes('attachments'))!
    const sql = readFileSync(join(MIGRATIONS_DIR, migration), 'utf8')
    const block = sql.slice(sql.indexOf('do $$'))
    expect(block, 'the storage guard should be the trailing DO block').toContain('storage.buckets')

    await db.exec(block)

    const buckets = await db.query<{ n: number }>(
      `select count(*)::int as n from storage.buckets where id = 'attachments'`,
    )
    const policies = await db.query<{ n: number }>(
      `select count(*)::int as n from pg_policies
        where schemaname = 'storage' and tablename = 'objects'`,
    )
    expect(Number(buckets.rows[0]!.n)).toBe(1)
    expect(Number(policies.rows[0]!.n)).toBe(3)
  })
})
