# Implementation Status — Grace Lead Manager

> Operational handoff note. Read this first when resuming; it should be enough
> to continue without rereading the Git history.

**Last updated:** 2026-08-12

## Snapshot

| Field | Value |
| --- | --- |
| Current phase | Simplification redesign complete on `claude/crm-redesign-simplicity-0zqxek`; awaiting review/merge |
| Overall status | Feature-complete. Eight new migrations add the relationship-development domain; the interface was rebuilt around progressive disclosure |
| Tests | 570 Vitest (30 files) + 28 browser `@public` passing |
| Build | `next build` succeeds — 45 routes |
| Deployment | `grace-force` on Vercel, production target, git-connected — the project slug predates the rename and is left as-is |

## The simplification redesign (2026-08-12)

The brief: Salesforce capability, dramatically less cognitive load. The audit
is in `docs/UX_AUDIT.md` — read it before changing any of this, because most
of the structure below is a direct answer to something recorded there.

**Schema.** Eight migrations (`20260806000100`–`20260806000800`) add what the
gap analysis found missing: related constituents, philanthropic interests,
giving capability, events and attendance, proposals and planned gifts, call
reports, and attachments. Plus communication preferences and an interaction
outcome on existing tables. Every table has RLS, indexes and tests; capability
and proposals follow `can_view_giving()`. See `docs/DATA_MODEL.md` for the
three decisions worth knowing.

**Navigation.** Twelve always-visible destinations in four labelled groups
became six primary, a collapsed "More" group, and one Settings entry. Search
left the rail and became a header field. No route moved.

**The donor record.** Three layers instead of nine stacked cards: a header
(who / owner / how to reach them / one primary action), a six-column glance
strip, and one tab at a time — Activity, Overview, Giving, Proposals, Events,
Relationships, Files. Tabs are `?tab=` links, so each is a real URL.

**Logging an interaction** is a dialog with nine plain-language choices, one
required field, and the follow-up built in. The `(type, direction)` pair the
timeline stores is derived from the choice.

**Call reports** are written in the order a person recalls a meeting, nothing
required but the date, drafts private until filed. **Proposals** lead with the
summary and keep the planned-giving figures behind a disclosure whose fields
depend on the proposal type. **Events** stay small: what is coming up, what
happened, who was there.

**Forms.** Adding a person asks six things; the other nineteen fields sit
behind disclosures that open themselves when they already hold data.

**Dashboard.** No KPI tiles at all. A sentence, then the queue.

## Visual QA

Every screen was captured at 1440 / 834 / 390 against a local stack (PGlite
with all migrations, a GoTrue shim and a PostgREST-compatible layer), since
this container cannot reach `*.supabase.co`. No console errors, no horizontal
overflow, no error text on any route at any width. The harness is a scratchpad
throwaway and is not in the repo.

## Attachments — what is verified, and the one step that is not

**A defect this found.** Driving a 19MB upload through the real form — rather
than a mock — surfaced a bug that `serverActions.bodySizeLimit` alone does not
fix. Next.js buffers at most **10MB** of a request body on any route that has
middleware, and this app's middleware runs on every authenticated route. Above
that the body was silently truncated and the upload died in form parsing with
`Unexpected end of form`: a generic error, while the interface still promised
20MB. Fixed by setting `experimental.middlewareClientMaxBodySize` to match, and
guarded by a test that reads `next.config.ts` and fails if either ceiling drops
below the total the application accepts.

**End-to-end round trip: 24/24 checks pass.** Run against the local stack with
the Storage API implemented, so every layer of the *application* is genuine —
the browser form, the server action, the `supabase-js` storage client,
PostgREST, and Postgres with RLS in force. It covers: upload → metadata row
(name, byte size, mime, contact-scoped path that leaks no donor name) → object
present in the bucket with byte-identical contents → signed URL download
byte-identical to the source → a forged token refused → another staff member
can read the file but gets no Remove control → delete removes the row *and* the
object → the three refusal boundaries send no request at all → a 19MB file
passes through both body ceilings and is stored whole. It is not Supabase, so
it does not replace the manual pass below; it does verify everything except the
platform itself.

**Automated coverage** (`tests/unit/attachments.test.ts`, 26 tests;
`tests/db/storage-bucket.test.ts`, 8 tests; plus the attachment cases in
`tests/db/development.test.ts`):

- the size and type rules, including a file of *exactly* the limit and one byte
  over, and a batch that is legal file-by-file but over the total cap
- the metadata row written, and that it points at the object actually uploaded
- orphan cleanup — the object is removed when the metadata insert fails, with
  the call order asserted (`upload → insert → remove`)
- delete ordering — the row goes first, the bytes second, asserted on a shared
  call log, so a download can never point at bytes that are already gone
- an honest message when a multi-file batch fails halfway, naming what survived
- Row Level Security refusing a write, surfaced as a permission sentence
- the bucket is created private, with exactly three policies scoped to it,
  wired to `is_active_user()` / `can_write()`, and those predicates are
  *evaluated* (staff writes, viewer is refused, anonymous reads nothing)
- signed URLs return `null` instead of throwing when storage is unreachable

Both the cleanup and the delete-ordering assertions were confirmed to fail when
the behaviour they guard is inverted, so they are not passing vacuously.

**What is still unverified: a real byte round trip.** Two independent blockers,
both external to the code:

1. **Egress is denied by policy.** The agent proxy answers
   `403` to `CONNECT phhkhvewcclzjkdbjmqw.supabase.co:443` (and to
   `supabase.com:443`). Nothing in this container can reach the project over
   HTTPS. The Supabase management tooling that *is* reachable exposes Postgres
   only — it has no storage transfer.
2. **The schema is not deployed yet.** The live project currently has the 20
   original tables and no storage buckets: none of the nine new tables and no
   `attachments` bucket exist there. Applying migrations to production is a
   deploy step, not something this session performed.

### Manual verification, once the migrations are deployed

Run as a staff or admin account, with a small non-sensitive file (a one-page
PDF is ideal).

1. **Deploy the schema.** `supabase db push` (or apply
   `20260806000100`–`20260806000800` in filename order). Confirm afterwards:
   `select count(*) from storage.buckets where id = 'attachments';` → `1`, and
   `select policyname from pg_policies where schemaname='storage' and tablename='objects';`
   → `attachments_read`, `attachments_write`, `attachments_remove`.
2. **Upload.** Open any person → **Files** → choose the PDF → **Attach file**.
   Expect the row to appear with the correct name, size and date.
3. **Check the metadata.** `select contact_id, storage_path, file_name, mime_type, size_bytes, uploaded_by from public.attachments order by created_at desc limit 1;`
   — `storage_path` must start with the contact's id, `size_bytes` must match
   the file on disk, `uploaded_by` must be the signed-in profile.
4. **Check the object.** `select name from storage.objects where bucket_id = 'attachments';`
   — exactly one object, its `name` equal to the row's `storage_path`.
5. **Download.** Click the file name. It should download rather than render
   (the signed URL sets `download`), and the link should stop working after 60
   seconds — paste it into a private window after a minute and expect a failure.
6. **Authorization.** Signed in as a **viewer**, the file is listed and
   downloadable but there is no Remove control, and no drop area. Signed in as
   a *different* staff member, Remove is likewise absent (uploader or admin
   only). Confirm at the database: a viewer's
   `insert into public.attachments …` is refused by RLS.
7. **Delete and cleanup.** As the uploader, click **Remove**. Then confirm
   *both* are gone: `select count(*) from public.attachments where id = '<id>';`
   → `0`, and `select count(*) from storage.objects where name = '<storage_path>';`
   → `0`.
8. **Size boundary.** Attach a file just over 20MB. Expect an immediate
   in-page message naming the file and its size — *before* any upload starts
   (the network tab should show no request). Then attach two 12MB files
   together: expect the "together" message, again with no request. Finally
   attach a ~19MB file and confirm it succeeds end to end, which is what proves
   the 24mb `serverActions.bodySizeLimit` is genuinely above the accepted
   ceiling.
9. **Type boundary.** Rename a small file to `.zip` or `.svg` and try to attach
   it. Expect refusal in-page, with no request sent.

## Next task

The manual attachment pass above, against the deployed project. Then the
`@authed` browser suite from a network with normal egress:

```bash
E2E_BASE_URL=https://grace-force.vercel.app E2E_EMAIL=… E2E_PASSWORD=… npm run e2e
```

## Premium visual redesign (2026-08-06, after the polish pass)

A full visual identity overhaul on the same branch — "a warm ledger", defined
in `docs/DESIGN.md`. Warm stone neutrals replace cold gray, deep evergreen
replaces the default blue, a serif display voice (system Charter/Georgia
stack, no font dependency) carries titles, names and figures, and the
navigation becomes a dark evergreen-ink rail with a serif wordmark. Every
route was rebuilt to the system: the dashboard as an action center, contacts
as an avatar-led operating view with a composed identity band and a
story-styled timeline, follow-ups as a segmented work queue with a fused
action strip, pipelines with ledger bands and settled won/lost cards,
stewardship-toned giving, integrated Mailchimp, organized settings, and a
split-panel brand login. No routes, queries, actions, permissions or schema
changed; axe-core reports zero WCAG 2.1 AA violations across all 27 routes;
unit/UI suites and the public browser suite pass.

**Known pre-existing fault (production-affecting, found during browser QA):**
multi-intent server-action forms lose the submit button's `name`/`value` in
real browsers — the POST body carries the action ref and hidden fields but no
`intent`, so handlers reply "That action is not available." This hits every
multi-button form (follow-up Complete/snooze/Reassign/Cancel, pipeline
Move/Close, lead triage, engagement Edit/End). Verified on the pre-polish
baseline commit (42e6fb7) in dev AND production builds via the local harness
(next 15.5.22 / react 19.2.8), so it predates all visual work; the jsdom
suite passes because the test renderer injects the submitter, and the hosted
`@authed` browser suite has never run in CI sandboxes (skipped — no egress).
Not fixed here: repairing it means changing form mechanics (per-button bound
`formAction`s or hidden-field dispatch), which is behavior work outside a
visual branch. It should be the very next engineering task.

## Visual polish pass (2026-08-06)

A dedicated visual/responsive/accessibility pass over every route — no
business logic, auth, permissions, API or schema changes. Every screen was
audited from real screenshots (desktop 1440 / tablet 834 / mobile 390, as
admin/staff/viewer) served by a local stack (Postgres 16 + PostgREST + a
fake auth shim reproducing the Supabase contract), since this container
cannot reach `*.supabase.co`.

Highlights: WCAG-AA muted-text and control-contrast floor; 60+-friendly
control sizes (36–48px buttons, 16px inputs under the `sm` breakpoint so iOS
stops zooming on focus); sticky sidebar/topbar and a truly modal nav drawer
(inert background, scroll lock, focus trap); contacts table no longer clips
its Owner column; contact detail drops duplicate status badges and dead
action bars, and leads with details on phones; follow-up tabs and lead tabs
wrap instead of hiding off-screen; pipeline boards always show a scroll cue
column; import commit panel no longer contradicts a failed batch; Mailchimp
tables hold readable widths and scheduled campaigns read as scheduled;
settings tables stop crushing on phones; auth/intake forms share one card
surface. axe-core (WCAG 2.1 AA) reports zero violations across all 27
routes; `tests/e2e` copy assertions updated for two intentional wording
changes (queue meta line, login title).

## Completed

**Database** — 16 migrations: profiles, contacts, engagement types and
engagements, pipelines/stages/cards, the unified activity timeline, follow-ups,
gifts, leads and the rate limiter, the Mailchimp mirror, the notification
outbox, CSV import staging, reference data, grants. RLS on every table with
explicit policies; every `SECURITY DEFINER` helper pins `search_path`; both
views set `security_invoker = on`. Development seed in `supabase/seed.sql`.

**Application**
- Auth: email + password, session middleware, `/setup` and `/no-access` states,
  first account promoted to administrator.
- Contacts: list with full-text + trigram search and filters, create/edit,
  detail page with the unified timeline, engagement panel, ownership
  reassignment, admin archive.
- Timeline: day-grouped, type-filtered, pinned-first, with manual activity
  logging that does not collide with the trigger-written entries.
- Engagements: add/edit/end, with the form unable to express the state the
  `engagements_ended_consistency` constraint would reject.
- Follow-ups: overdue/today/week/upcoming/completed queue, complete with
  outcome, snooze, reassign, cancel.
- Pipelines: index with per-stage counts and open value, board with a
  keyboard-operable stage move (not drag-only), close as won/lost.
- Dashboard, global search, giving history with totals, funds and top givers.
- Lead intake: hardened public endpoint and form, internal triage queue,
  atomic conversion to a contact.
- Mailchimp: typed API client, sync engine with documented matching
  precedence, status and unmatched-subscriber screens, cron route.
- Resend: claim-then-send outbox, typed events, escaping templates, reminder
  cron route.
- Import/export: two-phase CSV import with preview and per-row reasons;
  dataset exports plus a relational bundle with a manifest.
- Settings: team administration, integration status, engagement-type catalogue.

## Next task

Confirm the deployed dashboard renders for a signed-in administrator. The three
faults below were each reproduced by a test and fixed, but the final
confirmation is a browser step this container cannot perform — `*.vercel.app`
is denied by the egress policy, and the Vercel MCP's fetch and log tools
require interactive approval.

Then run the `@authed` suite against the deployed origin from a network with
normal egress:

```bash
E2E_BASE_URL=https://grace-force.vercel.app E2E_EMAIL=… E2E_PASSWORD=… npm run e2e
```

No local work is outstanding.

## Production faults found after deploying

Three faults that only appear against a real origin with a real session. None
were reachable locally, which is why each one now has a regression test that
was first verified to fail against the broken code.

**1. `ERR_TOO_MANY_REDIRECTS` between /login and /dashboard** — two independent
causes, either of which alone would keep the loop reachable.

- Middleware built a fresh `NextResponse.redirect()` after `getUser()`, which
  discarded the refreshed session cookies `@supabase/ssr` had just written onto
  the original response. Under refresh-token rotation that is worse than lossy:
  the server consumes the refresh token while the browser keeps the stale one.
  All four redirects now route through `redirectPreservingCookies`, which
  copies the whole `ResponseCookie` — path, httpOnly, sameSite and maxAge
  included, since a cookie that loses its path may never be sent back.
- `requireProfile()` sent a *signed-in* user with no profile row to `/login`,
  which middleware bounces straight back to `/dashboard`. A signed-in user must
  never be redirected to `/login`; that pair is the loop. Unprovisioned now
  terminates at `/no-access?reason=unprovisioned`.

Covered by `tests/unit/middleware.test.ts` (16) and
`tests/unit/auth-guards.test.ts` (15), the latter walking both layers together
— either layer looks correct in isolation.

**2. "Account not set up" for a valid administrator** — self-inflicted by the
fix above. Splitting session and profile lookup introduced a second Supabase
client that queried *before* resolving its session. `supabase-js` attaches the
access token from auth state, so the request went out as `anon`; `anon` holds
no table privileges here by design, so it returned a permission error rather
than an empty result, and `const { data }` discarded it into `null`.

`loadProfile()` now uses one client, calls `getUser()` before querying, and
returns a discriminated union — `ok` / `no-session` / `not-found` / `error` —
so a fault can no longer read as a verdict on the account. Failures log the
PostgREST code and the project ref, never a key.

The hosted database was verified first and was never at fault: the
`on_auth_user_created` trigger existed and fired at signup, the row was present
with `role=admin` and `is_active=true`, and the app's exact query run as
`authenticated` returned it.

**3. `Functions cannot be passed directly to Client Components`** — the
protected layout passes `visibleSections(profile)` into `<AppShell>`, a Client
Component. `visibleSections` filtered with `Array.prototype.filter`, which
returns the *same* item objects with the `visible` predicate still attached,
so React tried to serialise a function on every dashboard render. The four
items named in the logs — Import, Export, Team, Integrations — are exactly
those gated on `canWrite` / `isAdmin`.

`'use server'` would have been the wrong fix: these are synchronous permission
predicates, not server actions, and exposing them would turn each visibility
check into a network round-trip. Instead `nav.ts` now separates
`NavItemDefinition` (holds the predicate, unexported, never leaves the server)
from `NavItem` (strings only), and rebuilds each item field by field so the
return type makes a leak a compile error.

Covered by `tests/unit/rsc-serializable-props.test.ts` (25), which deep-scans
for functions at any depth, checks a JSON round-trip, and pins the exact wire
fields. The rest of the boundary was audited at the same time: all nine
`actions.ts` modules declare `'use server'`, and every other function-valued
prop has a `'use client'` parent, so the nav predicate was the only violation.

## Hosted Supabase project

| Field | Value |
| --- | --- |
| Project ID / ref | `phhkhvewcclzjkdbjmqw` |
| Name | `grace-force-crm` (created before the rename; not renamed, since the project ref is what everything addresses) |
| Organisation | `jpiercedev's Org` (`oyreoignqdishfjmlssh`), Pro plan |
| Region | `us-east-2` (Ohio) — closest available to Wisconsin |
| Postgres | 17.6 |
| API URL | `https://phhkhvewcclzjkdbjmqw.supabase.co` |
| Cost | $10/month, no add-ons |

The first 16 migrations were applied verbatim from `supabase/migrations`, in
filename order. Verified on the live database: 20 tables, **20 with RLS**, 51
policies, 16 `SECURITY DEFINER` functions, 2 `security_invoker` views,
reference data seeded (8 engagement types, 3 pipelines, 16 stages).

Not yet applied: the eight `20260806*` relationship-development migrations, and
`20260827000100_rebrand_to_grace_lead_manager.sql`, which rewrites the two
seeded engagement-type descriptions and the `contacts` table comment that still
name the old brand.

`20260827000200_force_password_rotation.sql` **is** applied to the hosted
project, ahead of the `20260806*` set, so the applied order there differs from
filename order. It depends on nothing but `auth.users`, and `supabase db push`
still picks up the rest by absence from the history table rather than by
position. Accounts provisioned by an administrator carry
`must_change_password` in `auth.users.raw_app_meta_data` until they rotate it;
`/change-password` is the only route the app serves them until they do.

The recorded migration versions were realigned to the repository's filename
prefixes — the management API stamps its own apply-time timestamps, which would
make a later `supabase db push` believe none of them had run.

## Known blockers

| External item | Blocks | Notes |
| --- | --- | --- |
| **Sandbox egress policy** | The `@authed` browser suite | This container's network policy denies CONNECT to `*.supabase.co` (verified: gateway returns 403; GitHub and npm are permitted). The app therefore cannot reach the API from here. The MCP tooling works because it routes through Anthropic's infrastructure, not container egress. Run the suite from a machine with normal egress. |
| `SUPABASE_SERVICE_ROLE_KEY` | Lead intake, Mailchimp sync, notification outbox, reminder cron | The management API deliberately exposes only publishable keys. Copy it from Project Settings → API. |
| **Sandbox egress (Vercel)** | Browsing or Playwright-testing the deployment from here | `*.vercel.app`, `vercel.com` and `api.vercel.com` are denied by the same policy that blocks `*.supabase.co`. The Vercel MCP's `web_fetch_vercel_url` and `get_runtime_logs` need interactive approval, which a non-interactive session cannot give, so the deployed page cannot be confirmed from this container. `list_deployments` and `get_deployment` do work, so build state is observable. |
| Mailchimp API key | Live sync against the real API | Intentionally unset so no real campaign can be touched. |
| Resend API key | Live send | Intentionally unset so no real email can be sent. |
| A `main` branch | Opening a pull request | The feature branch became the repository default when pushed to the empty repo, so there is no base to target. |

Resolved since the previous entry: the Vercel project now exists and is
git-connected (created by the owner — no MCP tool covers it), and the Supabase
Site URL and redirect allow-list are configured.

## Material architectural decisions

- **This is a standalone, long-term application.** Supabase Postgres is the
  permanent primary database. It is not a bridge, staging step, or migration to
  any other system.
- **Engagements are rows, not a contact column.** One contact holds many
  concurrent engagements, each with its own status, owner and history; a partial
  unique index allows one *live* engagement per type while keeping ended ones.
- **One unified `activities` table**, written by triggers for engagement,
  pipeline, follow-up, gift and reassignment events — so the timeline is
  complete by construction. Application code must not re-write those events.
- **`dedupe_key` is the idempotency backbone.** Partial unique indexes make
  replaying any sync or import a no-op.
- **Notifications claim before sending.** `insert … on conflict do nothing
  returning id` — no row means another caller owns the event, which is what
  makes "notify once" hold under concurrency rather than only on retry.
- **Giving is gated separately** via `can_view_giving()`; the rollup view sets
  `security_invoker = on` so it cannot become a side door.
- **`anon` has no table privileges at all.** Public traffic reaches the database
  only through the service-role lead-intake route.
- **The service-role client is used in exactly four places**: lead intake, the
  notification outbox, the Mailchimp sync runner, the reminder cron. ESLint
  blocks importing it elsewhere.
- **Email is deliberately not unique on contacts** — households share addresses.
  Duplicate detection happens at import time.
- **PGlite for database tests.** No Docker daemon is available in this
  environment, so the schema/RLS suite runs against Postgres compiled to WASM,
  executing as the real `anon` / `authenticated` / `service_role` roles.
- **`Database` row types must be `type`, not `interface`.** Interfaces lack an
  implicit index signature and fail PostgREST's `Record<string, unknown>` bound,
  which silently collapses every query result to `never`.

## Database migrations

| File | Contents |
| --- | --- |
| `20260805000100_foundation.sql` | extensions, enums, `set_updated_at`, email/phone normalisation |
| `20260805000200_profiles.sql` | profiles, auth helpers, provisioning + privilege triggers |
| `20260805000300_contacts.sql` | contacts, search vector, trigram indexes |
| `20260805000400_engagements.sql` | engagement types + engagements |
| `20260805000500_pipelines.sql` | pipelines, stages, cards |
| `20260805000600_activities.sql` | unified timeline + auto-logging triggers |
| `20260805000700_follow_ups.sql` | follow-ups + reminder bookkeeping |
| `20260805000800_gifts.sql` | gifts + `contact_giving_summary` view |
| `20260805000900_leads.sql` | leads, rate limiter, `convert_lead()` |
| `20260805001000_mailchimp.sql` | audiences, members, campaigns, activity, sync runs |
| `20260805001100_notifications.sql` | notification outbox with unique dedupe key |
| `20260805001200_imports.sql` | import batches + rows |
| `20260805001300_reference_data.sql` | engagement types, pipelines, stages |
| `20260805001400_grants.sql` | role grants |
| `20260805001500_function_execute_grants.sql` | revoke RPC EXECUTE on definer functions (advisor fix) |
| `20260805001600_policy_and_index_tuning.sql` | split FOR ALL policies, add FK indexes (advisor fix) |

Plus `supabase/seed.sql` — idempotent development data, every address
`example.org`, asserted by test.

## Integrations

| Integration | Code | Live verification |
| --- | --- | --- |
| Supabase | Complete | Live — schema applied, auth verified against the hosted project |
| Mailchimp | Complete, with injected-fake tests | Pending an API key |
| Resend | Complete, with injected-fake tests | Pending an API key |

## Tests

**475 Vitest across 25 files, all passing.**

| Suite | Count |
| --- | --- |
| `db/rls.test.ts` | 34 |
| `db/behaviour.test.ts` | 31 |
| `db/migrations.test.ts` | 9 |
| `db/seed.test.ts` | 7 |
| `db/schema-contract.test.ts` | 5 |
| `unit/leads.test.ts` | 40 |
| `unit/mailchimp-sync.test.ts` | 34 |
| `unit/follow-up.test.ts` | 32 |
| `unit/utils.test.ts` | 25 |
| `unit/rsc-serializable-props.test.ts` | 25 |
| `unit/csv-gifts.test.ts` | 22 |
| `unit/notifications.test.ts` | 22 |
| `unit/csv-contacts.test.ts` | 21 |
| `unit/export-bundle.test.ts` | 18 |
| `unit/contact-validation.test.ts` | 16 |
| `unit/mailchimp-client.test.ts` | 16 |
| `unit/pipeline.test.ts` | 16 |
| `unit/middleware.test.ts` | 16 |
| `unit/auth-guards.test.ts` | 15 |
| `unit/settings.test.ts` | 14 |
| `unit/search.test.ts` | 12 |
| `unit/giving.test.ts` | 10 |
| `ui/primitives.test.tsx` | 17 |
| `ui/follow-up-queue.test.tsx` | 11 |
| `ui/pipeline-board.test.tsx` | 7 |

The last three unit suites cover the production faults above. Each was run
against the broken code first: the middleware tests produced 4 failures, the
guard test reported `redirect loop: /login -> /dashboard -> /login -> ...`, and
the serialisation test produced 11, one naming
`"visible": [Function canViewGiving]` — the production symptom exactly. A
regression test that has never failed proves nothing.

**Browser: 28 passing, 8 skipped.** The skipped ones are the `@authed` suite.
It now probes the Supabase API once before running and skips with the actual
reachability error, rather than failing eight times over with identical
sign-in timeouts that read like broken auth instead of blocked networking.

The 28 passing runs were executed against the **real** hosted credentials, so
they also confirm the app builds and serves correctly with them.

**Failing:** none. **Pre-existing failures:** none (greenfield repository).

## Last successful validation commands

```
npx vitest run                       # 475 passed, 25 files
npx playwright test                  # 28 passed, 8 skipped
npx tsc --noEmit                     # clean
npx eslint .                         # clean
npx next build                       # succeeds, 36 routes
```

## External setup still required

Done: the hosted Supabase project, its schema, the Vercel project, the
environment variables and the auth redirect allow-list. What remains:

1. **Confirm the deployed dashboard renders** for a signed-in administrator —
   the one step this container cannot perform (see Known blockers). If anything
   is still wrong, `get_runtime_logs` in the Vercel dashboard is where it will
   show.
2. Run the `@authed` browser suite from a machine with normal egress:
   `E2E_BASE_URL=… E2E_EMAIL=… E2E_PASSWORD=… npm run e2e -- --grep @authed`.
3. Mailchimp Marketing API key + server prefix.
4. Resend API key, verified sender, `NOTIFY_INTERNAL_EMAILS`.
5. `CRON_SECRET` for the two scheduled endpoints (`vercel.json` declares both).
6. A `main` branch, if a pull request is wanted.

Remember that `NEXT_PUBLIC_*` is inlined at build time, including into the
middleware bundle — changing one needs a redeploy, not a restart.

## Supabase Advisors

Run after applying the schema, then fixed and re-run.

**Security** — 15 WARN + 1 INFO → **6 WARN + 1 INFO**
- Fixed: all 14 `anon_security_definer_function_executable`. PostgREST exposes
  every `public` function as an RPC and Postgres grants EXECUTE to PUBLIC, so
  every definer function — including the trigger functions — was callable
  unauthenticated. Migration `…001500` revokes it.
- **Accepted, cannot be fixed without breaking the security model:** the five
  RLS helpers (`is_admin`, `can_write`, `can_view_giving`, `is_active_user`,
  `current_user_role`) must keep EXECUTE for `authenticated`. A policy
  expression is evaluated with the querying role's privileges, so revoking it
  makes every query against a protected table fail with "permission denied for
  function". Verified against a real Postgres before accepting.
- **Accepted, intentional:** `convert_lead` is an RPC the app calls on behalf of
  a signed-in user; it re-checks `can_write()` internally.
- **INFO, by design:** `rate_limit_hits` has RLS enabled with no policies —
  service-role only.

**Performance** — 4 WARN + 51 INFO → **0 WARN + 65 INFO**
- Fixed: all 4 `multiple_permissive_policies`. `FOR ALL` covers SELECT, so each
  admin-write policy was evaluated alongside the read policy on every read.
  Split into INSERT/UPDATE/DELETE; the two `profiles` UPDATE policies merged
  into one disjunction.
- Fixed: 13 of 24 `unindexed_foreign_keys` — the ones the application joins on.
- **Deliberately not indexed:** the audit-stamp columns (`created_by`,
  `updated_by`, `completed_by`, `converted_by`, `triggered_by`). Nothing queries
  by them and their parent `profiles` has no DELETE policy — team members are
  deactivated, never deleted — so an index would cost writes to buy a lookup
  nobody performs.
- **Not actionable:** `unused_index` on an empty database with no query history.
  The count rises after adding indexes precisely because they are new.
- **INFO, project config:** `auth_db_connections_absolute` recommends
  percentage-based Auth connection allocation before scaling the instance.

## Known limitations

- Timeline entries cannot be edited or pinned from the interface, though RLS
  permits an author to amend their own.
- Archived (soft-deleted) contacts have no restore screen; every read filters
  `deleted_at is null`.
- The pipeline board is keyboard-operable by explicit stage controls; drag and
  drop is not implemented.
- Read access is not audited. Writes are captured in `activities`; add
  Supabase log drains if read auditing is needed.
- MFA is available at the Supabase project level and is not configured here.

## Definition of Done

- [x] Core CRM workflow implemented
- [x] Authentication and protected routing
- [x] Supabase schema represented by migrations
- [x] Row Level Security implemented and verified
- [x] Contacts support multiple engagements
- [x] Activities appear in a unified contact timeline
- [x] Assignments and ownership
- [x] Follow-ups and reminder views
- [x] Pipelines
- [x] Dashboard
- [x] Search
- [x] Giving-history context
- [x] Secure lead intake
- [x] Mailchimp integration code
- [x] Mailchimp contact matching and synchronisation
- [x] Mailchimp campaign and contact-level engagement surfaced in the app
- [x] Mailchimp synchronisation is idempotent
- [x] Resend internal notification code
- [x] Internal notification deduplication
- [x] Imports and exports, with stable ids and a relational bundle
- [x] Required documentation exists
- [x] `.env.example` complete, no secrets
- [x] TypeScript checks pass
- [x] Linting passes
- [x] Automated tests pass
- [x] Production build passes
- [x] Unauthenticated critical paths browser-tested
- [ ] Authenticated critical workflows browser-tested — suite written, skips
      until a hosted project exists
- [x] Interface is responsive (asserted at 320px and phone widths)
- [x] Critical workflows keyboard accessible
- [x] No secrets committed
- [x] Working tree clean
- [x] All commits pushed to the feature branch
- [ ] Draft pull request — no base branch exists to target
