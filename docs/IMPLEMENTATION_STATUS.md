# Implementation Status — Grace Force CRM

> Operational handoff note. Read this first when resuming; it should be enough
> to continue without rereading the Git history.

**Last updated:** 2026-08-05

## Snapshot

| Field | Value |
| --- | --- |
| Current phase | Feature-complete locally; awaiting hosted-environment verification |
| Current branch | `claude/crm-bridge-implementation-zj6y21` |
| Overall status | All planned functionality implemented, tested and building |
| Tests | 419 Vitest + 28 browser passing; 8 browser skipped (need a hosted project) |
| Build | `next build` succeeds — 36 routes |

## Completed

**Database** — 14 migrations: profiles, contacts, engagement types and
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

Hosted-environment verification (see below). No local work is outstanding.

## Known blockers

None blocking implementation.

**Hosted Supabase is an external verification step, not a blocker.** Creating a
paid project requires the owner's explicit approval and must not be done
otherwise. What waits on it is only live sign-in and the `@authed` browser
suite; everything else is verified locally.

| External item | Blocks |
| --- | --- |
| Hosted Supabase project | Live auth, `@authed` browser suite |
| Mailchimp API key | Live sync against the real API |
| Resend API key | Live send |
| A `main` branch | Opening a pull request — the feature branch became the repository default when pushed to the empty repo, so there is no base to target |

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

Plus `supabase/seed.sql` — idempotent development data, every address
`example.org`, asserted by test.

## Integrations

| Integration | Code | Live verification |
| --- | --- | --- |
| Supabase | Complete | Pending a hosted project |
| Mailchimp | Complete, with injected-fake tests | Pending an API key |
| Resend | Complete, with injected-fake tests | Pending an API key |

## Tests

**419 Vitest across 22 files, all passing.**

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
| `unit/csv-gifts.test.ts` | 22 |
| `unit/notifications.test.ts` | 22 |
| `unit/csv-contacts.test.ts` | 21 |
| `unit/export-bundle.test.ts` | 18 |
| `unit/contact-validation.test.ts` | 16 |
| `unit/mailchimp-client.test.ts` | 16 |
| `unit/pipeline.test.ts` | 16 |
| `unit/settings.test.ts` | 14 |
| `unit/search.test.ts` | 12 |
| `unit/giving.test.ts` | 10 |
| `ui/primitives.test.tsx` | 17 |
| `ui/follow-up-queue.test.tsx` | 11 |
| `ui/pipeline-board.test.tsx` | 7 |

**Browser: 28 passing, 8 skipped.** The skipped ones are the `@authed` suite,
which reports its reason rather than passing vacuously.

**Failing:** none. **Pre-existing failures:** none (greenfield repository).

## Last successful validation commands

```
npx vitest run                       # 419 passed, 22 files
npx playwright test                  # 28 passed, 8 skipped
npx tsc --noEmit                     # clean
npx eslint .                         # clean
npx next build                       # succeeds, 36 routes
```

## External setup still required

1. **Hosted Supabase project** (owner's decision; do not create a paid resource
   without explicit approval). Then: apply `supabase/migrations`, set
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` and
   `SUPABASE_SERVICE_ROLE_KEY`, **rebuild** (`NEXT_PUBLIC_*` is inlined at build
   time, including into the middleware bundle), add the site URL and
   `<site-url>/auth/callback` to the redirect allow-list, sign up and confirm
   the first account becomes administrator, then set `E2E_EMAIL` /
   `E2E_PASSWORD` and run `npm run e2e -- --grep @authed`. Check **Advisors**
   in the dashboard afterwards.
2. Mailchimp Marketing API key + server prefix.
3. Resend API key, verified sender, `NOTIFY_INTERNAL_EMAILS`.
4. `CRON_SECRET` for the two scheduled endpoints (`vercel.json` declares both).
5. A `main` branch, if a pull request is wanted.

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
