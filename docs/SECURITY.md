# Security model

Grace Lead Management holds contact PII and donor giving history. The design assumes the
application layer will eventually have a bug, and puts the enforcement
somewhere a bug cannot reach past.

## The boundary is Row Level Security

Every query a signed-in user makes goes through `@/lib/supabase/server`, which
runs as that user. Postgres evaluates the policies and returns only permitted
rows. Application code filters for *relevance*; it never filters for *safety*.

The practical consequence: a forgotten `.eq('owner_id', me)` produces a wrong
list, not a data leak.

## Roles

| Role | Capabilities |
| --- | --- |
| `admin` | Everything: team management, giving, integrations, deletes |
| `staff` | Create/edit contacts, engagements, activities, follow-ups, pipelines, leads |
| `viewer` | Read contacts and activity. No leads, no giving, no writes |

Two orthogonal flags sharpen this:

- `can_view_giving` — grants read access to `gifts`. Admins always have it.
  Staff do not, unless an admin turns it on. Giving is the most sensitive data
  in the system and the smallest audience should see it.
- `is_active` — a deactivated profile authenticates successfully but every
  policy fails, so it sees nothing. The app routes them to `/no-access` with an
  explanation instead of the login screen.

## Database roles

| Role | Table privileges | RLS |
| --- | --- | --- |
| `anon` | **none** | n/a — cannot reach any table |
| `authenticated` | broad | enforced by policy |
| `service_role` | broad | bypassed (`BYPASSRLS`) |

Giving `anon` no privileges at all is deliberate. Public traffic — the lead
intake form — reaches the database only through a server route holding the
service-role key. A leaked anon key therefore reads nothing.

## Policy helpers

Policies delegate to five `SECURITY DEFINER` functions: `is_active_user()`,
`is_admin()`, `can_write()`, `can_view_giving()`, `current_user_role()`.

They must be `SECURITY DEFINER` because they read `public.profiles`, which is
itself policy-protected — an invoker-rights function would re-enter the policy
and recurse. Each pins `search_path = ''` and schema-qualifies every reference,
so a caller cannot shadow a table name and change what the function resolves to.
`tests/db/migrations.test.ts` asserts that every definer function pins its
search path.

## Column-level protection

RLS decides which rows are writable. Two triggers decide which *columns* take
effect:

- `protect_profile_privileges` reverts changes to `role`, `is_active` and
  `can_view_giving` unless the caller is an admin — so a staff member who
  PATCHes their own profile cannot promote themselves. A `NULL auth.uid()` is
  treated as trusted server-side administration; that path is unreachable for
  `anon`/`authenticated` because the profile policies match no rows without a
  JWT subject.
- `ensure_admin_remains` refuses to demote or deactivate the last active
  administrator, which would lock every human out of user administration.

## Views

`contact_giving_summary` and `contact_email_engagement` are declared
`WITH (security_invoker = on)`.

Without it, a view runs with its owner's privileges and silently hands every
authenticated user the giving totals it aggregates — a textbook way to bypass
RLS by accident. The migration test suite asserts that every view in `public`
sets it.

## Idempotency as a safety property

Replaying a sync or an import must not duplicate data. That is enforced by
unique keys rather than by careful application code:

- `activities.dedupe_key` — unique when present
- `leads.dedupe_key` — unique when present
- `notifications.dedupe_key` — unique, and *claimed before sending*
- `contacts` / `engagements` / `gifts` — unique `(external_source, external_id)`
- `mailchimp_members` — unique `(audience_id, mailchimp_member_id)` and
  `(audience_id, email_normalized)`
- `mailchimp_campaign_activity.dedupe_key` — unique

## Public lead intake

`POST /api/leads` is the only unauthenticated write path. It layers:

- Zod schema validation
- a honeypot field, recorded as spam and answered with 200 so a bot learns
  nothing
- an origin allow-list (`LEAD_INTAKE_ALLOWED_ORIGINS`)
- an optional shared secret compared with `crypto.timingSafeEqual`
- a per-IP fixed-window rate limit implemented as an atomic
  `INSERT … ON CONFLICT DO UPDATE … RETURNING`, so concurrent requests cannot
  both read a stale count
- deterministic `dedupe_key`, collapsing double-submits

Client IPs are **hashed before storage**. The raw address is never persisted.

## Transport and headers

`next.config.ts` sets, on every response: `X-Frame-Options: DENY`,
`X-Content-Type-Options: nosniff`,
`Referrer-Policy: strict-origin-when-cross-origin`, a restrictive
`Permissions-Policy`, and HSTS. `poweredByHeader` is off. The Playwright suite
asserts these are actually present.

The app is marked `noindex, nofollow`.

## Auth details

- Sessions are validated with `getUser()` (which revalidates against the auth
  server), never `getSession()` alone (which only decodes a cookie the client
  supplied).
- Sign-in failures are deliberately uniform, so the form cannot be used to
  enumerate who has a Grace Lead Management account.
- `?next=` and the auth callback's `next` parameter accept relative paths only,
  so neither can be turned into an open redirect.
- Sign-out is a POST (a server action), not a link.

## What is deliberately not implemented

- **Field-level encryption.** Giving amounts are protected by RLS, not
  encrypted at rest beyond Supabase's disk encryption. Encrypting them would
  break the aggregate views the giving screen depends on.
- **Full audit log of reads.** Writes are captured in `activities`; reads are
  not logged. Add Supabase's log drains if read auditing is required.
- **MFA.** Supabase supports it; enabling it is a project-level setting rather
  than an application change.
