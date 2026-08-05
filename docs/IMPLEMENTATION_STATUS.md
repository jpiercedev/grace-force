# Implementation Status — Bridge CRM

> Operational handoff note. Read this first when resuming; it should be enough
> to continue without rereading the Git history.

**Last updated:** 2026-08-05

## Snapshot

| Field | Value |
| --- | --- |
| Current phase | Phase 1 — database foundation complete |
| Current branch | `claude/crm-bridge-implementation-zj6y21` |
| Overall status | Foundation landed; application layer next |
| Last pushed commit | _(pending first push)_ |

## Completed

- Next.js 15 + TypeScript (strict, `noUncheckedIndexedAccess`) scaffold with
  Tailwind, ESLint flat config, Vitest (3 projects), Playwright config.
- Full Postgres schema across 10 migrations: profiles, contacts, engagement
  types + engagements, pipelines/stages/cards, unified activity timeline,
  follow-ups, gifts, leads + rate limiter, Mailchimp mirror, notifications,
  CSV import staging, reference data, grants.
- RLS enabled on every table with explicit policies; helper functions are
  `SECURITY DEFINER` with pinned `search_path`.
- **Verified** migration + RLS behaviour against real Postgres via PGlite
  (Postgres 18.3 in-process), executing as the actual `anon` /
  `authenticated` / `service_role` roles.

## In progress

Application layer — nothing partially written yet.

## Next highest-priority task

Supabase client wiring (`src/lib/supabase/*`), env validation, auth routes and
protected layout.

## Known blockers

| Blocker | Impact | Type |
| --- | --- | --- |
| No Supabase project provisioned | Cannot run live auth/browser tests of authenticated flows | External — costs $10/mo on the user's Pro org; needs authorisation |
| No Mailchimp API key | Cannot verify live sync | External |
| No Resend API key | Cannot verify live send | External |

None of these block writing the integration code, its tests, or the
unconfigured-state handling.

## Material architectural decisions

- **Engagements are rows, not a contact column.** One contact holds many
  concurrent engagements (donor + volunteer + partner), each with its own
  status, owner and history. A partial unique index allows one *live*
  engagement per type while retaining ended ones as history.
- **One unified `activities` table** backs the timeline. Gifts, pipeline stage
  moves, follow-ups, lead submissions and Mailchimp events all write here via
  triggers or sync code, so the timeline is complete by construction.
- **`dedupe_key` is the idempotency backbone.** A partial unique index on
  `activities.dedupe_key` (and equivalents on leads, gifts, contacts,
  Mailchimp activity) means replaying any sync or import is a no-op.
- **Giving is gated separately** from the rest of the CRM via
  `can_view_giving()`; the rollup view sets `security_invoker = on` so it
  cannot become a side door around the `gifts` policy.
- **`anon` gets no table privileges at all.** Public traffic reaches the
  database only through the service-role lead-intake route.
- **Email is deliberately not unique on contacts** — households legitimately
  share an address. Duplicate detection happens at import time instead of as a
  constraint that would reject real data.
- **PGlite for database tests.** No Docker daemon is available in this
  environment, so the RLS suite runs against Postgres compiled to WASM rather
  than a Supabase container. Same policies, same roles, genuinely executed.

## Database migrations

| File | Contents |
| --- | --- |
| `20260805000100_foundation.sql` | extensions, enums, `set_updated_at`, email/phone normalisation |
| `20260805000200_profiles.sql` | profiles, auth helpers, provisioning + privilege-protection triggers |
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
| Supabase | Schema complete; client layer pending | Blocked (no project) |
| Mailchimp | Pending | Blocked (no key) |
| Resend | Pending | Blocked (no key) |

## Tests

**Passing:** 43 (`db` project)
- `tests/db/migrations.test.ts` — 9 tests: schema shape, RLS coverage,
  `security_invoker` on views, pinned `search_path` on definer functions,
  idempotency indexes, reference data, re-apply idempotence.
- `tests/db/rls.test.ts` — 34 tests: anonymous denial, deactivated users,
  viewer read-only, staff write scope, admin-only deletes, giving gate
  (including the summary view), privilege-escalation reverts, last-admin
  protection, follow-up ownership, integration tables read-only, notification
  outbox visibility, service-role bypass.

**Failing:** none.

**Pre-existing failures:** none (greenfield repository).

## Last successful validation commands

```
npx vitest run --project db     # 43 passed
npx tsc --noEmit                # clean
npx eslint .                    # clean
```

## External setup still required

1. Create a Supabase project, apply `supabase/migrations`, set
   `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
   `SUPABASE_SERVICE_ROLE_KEY`.
2. Mailchimp Marketing API key + server prefix.
3. Resend API key, verified sender, internal recipient list.

## Definition of Done checklist

- [x] Supabase schema represented by migrations
- [x] Row Level Security implemented and verified
- [x] Contacts support multiple engagements (schema)
- [ ] Authentication and protected routing
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
- [ ] Imports and exports, incl. Salesforce migration export
- [ ] Documentation complete
- [x] `.env.example` complete, no secrets
- [x] TypeScript checks pass
- [x] Linting passes
- [ ] Production build passes
- [ ] Critical workflows browser-tested
- [ ] Responsive + keyboard accessible
- [x] No secrets committed
