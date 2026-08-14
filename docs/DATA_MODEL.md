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

## Pipelines and sales opportunities

```
pipelines 1 ── * pipeline_stages
pipelines 1 ── * pipeline_cards * ── 1 contacts
```

A `pipeline_card` **is** a sales opportunity — there is deliberately no second
"opportunities" table. When the product grew a general Sales section
(migrations `20260814…`), the existing card model was generalized instead:
cards gained `organization_name` (free text, defaulted in the UI from the
contact but independent of it) and `next_step` (the board-visible one-liner;
dated, assignable work stays in `follow_ups`), and `pipeline_card_status`
gained `archived` alongside `open`/`won`/`lost`. Every pre-existing card, its
id, stage and timeline history carried forward unchanged.

`pipeline_cards` references its stage with a **composite foreign key**
`(stage_id, pipeline_id) → pipeline_stages (id, pipeline_id)`, which makes it
structurally impossible for a card to point at a stage belonging to a different
pipeline. A unique index permits one open card per `(pipeline, contact)` —
archiving a card frees the slot without deleting the history.

Check constraints tie `status` to `closed_at` in both directions, so a "won"
card always records when it was won (and an archived one when it was shelved).

**Pipelines are team-editable structure, not fixtures.** Active staff may
create, rename, reorder, archive and (when empty) delete pipelines and stages
from Sales → Manage pipelines. Four guard triggers make the destructive paths
safe at the database rather than in the application, because the FK from cards
is `on delete cascade` and a buggy DELETE must not take opportunities with it:

- a pipeline that still holds any card refuses deletion, for every role;
- a stage that still holds any card refuses deletion;
- a stage with *open* cards refuses archiving (`pipeline_stages.archived_at`);
- an archived stage refuses *receiving* an open card — the mirror image, so a
  stale board form cannot strand a live opportunity in a hidden column.

Archiving is therefore the safe default everywhere; deletion is only reachable
once a pipeline or stage is genuinely empty.

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
| `20260806000100_relationship_enums` | enums for the development domain, plus the `activity_type` additions |
| `…000200_contact_profile` | communication preferences, interests, related constituents, capability |
| `…000300_events` | events, attendance, attendance trigger |
| `…000400_proposals` | proposals and planned gifts, stage triggers |
| `…000500_call_reports` | donor meeting reports, filing trigger |
| `…000600_attachments` | attachment metadata and the storage bucket |
| `…000700_activity_outcome` | `activities.outcome` |
| `…000800_call_report_joint_donor` | second donor on a call report |
| `20260806000900_anon_privilege_lockdown` | strips hosted `anon` grants, seals default ACLs |
| `20260814000100_sales_enums` | `pipeline_card_status` gains `archived` |
| `…000200_configurable_pipelines` | card `organization_name`/`next_step`, stage `archived_at`, staff-managed pipelines, delete/archive guard triggers |
| `…000300_sales_reference_data` | seeds General Sales + Relationship Development (idempotent) |
| `…000400_shared_team_visibility` | one shared workspace: SELECT opens to every active user |

They must be applied in filename order; later files reference earlier tables.

The enum file is separate from everything that uses it for a specific reason:
`alter type … add value` may run inside a transaction, but the new label cannot
be *used* until that transaction commits, and each migration file is applied as
one implicit transaction.

## Relationship development

Eight migrations (`20260806000100`–`20260806000800`) add the objects a
development office needs and the original schema had no home for. Three
decisions in them are worth stating, because the DDL alone does not explain
them.

### A relationship is one directed row, not a mirrored pair

`contact_relationships` stores a link once:

```
<from_contact> is the <kind> of <to_contact>
```

Standing on the `to` side, the other person *is* the kind ("Spouse",
"Referred by"); standing on the `from` side, they are its inverse ("Spouse",
"Referred"). `@/lib/relationships` holds the two label maps and a unit test
asserts they are exact inverses.

The alternative — writing both directions as two rows — allows the two halves
of a single fact to disagree with each other, and doubles every edit and
delete. Symmetric kinds (spouse, sibling, friend) simply name themselves in
both maps, so they need no special case anywhere.

### Capability and proposals are shared with the whole team (since 20260814000400)

Historically, capability estimates and proposals followed an opt-in giving
permission (`public.can_view_giving()`), which is why capability lives in its
own `contact_capability` table rather than as a column on `contacts` — a
column would have been legible to everyone who could read the person.

The shared-workspace decision (migration `20260814000400_shared_team_visibility`)
retired that partition: **every active authenticated user reads the same
business records** — gifts, capability, proposals, giving-typed activity rows,
leads and call-report drafts included. Ownership and attribution columns
(`owner_id`, `assigned_to`, `created_by`, `author_id`, `uploaded_by`) still
record responsibility, but none of them is a visibility boundary; assigning
work to someone else never hides the underlying record from the team.

Writes kept their role gates: viewers stay read-only, staff write shared
records (proposals and capability no longer require any flag), gift inserts
and hard deletes stay admin. `profiles.can_view_giving` and the
`can_view_giving()` helper remain **defined but unreferenced**, so the change
is cleanly reversible — the rollback in `docs/ROLLOUT.md` restores the old
policies without touching data. The separate-table shape of
`contact_capability` also keeps that door open.

### The new objects post to the timeline by trigger

`events` (attendance), `proposals` (created, stage changed, closed) and
`call_reports` (filed) each write their own `activities` rows, joining the
engagement, pipeline, follow-up and gift triggers that were already there. The
corollary is unchanged and now applies to five more code paths: **application
code must not also insert these activities**, or every event double-posts.

Attendance and filings carry a deterministic `dedupe_key`, so flipping a
record away from `attended` and back, or editing an already-filed report, does
not post a second entry.

### Two smaller trade-offs, recorded on purpose

- `proposals.joint_contact_id` and `call_reports.joint_contact_id` cover a
  couple giving, or being met, together. More than two parties belongs in the
  notes rather than in a join table with its own policies and its own UI.
- `call_reports.staff_attendee_ids` is a `uuid[]` with no foreign key —
  Postgres cannot declare one on an array element. The field is edited as one
  control and read as one line; ids that no longer resolve are simply not
  rendered, which is what `on delete set null` would have given anyway.

### Attachments

`attachments` holds metadata; the bytes live in the private `attachments`
storage bucket. `contact_id` is always set even when a file hangs off a call
report or a proposal — that denormalisation is what makes "every document on
this donor" one query. Downloads go through a 60-second signed URL minted per
request, so a link copied out of the page stops working quickly rather than
becoming a permanent unauthenticated handle on an estate document.

The bucket and its storage policies are created inside a guard that checks
`to_regclass('storage.buckets')`, so the migration still applies to a bare
Postgres — which is what the PGlite test harness is.
