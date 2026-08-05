# Salesforce migration export

Exports the CRM as a set of related CSVs that can be loaded into Salesforce with
Data Loader (or any tool that supports external-id upsert) **without losing the
relationships between records**.

## The problem this solves

A naive export flattens everything or emits internal ids that mean nothing in
the target system. Loading it produces orphaned children: activities with no
contact, gifts attached to nobody.

Salesforce solves this with **external ids** — a field marked "External ID" that
holds the source system's key. During an upsert, a child row can reference its
parent by the parent's external id, and Salesforce resolves it to the real
Salesforce id at load time. The parent does not need to exist yet when the file
is generated; it only needs to be loaded first.

So every exported row carries its CRM uuid, and every child carries its parent's
CRM uuid.

## Files

Each dataset is exported separately:

| Order | File | Endpoint | External id | Parent references |
| --- | --- | --- | --- | --- |
| 1 | `contacts.csv` | `/api/export/salesforce/contacts` | `External_Id__c` | — |
| 2 | `engagements.csv` | `/api/export/salesforce/engagements` | `External_Id__c` | `Contact_External_Id__c` |
| 3 | `activities.csv` | `/api/export/salesforce/activities` | `External_Id__c` | `Contact_External_Id__c`, `Engagement_External_Id__c` |
| 4 | `follow_ups.csv` | `/api/export/salesforce/follow-ups` | `External_Id__c` | `Contact_External_Id__c`, `Engagement_External_Id__c` |
| 5 | `gifts.csv` | `/api/export/salesforce/gifts` | `External_Id__c` | `Contact_External_Id__c` |
| 6 | `pipeline_cards.csv` | `/api/export/salesforce/pipeline-cards` | `External_Id__c` | `Contact_External_Id__c`, `Engagement_External_Id__c` |
| — | `manifest.csv` | `/api/export/salesforce/manifest` | — | describes load order and field mapping |

`/export` lists them in order with download links.

## Load order

Load parents before children. Contacts must exist before anything that
references them, and engagements before rows scoped to an engagement:

```
contacts → engagements → activities, follow_ups, gifts, pipeline_cards
```

## Preparing Salesforce

For each target object, create a custom field of type **Text (255), External ID,
Unique** named `External_Id__c`. Then in Data Loader choose **Upsert** and select
that field as the match key.

For lookup fields (Contact, and Engagement if modelled as a custom object),
select the parent's `External_Id__c` as the relationship field so Data Loader
resolves the reference rather than expecting a Salesforce id.

## Why upsert rather than insert

Because migrations are never one pass. Using upsert on a stable external id
means the same file can be loaded twice — after fixing a field mapping, or after
a partial failure — and it updates rather than duplicating. The CRM uuids never
change, so a re-export months later still matches the same Salesforce records.

## Access control

Exports run as the signed-in user through `@/lib/supabase/server`, so Row Level
Security applies exactly as it does in the UI. An export can never contain rows
the person could not already see:

- viewers cannot export leads,
- staff without `can_view_giving` get no gift rows,
- soft-deleted contacts are excluded.

Exporting giving data therefore requires an admin or a staff member with giving
access, and the `/export` page says so rather than silently returning an empty
file.

## Data notes

- **Money** is exported in the CRM's canonical integer cents *and* as a decimal
  column, because Salesforce currency fields expect a decimal. Both are present
  so the load can use whichever the target field needs without a lossy
  conversion in a spreadsheet.
- **Timestamps** are ISO 8601 with timezone.
- **Tags** are semicolon-separated, since Salesforce multi-select picklists use
  that separator.
- **Free text** (activity bodies, lead messages, notes) is CSV-quoted; embedded
  commas, quotes and newlines round-trip correctly. This is covered by tests
  precisely because it is the classic way a migration corrupts silently.
- Rows are paged out of Postgres rather than loaded into memory at once, so a
  large export does not exhaust the server.

## Verifying an export

Two properties are asserted by the test suite and worth re-checking on real
data:

1. **Referential completeness** — every `Contact_External_Id__c` in a child file
   appears as an `External_Id__c` in `contacts.csv`.
2. **Stability** — exporting twice produces identical external ids, so a
   re-import updates rather than duplicating.
