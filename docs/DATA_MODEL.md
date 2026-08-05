# Data model

The schema lives in `supabase/migrations/`. This document explains the shape and
the reasoning behind the decisions that are not obvious from the DDL.

## The central idea: engagements, not contact types

A sales CRM asks "is this a lead or a customer?". A ministry cannot answer that,
because the same person is frequently several things at once — a monthly donor,
a volunteer team lead, and the liaison at a partner church — and each of those
relationships has its own owner, its own status and its own history.

So `contacts` holds identity and reachability only. Everything relational lives
in `engagements`:

```
contacts 1 ──── * engagements * ──── 1 engagement_types
```

A partial unique index allows **one live engagement per type per contact**:

```sql
create unique index engagements_one_live_per_type
  on public.engagements (contact_id, engagement_type_id)
  where status <> 'ended';
```

Ended engagements are retained, so someone who volunteered in 2024, stopped, and
returned in 2026 has two rows and a real history — rather than one row whose
past has been overwritten.

A check constraint keeps `status` and `ended_on` honest: `ended` requires a date,
anything else forbids one.

## The unified timeline

`activities` is a single append-only table that every other part of the system
writes into. Notes and calls logged by staff, pipeline stage moves, gifts,
follow-up completions, lead conversions and Mailchimp opens all land here.

Most of those are written by **database triggers**, not application code:

| Trigger on | Writes |
| --- | --- |
| `engagements` insert / status change | `engagement_started`, `engagement_changed` |
| `pipeline_cards` insert / stage change / close | `pipeline_card_created`, `pipeline_stage_changed`, `pipeline_card_closed` |
| `follow_ups` insert / completion | `follow_up_created`, `follow_up_completed` |
| `gifts` insert | `gift_recorded` |
| `contacts` owner change | `assignment_changed` |

That makes the timeline complete *by construction*. A future code path that
forgets to log still produces a correct timeline, and there is exactly one
implementation of each event rather than one per caller.

The corollary, which matters when writing features: **application code must not
also insert these activities**, or every event double-posts.

`contacts.last_activity_at` is maintained by an `AFTER INSERT` trigger on
`activities` so "recently touched" sorting does not require an aggregate.

## Idempotency

Anything ingested from outside the app carries a natural key, so replaying is a
no-op rather than a duplicate:

| Table | Key |
| --- | --- |
| `activities` | `dedupe_key`, unique when present |
| `leads` | `dedupe_key`, unique when present |
| `notifications` | `dedupe_key`, unique — *claimed before sending* |
| `contacts`, `engagements`, `gifts` | `(external_source, external_id)` |
| `mailchimp_members` | `(audience_id, mailchimp_member_id)` and `(audience_id, email_normalized)` |
| `mailchimp_campaign_activity` | `dedupe_key` |

`dedupe_key` is nullable and only unique when present, so manually logged
activities are free to repeat — two phone calls on the same day are two events,
not a duplicate.

## Email is deliberately not unique

Households share an email address. Making `contacts.email` unique would reject
real, correct data — a married couple, or a parent handling a teenager's
registration.

Instead there is a generated `email_normalized` column
(`lower(btrim(email))`, `NULL` when blank) with a plain index. Matching is a
*policy*, applied consistently by the app: pick the oldest non-deleted contact
with that normalised email, so the choice is deterministic. Duplicate detection
happens at import time, where a human can adjudicate.

The same generated-column treatment applies to `phone_normalized`
(digits only, keeping a leading `+`), used for duplicate detection.

## Search

`contacts.search_vector` is a stored generated `tsvector` with weighted
sections — names (A), contact details (B), affiliation (C), notes (D) — backed
by a GIN index. Names and emails use the `simple` configuration (no stemming, so
"Hopper" is not conflated with "hop"); notes use `english`.

Full-text search cannot answer prefix queries, so `pg_trgm` GIN indexes on
`lower(full_name)` and `lower(email)` back the "user has typed three characters"
case. The search code uses full text first and falls back to trigram/`ilike`.

## Money

Every monetary column is `bigint` in **minor units** (`amount_cents`,
`value_cents`). Floating-point money accumulates error and eventually produces a
receipt that disagrees with the bank.

`contact_giving_summary` aggregates per contact (totals, first/last gift, YTD,
trailing twelve months). It is declared `security_invoker = on` so the `gifts`
RLS policy still applies — otherwise the view would hand giving totals to every
authenticated user.

## Pipelines

```
pipelines 1 ── * pipeline_stages
pipelines 1 ── * pipeline_cards * ── 1 contacts
```

`pipeline_cards` references its stage with a **composite foreign key**
`(stage_id, pipeline_id) → pipeline_stages (id, pipeline_id)`, which makes it
structurally impossible for a card to point at a stage belonging to a different
pipeline. A unique index permits one open card per `(pipeline, contact)`.

Check constraints tie `status` to `closed_at` in both directions, so a "won"
card always records when it was won.

## Soft deletes

`contacts.deleted_at` is a soft delete: a contact carries years of history and
hard-deleting one discards the record of a relationship. Queries filter
`deleted_at is null`. Only admins may hard-delete.

## Reference data

`engagement_types`, `pipelines` and `pipeline_stages` ship as a migration rather
than a seed script because the application depends on specific slugs — lead
intake maps a form's `interest` onto an engagement type, the Mailchimp sync
looks up `newsletter`, and the default pipeline backs the "add to pipeline"
action. Every insert is `on conflict do nothing`, so operator customisations
survive re-running it.

## Migration order

| File | Contents |
| --- | --- |
| `…000100_foundation` | extensions, enums, `set_updated_at`, email/phone normalisation |
| `…000200_profiles` | profiles, auth helpers, provisioning + privilege triggers |
| `…000300_contacts` | contacts, search vector, trigram indexes |
| `…000400_engagements` | engagement types and engagements |
| `…000500_pipelines` | pipelines, stages, cards |
| `…000600_activities` | unified timeline and the auto-logging triggers |
| `…000700_follow_ups` | follow-ups and reminder bookkeeping |
| `…000800_gifts` | gifts and the giving summary view |
| `…000900_leads` | leads, rate limiter, `convert_lead()` |
| `…001000_mailchimp` | audiences, members, campaigns, activity, sync runs |
| `…001100_notifications` | notification outbox |
| `…001200_imports` | import batches and rows |
| `…001300_reference_data` | engagement types, pipelines, stages |
| `…001400_grants` | role grants |

They must be applied in filename order; later files reference earlier tables.
