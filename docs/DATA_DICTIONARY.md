# Data dictionary

A reference for the CRM's own entities and the columns its exports produce.
Written for whoever needs to reason about the data without reading the schema —
a staff member auditing an export, or a developer joining the project.

Supabase Postgres is the permanent system of record. Exports exist so the
organisation owns its data and can analyse it elsewhere, not because the data
lives anywhere else.

## Entities

### Contact

A person or organisation the ministry is in relationship with. Holds identity
and reachability only — what someone *is* to the ministry is expressed as
engagements, because one person is often several things at once.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | uuid | Primary key. Stable for the life of the record. |
| `first_name`, `last_name`, `preferred_name` | text | At least one name or an organisation is required. |
| `full_name` | text | Generated from first + last. Never written directly. |
| `email`, `secondary_email` | text | Not unique — households legitimately share an address. |
| `email_normalized` | text | Generated: lowercased and trimmed. The matching key. |
| `phone`, `mobile_phone` | text | |
| `phone_normalized` | text | Generated: digits only, keeping a leading `+`. |
| `address_line1/2`, `city`, `region`, `postal_code`, `country` | text | |
| `organization_name`, `job_title` | text | Affiliation, e.g. a partner church. |
| `lifecycle_stage` | enum | `prospect`, `engaged`, `active`, `lapsed`, `archived`. |
| `status` | enum | `active`, `inactive`, `archived`. |
| `source` | enum | `manual`, `web_form`, `event`, `referral`, `import`, `mailchimp`, `giving_platform`, `other`. |
| `owner_id` | uuid → profile | The staff member responsible for the relationship. |
| `do_not_contact`, `do_not_email` | boolean | Communication preferences. |
| `tags` | text[] | Free-form labels. |
| `external_source`, `external_id` | text | Natural key from wherever the record came from. Unique together. |
| `last_activity_at` | timestamptz | Maintained by trigger; never rewinds. |
| `deleted_at` | timestamptz | Soft delete. A contact carries years of history worth keeping. |

### Engagement

One contact's participation in one kind of relationship. **A contact may hold
several at once**, and each has its own status, owner and dates.

Seeded kinds: donor, volunteer, prayer partner, event attendee, partner church,
small group, newsletter, staff/team.

| Field | Type | Notes |
| --- | --- | --- |
| `contact_id` | uuid → contact | |
| `engagement_type_id` | uuid → engagement type | |
| `status` | enum | `prospect`, `active`, `paused`, `lapsed`, `ended`. |
| `started_on`, `ended_on` | date | `ended` requires an end date; any other status forbids one. |
| `role_detail` | text | e.g. "Worship team", "Monthly partner". |
| `owner_id` | uuid → profile | |

One *live* engagement per type per contact; ended ones remain as history, so
someone who volunteered, stopped, and returned has two rows and a real story.

### Activity

The unified timeline. Everything that happens to a relationship lands here:
notes, calls, meetings, pipeline moves, gifts, follow-ups, lead submissions,
Mailchimp opens and clicks.

Most entries are written by database triggers rather than application code,
which is what makes the timeline complete by construction.

| Field | Type | Notes |
| --- | --- | --- |
| `contact_id` | uuid → contact | |
| `type` | enum | See the migration for the full list. |
| `direction` | enum | `inbound`, `outbound`, `internal`. |
| `source` | enum | `manual`, `system`, `mailchimp`, `import`, `lead_form`. |
| `subject`, `body` | text | |
| `occurred_at` | timestamptz | When it happened, not when it was recorded. |
| `actor_id` / `actor_label` | uuid → profile / text | A person, or a system name for machine events. |
| `dedupe_key` | text | Unique when present. Makes replaying a sync inert. |

### Follow-up

Something owed to a contact, as distinct from something that already happened.

| Field | Type | Notes |
| --- | --- | --- |
| `title`, `details` | text | |
| `due_at`, `remind_at` | timestamptz | `remind_at` defaults to `due_at`. |
| `priority` | enum | `low`, `normal`, `high`, `urgent`. |
| `status` | enum | `open`, `completed`, `cancelled`. Completion requires `completed_at`. |
| `assigned_to`, `created_by`, `completed_by` | uuid → profile | |
| `reminder_sent_at` | timestamptz | Set by the reminder job. |

### Pipeline, stage, card

Configurable staged processes. A card is one contact's journey through one
pipeline; a composite foreign key makes it structurally impossible for a card to
reference a stage from a different pipeline.

Money on a card is `value_cents` — integer minor units, never floating point.

### Gift

Giving history, mirrored from the giving platform. Visible only to admins and
staff explicitly granted `can_view_giving`.

| Field | Type | Notes |
| --- | --- | --- |
| `amount_cents` | bigint | Integer minor units. Must be positive. |
| `currency` | text | ISO 4217, three uppercase letters. |
| `given_on` | date | |
| `method` | enum | `cash`, `check`, `card`, `ach`, `stock`, `in_kind`, `other`. |
| `fund`, `campaign` | text | Designation. |
| `external_source`, `external_id` | text | Unique together — re-imports update rather than duplicate. |

### Lead

An inbound enquiry from a public form, pending triage. Converting one creates or
enriches a contact atomically via the `convert_lead` function.

Client IPs are stored only as a salted hash, never in the raw.

### Profile

A CRM team member, mirroring `auth.users`. Carries `role`
(`admin` / `staff` / `viewer`), `can_view_giving` and `is_active`.

## Exports

Every export runs as the signed-in user, so Row Level Security applies exactly
as it does in the interface. An export can never contain rows the person could
not already see: viewers get no leads, staff without giving access get no gifts,
and soft-deleted contacts are excluded.

### Stable identifiers

Each exported row carries its `id` — the CRM's own uuid, stable for the life of
the record — and child rows carry their parent's id in a `*_id` column:

| Export | Identifier | References |
| --- | --- | --- |
| `contacts` | `id` | — |
| `engagements` | `id` | `contact_id` |
| `activities` | `id` | `contact_id`, `engagement_id` |
| `follow_ups` | `id` | `contact_id`, `engagement_id` |
| `gifts` | `id` | `contact_id` |
| `pipeline_cards` | `id` | `contact_id`, `engagement_id` |

This is ordinary good design rather than preparation for any particular
destination: it means an export can be re-imported without duplicating, joined
correctly in a spreadsheet or analysis tool, and reconciled against a later
export of the same data.

### Format notes

- **Money** appears both as integer cents and as a decimal column, so a
  spreadsheet reads it correctly without a lossy conversion.
- **Timestamps** are ISO 8601 with timezone.
- **Tags** are semicolon-separated.
- **Free text** is CSV-quoted; embedded commas, quotes and newlines round-trip
  intact. This is covered by tests, because it is the classic way a data export
  corrupts silently.

### Import

CSV import is two-phase: an upload is parsed and validated into staging rows and
shown as a preview (how many would be created, updated, skipped, and why each
error row failed), and only then committed. Rows carrying
`(external_source, external_id)` upsert, so re-importing the same file a second
time changes nothing.
