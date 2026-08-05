# Implementation Status — Grace Force CRM

> Operational handoff note. Read this first when resuming; it should be enough
> to continue without rereading the Git history.

**Last updated:** 2026-08-05

## Snapshot

| Field | Value |
| --- | --- |
| Current phase | Phase 3 — feature slices in progress |
| Current branch | `claude/crm-bridge-implementation-zj6y21` |
| Overall status | Foundation, auth and shell complete and verified; CRM feature layer being built |
| Last pushed commit | `b8fa127` |

## Completed

**Database (verified against real Postgres)**
- 14 migrations covering profiles, contacts, engagements, pipelines, the unified
  activity timeline, follow-ups, gifts, leads + rate limiter, the Mailchimp
  mirror, notifications, CSV import staging, reference data and grants.
- RLS on every table with explicit policies; all `SECURITY DEFINER` helpers pin
  `search_path`; both views set `security_invoker = on`.
- Triggers write timeline activities for engagement, pipeline, follow-up, gift
  and reassignment events, so the timeline is complete by construction.

**Application foundation**
- Next.js 15 scaffold, strict TypeScript, Tailwind, ESLint flat config,
  Vitest (3 projects), Playwright.
- `src/lib/env.ts` — lazy, placeholder-aware validation; unconfigured
  integrations resolve to `null` rather than throwing.
- Three Supabase clients (server / browser / service-role) with ESLint
  restricting the service-role import.
- Session middleware, email+password auth, `/setup` and `/no-access` states,
  protected `(app)` shell with capability-filtered navigation.
- UI primitives: Button, Field/Input/Textarea/Select/Checkbox, Badge, Card,
  PageHeader, EmptyState, Callout, Avatar, StatTile.

## In progress

Eight feature slices are being built in parallel across disjoint file sets:
contacts + timeline + engagements · follow-ups + pipelines · dashboard + search
+ giving · lead intake · Mailchimp · Resend notifications · import/export +
data portability · settings.

## Next highest-priority task

Integrate the feature slices: run `npm run verify`, fix cross-slice type and
lint errors, then add authenticated browser coverage.

## Known blockers

| Blocker | Impact | Type |
| --- | --- | --- |
| No Mailchimp API key | Cannot verify live sync | External verification |
| No Resend API key | Cannot verify live send | External verification |
| Repository had no default branch | Cannot open a draft PR — the feature branch *became* the default branch when pushed to the empty repo, so there is no base to target | External — needs a `main` branch created, which is the owner's call |

None of these block writing the integration code, its tests, or the
unconfigured-state handling.

**Hosted Supabase is an external verification step, not a blocker.** Creating a
paid project requires the owner's explicit approval and must not be done
otherwise. Development continues against the local environment: migrations,
generated types, seed data, the PGlite-backed schema/RLS suite, and the
unconfigured production states. What waits on a hosted project is only live
sign-in and the `@authed` browser suite — see the handover checklist in
`docs/SETUP.md`.

## Material architectural decisions

- **Engagements are rows, not a contact column.** One contact holds many
  concurrent engagements, each with its own status, owner and history. A partial
  unique index allows one *live* engagement per type while retaining ended ones.
- **One unified `activities` table** backs the timeline, written by triggers so
  it cannot drift from reality. Application code must not re-write those events.
- **`dedupe_key` is the idempotency backbone.** Partial unique indexes make
  replaying any sync or import a no-op.
- **Notifications claim before sending.** `insert … on conflict do nothing
  returning id` — no row returned means another caller owns the event. This is
  what makes "notify once" hold under concurrency, not just on retry.
- **Giving is gated separately** via `can_view_giving()`; the rollup view sets
  `security_invoker = on` so it cannot become a side door.
- **`anon` gets no table privileges at all.** Public traffic reaches the
  database only through the service-role lead-intake route.
- **Email is deliberately not unique on contacts** — households share addresses.
  Duplicate detection happens at import time.
- **PGlite for database tests.** No Docker daemon is available here, so the RLS
  suite runs against Postgres compiled to WASM. Same policies, same roles,
  genuinely executed.
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

## Integrations

| Integration | Code | Live verification |
| --- | --- | --- |
| Supabase | Schema + client layer + auth complete | Blocked (no project) |
| Mailchimp | In progress | Blocked (no key) |
| Resend | In progress | Blocked (no key) |

## Tests

**Passing: 144**

| Suite | Count | Covers |
| --- | --- | --- |
| `tests/db/migrations.test.ts` | 9 | schema shape, RLS coverage, `security_invoker`, pinned `search_path`, idempotency indexes, re-apply idempotence |
| `tests/db/rls.test.ts` | 34 | anonymous denial, deactivated users, viewer read-only, staff scope, admin deletes, giving gate, privilege-escalation reverts, last-admin protection, service-role bypass |
| `tests/db/schema-contract.test.ts` | 5 | hand-authored types vs live schema, both directions |
| `tests/db/seed.test.ts` | 7 | seed applies to a fresh database, fills every screen's data, contains only `example.org` addresses, and re-applies as a no-op |
| `tests/db/behaviour.test.ts` | 31 | timeline triggers, paired-field constraints, `last_activity_at` high-water mark, dedupe keys, `convert_lead` atomicity/idempotence, rate limiter, notification claim |
| `tests/unit/utils.test.ts` | 26 | currency parsing/formatting, relative time, normalisation matching the DB's generated columns |
| `tests/ui/primitives.test.tsx` | 16 | label/hint/error ARIA wiring, keyboard operation |
| `tests/e2e/public.spec.ts` | 16 | route protection for 8 routes, destination preservation, login a11y, keyboard-only operation, no console errors, security headers |

**Failing:** none.
**Pre-existing failures:** none (greenfield repository).

## Last successful validation commands

```
npx vitest run --project db                 # 86 passed
npx vitest run --project unit --project ui  # 42 passed
npx playwright test --grep @public          # 16 passed (Chromium)
npx tsc --noEmit                            # clean
npx eslint .                                # clean
npx next build                              # succeeds
```

## External setup still required

1. A hosted Supabase project, when the owner chooses to create one. Then apply
   `supabase/migrations`, set the three Supabase variables, verify sign-in and
   run the `@authed` browser suite (checklist in `docs/SETUP.md`). Do not create
   a paid project without explicit approval.
2. Mailchimp Marketing API key + server prefix.
3. Resend API key, verified sender, internal recipient list.
4. `CRON_SECRET` for the two scheduled endpoints.
5. A `main` branch, if a pull request is wanted.

## Definition of Done checklist

- [x] Supabase schema represented by migrations
- [x] Row Level Security implemented and verified
- [x] Contacts support multiple engagements (schema)
- [x] Authentication and protected routing
- [ ] Contact CRUD + detail + timeline
- [ ] Assignments and ownership (UI)
- [ ] Follow-ups and reminder views
- [ ] Pipelines (UI)
- [ ] Dashboard
- [ ] Search
- [ ] Giving-history context (UI)
- [ ] Secure lead intake
- [ ] Mailchimp integration code + idempotent sync
- [ ] Resend notifications + deduplication
- [ ] Imports and exports with stable ids and a relational export bundle
- [x] Documentation complete
- [x] `.env.example` complete, no secrets
- [x] TypeScript checks pass
- [x] Linting passes
- [x] Production build passes
- [x] Unauthenticated critical paths browser-tested
- [ ] Authenticated critical workflows browser-tested (blocked: no Supabase project)
- [x] Responsive + keyboard accessible (foundation; per-slice pending)
- [x] No secrets committed
