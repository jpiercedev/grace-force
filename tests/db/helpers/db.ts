import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { PGlite } from '@electric-sql/pglite'
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm'

/**
 * Boots a real Postgres (PGlite = Postgres compiled to WASM), reproduces the
 * pieces of a Supabase project that the schema depends on, and applies every
 * migration in `supabase/migrations` in order.
 *
 * This is what lets the RLS suite be a genuine verification rather than an
 * assertion: policies are evaluated by Postgres itself, with the request
 * running under the same `authenticated` / `anon` / `service_role` roles and
 * the same `auth.uid()` contract the hosted platform provides.
 */

const MIGRATIONS_DIR = join(process.cwd(), 'supabase', 'migrations')

/**
 * The subset of the Supabase platform the schema leans on. Kept deliberately
 * small and faithful: roles with the same names and BYPASSRLS setting, an
 * `auth.users` table for the profile-provisioning trigger to hang off, and
 * `auth.uid()` / `auth.jwt()` / `auth.role()` reading the same request GUCs
 * PostgREST sets.
 */
const SUPABASE_BOOTSTRAP = `
  create role anon nologin noinherit;
  create role authenticated nologin noinherit;
  -- Mirrors the hosted platform: service_role sees through RLS.
  create role service_role nologin noinherit bypassrls;

  create schema if not exists auth;

  create table auth.users (
    id                  uuid primary key default gen_random_uuid(),
    email               text unique,
    encrypted_password  text,
    raw_user_meta_data  jsonb not null default '{}'::jsonb,
    -- Nullable, as on the hosted platform: the forced-rotation trigger has to
    -- cope with a row that has never carried app metadata.
    raw_app_meta_data   jsonb,
    updated_at          timestamptz,
    created_at          timestamptz not null default now()
  );

  create or replace function auth.jwt() returns jsonb
    language sql stable as $fn$
    select coalesce(
      nullif(current_setting('request.jwt.claims', true), '')::jsonb,
      '{}'::jsonb
    );
  $fn$;

  create or replace function auth.uid() returns uuid
    language sql stable as $fn$
    select nullif(auth.jwt() ->> 'sub', '')::uuid;
  $fn$;

  create or replace function auth.role() returns text
    language sql stable as $fn$
    select auth.jwt() ->> 'role';
  $fn$;

  grant usage on schema auth to anon, authenticated, service_role;
  grant select on auth.users to service_role;
`

export type Sql = Pick<PGlite, 'query' | 'exec'>

export interface TestDb {
  raw: PGlite
  /** Run as the migration/superuser role — bypasses every policy. */
  asPostgres<T>(fn: (sql: Sql) => Promise<T>): Promise<T>
  /** Run inside a request context for a signed-in user. */
  asUser<T>(userId: string, fn: (sql: Sql) => Promise<T>): Promise<T>
  /** Run as the unauthenticated public role. */
  asAnon<T>(fn: (sql: Sql) => Promise<T>): Promise<T>
  /** Run as the trusted server-side role used by sync jobs and lead intake. */
  asServiceRole<T>(fn: (sql: Sql) => Promise<T>): Promise<T>
  /** Creates an auth user, letting the provisioning trigger make the profile. */
  createUser(options?: CreateUserOptions): Promise<TestUser>
  close(): Promise<void>
}

export interface CreateUserOptions {
  email?: string
  fullName?: string
  /** Applied after the trigger runs, as the superuser. */
  role?: 'admin' | 'staff' | 'viewer'
  canViewGiving?: boolean
  isActive?: boolean
}

export interface TestUser {
  id: string
  email: string
  role: 'admin' | 'staff' | 'viewer'
}

export function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith('.sql'))
    .sort()
}

let userCounter = 0

export async function createTestDb(): Promise<TestDb> {
  const raw = await PGlite.create({ extensions: { pg_trgm } })

  await raw.exec(SUPABASE_BOOTSTRAP)

  for (const file of migrationFiles()) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8')
    try {
      await raw.exec(sql)
    } catch (error) {
      throw new Error(`Migration ${file} failed: ${describe(error)}`)
    }
  }

  /**
   * Every "as <role>" helper runs inside a transaction so that `set local`
   * scopes the role and JWT claims to just that unit of work — the same
   * isolation PostgREST gives a single HTTP request. The transaction commits
   * when the callback resolves, so data written by one helper is visible to
   * the next.
   */
  async function withRole<T>(
    role: string | null,
    claims: Record<string, unknown> | null,
    fn: (sql: Sql) => Promise<T>,
  ): Promise<T> {
    return raw.transaction(async (tx) => {
      if (role) {
        await tx.exec(`set local role ${role};`)
      }
      if (claims) {
        await tx.query('select set_config($1, $2, true)', [
          'request.jwt.claims',
          JSON.stringify(claims),
        ])
      }
      return fn(tx as unknown as Sql)
    }) as Promise<T>
  }

  const db: TestDb = {
    raw,
    asPostgres: (fn) => withRole(null, null, fn),
    asUser: (userId, fn) =>
      withRole('authenticated', { sub: userId, role: 'authenticated' }, fn),
    asAnon: (fn) => withRole('anon', { role: 'anon' }, fn),
    asServiceRole: (fn) => withRole('service_role', { role: 'service_role' }, fn),

    async createUser(options: CreateUserOptions = {}): Promise<TestUser> {
      userCounter += 1
      const email = options.email ?? `user${userCounter}@gracelead.test`
      const fullName = options.fullName ?? `Test User ${userCounter}`

      const inserted = await raw.query<{ id: string }>(
        `insert into auth.users (email, raw_user_meta_data)
         values ($1, jsonb_build_object('full_name', $2::text))
         returning id`,
        [email, fullName],
      )
      const id = inserted.rows[0]!.id

      // The trigger promotes the first ever profile to admin; tests that need
      // a specific role state it explicitly.
      if (
        options.role !== undefined ||
        options.canViewGiving !== undefined ||
        options.isActive !== undefined
      ) {
        await raw.query(
          `update public.profiles
              set role = coalesce($2::public.user_role, role),
                  can_view_giving = coalesce($3::boolean, can_view_giving),
                  is_active = coalesce($4::boolean, is_active)
            where id = $1`,
          [
            id,
            options.role ?? null,
            options.canViewGiving ?? null,
            options.isActive ?? null,
          ],
        )
      }

      const profile = await raw.query<{ role: TestUser['role'] }>(
        'select role from public.profiles where id = $1',
        [id],
      )

      return { id, email, role: profile.rows[0]!.role }
    },

    async close() {
      await raw.close()
    },
  }

  return db
}

/** PGlite errors carry the useful text on `message`; everything else is noise. */
export function describe(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message: unknown }).message)
  }
  return String(error)
}

/**
 * Asserts that a statement is rejected, and returns the error text.
 * Used by the RLS suite, where "the query returned nothing" and "the query was
 * refused" are meaningfully different outcomes.
 */
export async function expectRejected(promise: Promise<unknown>): Promise<string> {
  try {
    await promise
  } catch (error) {
    return describe(error)
  }
  throw new Error('Expected the statement to be rejected, but it succeeded')
}

/** A deterministic email for fixtures. */
export function fixtureEmail(local: string): string {
  return `${local}@gracelead.test`
}
