# Setup

## 1. Prerequisites

- Node.js 20.11 or newer
- A Supabase project (free tier is enough to start)

## 2. Install

```bash
npm install
cp .env.example .env.local
```

## 3. Create the Supabase project

1. Create a project at <https://supabase.com/dashboard>.
2. Go to **Project Settings → API** and copy into `.env.local`:
   - Project URL → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon` / publishable key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` key → `SUPABASE_SERVICE_ROLE_KEY`

The service-role key bypasses Row Level Security. Keep it server-side, never
prefix it with `NEXT_PUBLIC_`, and rotate it if it is ever exposed.

## 4. Apply the migrations

The schema lives in `supabase/migrations/`, applied in **filename order**.

### With the Supabase CLI (recommended)

```bash
npm i -g supabase
supabase link --project-ref <your-project-ref>
supabase db push
```

### Without the CLI

Open the SQL editor in the Supabase dashboard and run each file in
`supabase/migrations/` in ascending filename order. They are ordered by
timestamp prefix and must not be reordered — later files reference earlier
tables.

Every migration is written to be re-runnable: `create ... if not exists`,
`on conflict do nothing` on reference data, and guarded enum creation.

### Verify

```sql
-- Every table should report rowsecurity = true.
select tablename, rowsecurity from pg_tables where schemaname = 'public' order by tablename;

-- Reference data should be present.
select slug from public.engagement_types order by sort_order;
select slug, is_default from public.pipelines;
```

You can also run the local suite, which applies the same migrations to an
in-process Postgres and checks the security model:

```bash
npm run test:db
```

### Seed data

`supabase/seed.sql` fills a development database with fictional contacts,
overlapping engagements, a populated timeline, overdue and upcoming follow-ups,
giving history, pipeline cards and untriaged leads — enough to exercise every
screen.

```bash
supabase db reset                      # migrations, then the seed
psql "$DATABASE_URL" -f supabase/seed.sql
```

It is safe to run repeatedly: every insert is keyed, so a second run changes
nothing. It attaches ownership to the oldest existing profile when one exists
and leaves it unassigned otherwise — it does not create auth users, since those
belong to the auth system rather than to application data.

Every address in it ends in `example.org`, and a test asserts that, so real
contact or donor data cannot quietly end up in the repository.

## 5. Configure authentication

In **Authentication → Providers**, keep **Email** enabled.

- For a small internal team, turn **Confirm email** on. The app handles both
  cases: with confirmation on, sign-up lands on `/check-email`; with it off, the
  user is signed straight in.
- Under **Authentication → URL Configuration**, add your site URL and
  `<site-url>/auth/callback` to the redirect allow-list.

Optionally restrict sign-up to your domain, or disable public sign-up entirely
once the team is onboarded — profiles are created by a database trigger on
`auth.users`, so users invited from the dashboard get a profile automatically.

## 6. First run

```bash
npm run dev
```

Visit <http://localhost:3000>, create an account. **The first account becomes
the administrator** (and is granted giving access); subsequent accounts start as
staff, and an admin adjusts them at `/settings/team`.

## 7. Optional integrations

Neither is required to run the app. When a key is absent the relevant screen
explains what is missing and the sync/send paths return a clear "not configured"
result instead of failing. See [`INTEGRATIONS.md`](INTEGRATIONS.md).

## 8. Deploying

The app is a standard Next.js deployment; Vercel is the path of least
resistance.

1. Import the repository.
2. Set every variable from `.env.example` in the project's environment settings.
   `NEXT_PUBLIC_*` values are inlined at build time, so changing one requires a
   redeploy, not just a restart.
3. Set `NEXT_PUBLIC_SITE_URL` to the production origin so auth callbacks and
   notification links resolve correctly.
4. Add the production URL to Supabase's redirect allow-list.

### Scheduled jobs

Two endpoints are meant to run on a schedule and are protected by
`CRON_SECRET` (sent as `Authorization: Bearer <secret>`):

| Endpoint | Suggested schedule | Purpose |
| --- | --- | --- |
| `/api/cron/mailchimp?job=all` | hourly | Sync audiences, members, campaigns, engagement |
| `/api/cron/follow-up-reminders` | every 15 minutes | Send due follow-up reminders |

On Vercel, add them to `vercel.json` `crons` and set `CRON_SECRET` in the
environment.

## Developing without a hosted project

The application does not require a hosted Supabase project to be built or
tested. The schema, its security model and the pure application logic are all
verified locally:

| What | How | Command |
| --- | --- | --- |
| Migrations apply cleanly | Postgres in-process (PGlite) | `npm run test:db` |
| RLS actually enforces | executed as the real `anon` / `authenticated` / `service_role` roles | `npm run test:db` |
| Triggers, constraints, idempotency | behavioural suite against the same database | `npm run test:db` |
| Seed applies and re-applies | seed suite | `npm run test:db` |
| Sync, notification, CSV logic | injected fakes, no network | `npm run test:unit` |
| Route protection, forms, layout | Chromium, no backend required | `npm run e2e:public` |

What genuinely needs a hosted project is a short list: signing in for real,
and the authenticated browser suite that depends on it.

### The provisioned project

A hosted project already exists for this application:

| Field | Value |
| --- | --- |
| Project ref | `phhkhvewcclzjkdbjmqw` |
| Region | `us-east-2` |
| API URL | `https://phhkhvewcclzjkdbjmqw.supabase.co` |

All migrations in `supabase/migrations` have been applied to it. To point a
local checkout at it, set `NEXT_PUBLIC_SUPABASE_URL` and
`NEXT_PUBLIC_SUPABASE_ANON_KEY` (the publishable key from Project Settings →
API), plus `SUPABASE_SERVICE_ROLE_KEY` if you need lead intake or the sync jobs.

**A verification account exists** — `e2e.admin@graceforce.test`, created
directly in `auth.users` with a confirmed email so the `@authed` suite has
something to sign in as. It was made this way rather than by disabling email
confirmation project-wide, which would have weakened the real auth settings.

> Delete that account, or rotate its password, before the project holds real
> data. Its password was set during automated verification and should not be
> treated as secret.

```sql
delete from auth.users where email = 'e2e.admin@graceforce.test';
```

### When a hosted project is provided

1. Apply the migrations (`supabase db push`, or paste them in filename order).
2. Set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and
   `SUPABASE_SERVICE_ROLE_KEY`, then rebuild — `NEXT_PUBLIC_*` values are
   inlined at build time, including into the middleware bundle.
3. Add the site URL and `<site-url>/auth/callback` to the redirect allow-list.
4. Sign up; confirm the first account is promoted to administrator.
5. Create a staff user, set `E2E_EMAIL` / `E2E_PASSWORD`, and run
   `npm run e2e -- --grep @authed`.
6. Check **Advisors** in the dashboard for security and performance findings.
7. Optionally run the seed against a development project — never production.

## Network requirements

The application talks to `https://<project-ref>.supabase.co` over HTTPS. A
sandbox or CI environment with an egress allow-list must permit that host, or
every request fails at the transport layer and the symptom looks like broken
authentication rather than blocked networking.

The `@authed` Playwright suite probes the API once before running and skips with
the actual reachability error when it cannot connect, so this failure mode
reports itself.

## Troubleshooting

**Redirected to `/setup`.** Supabase credentials are missing or still look like
placeholders (`your-…`). `NEXT_PUBLIC_*` values are baked in at build time —
rebuild after changing them.

**"relation does not exist".** The migrations have not been applied to the
project the app is pointing at.

**Signed in but sent to `/no-access`.** The profile exists with
`is_active = false`. An admin can reactivate it at `/settings/team`.

**No admin exists.** The first sign-up is promoted automatically. If profiles
were created another way, promote one directly:

```sql
update public.profiles set role = 'admin', can_view_giving = true
where email = 'you@example.org';
```

(Run this in the SQL editor — the statement runs without a JWT, which the
privilege-protection trigger treats as trusted server-side administration.)
