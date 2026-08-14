# Production rollout — relationship-development schema + HubSpot-style redesign

> The ordered, production-verified plan for taking the current feature branch
> live. Audited 2026-08-14 on
> `claude/donor-crm-hubspot-redesign-smpmo4`.

**State today:** production (Supabase project `phhkhvewcclzjkdbjmqw`, Vercel
project `grace-force`) has the first eight `20260806…` schema migrations
applied, adding the 29-table schema and private `attachments` Storage bucket.
Post-push verification found hosted default-ACL drift, so the ninth migration
below must lock down anonymous privileges before the redesigned application is
deployed. The redesign itself adds no schema, no environment variables and no
routes beyond this set.

The order matters: the schema is additive and the running production build
never queries the new tables, so migrations go first and are safe under the
old build; the new build must not go first, because it queries tables that
would not exist yet.

## 1. Reconcile the two existing migration-history versions

The hosted schema already contains the changes from the final two `20260805`
migrations, but its history records were created with dashboard timestamps:

| Hosted history | Matching repository file |
| --- | --- |
| `20260805215759` | `20260805001500_function_execute_grants.sql` |
| `20260805215942` | `20260805001600_policy_and_index_tuning.sql` |

The function grants, replacement policies, and indexes were compared against
production and are schema-equivalent. Repair **history only** before pushing;
do not replay either migration and do not use `--include-all`:

```bash
supabase migration repair 20260805215759 20260805215942 --status reverted --linked
supabase migration repair 20260805001500 20260805001600 --status applied --linked
supabase migration list --linked
supabase db push --linked --dry-run
```

The initial dry run must list only `20260806000100` through `20260806000900`.
After the first eight have been applied, a repeat dry run must list only
`20260806000900`. Stop if it lists any `20260805` migration.

## 2. Apply the nine migrations, in filename order

After the exact dry-run check, use `supabase db push --linked` from this
branch. The pending migration files include the pre-deploy security hardening
for giving activity visibility, function execution, attribution integrity,
and attachment ownership/type/size enforcement.

| Migration | Adds |
| --- | --- |
| `20260806000100_relationship_enums.sql` | enums for relationships, interests, capability, events, proposals, call reports |
| `20260806000200_contact_profile.sql` | communication preferences on `contacts`; `contact_relationships`, `interest_areas`, `contact_interests`, `contact_capability` |
| `20260806000300_events.sql` | `events`, `event_attendees` |
| `20260806000400_proposals.sql` | `proposals` (planned gifts) |
| `20260806000500_call_reports.sql` | `call_reports` |
| `20260806000600_attachments.sql` | `attachments` + the **`attachments` Storage bucket and its three policies** |
| `20260806000700_activity_outcome.sql` | `outcome` on `activities`; new activity enum values |
| `20260806000800_call_report_joint_donor.sql` | joint-donor column on `call_reports` |
| `20260806000900_anon_privilege_lockdown.sql` | removes hosted `anon` relation grants and locks future table, sequence, and function defaults |

The rollout adds tables, enum values, policies, triggers, and columns. It does
not drop data or rewrite existing rows; the activity read policy is tightened
to close an existing giving-metadata leak.

## 3. Storage bucket and policies

Created by `…000600` itself (guarded on `storage.buckets` existing, so it
works on hosted Supabase). Nothing to click in the dashboard, but confirm
after applying:

```sql
select id, public, file_size_limit, allowed_mime_types
  from storage.buckets where id = 'attachments';
-- 1 row, public = false, file_size_limit = 20971520, strict MIME allowlist
select policyname from pg_policies
  where schemaname = 'storage' and tablename = 'objects';
-- attachments_read, attachments_write, attachments_remove
```

## 4. Environment variables

**No new variables are required by this release.** Verify the existing set on
Vercel (Production scope): `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
`NEXT_PUBLIC_SITE_URL`, `CRON_SECRET`. Still intentionally unset until their
integrations are turned on: `MAILCHIMP_API_KEY` (+ optional
`MAILCHIMP_AUDIENCE_ID`, `MAILCHIMP_SERVER_PREFIX`), `RESEND_API_KEY`,
`RESEND_FROM_EMAIL`, `NOTIFY_INTERNAL_EMAILS`, `LEAD_INTAKE_SECRET`.
Remember `NEXT_PUBLIC_*` values are inlined at build time — changing one
requires a redeploy, not a restart.

## 5. Verify the migrations before deploying the app

```sql
-- 29 tables, all with RLS
select count(*) from pg_tables where schemaname = 'public';                       -- 29
select count(*) from pg_tables where schemaname = 'public' and rowsecurity;       -- 29
-- the nine new tables exist
select table_name from information_schema.tables where table_schema = 'public'
  and table_name in ('contact_relationships','interest_areas','contact_interests',
  'contact_capability','events','event_attendees','proposals','call_reports','attachments');
-- interest areas seeded
select count(*) from public.interest_areas;                                        -- > 0
-- definer functions still pin search_path (expect none returned)
select proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.prosecdef
  and not coalesce(p.proconfig, '{}') && array['search_path=""','search_path='];
```

Then run the Supabase advisors (security + performance) and compare against
the accepted findings recorded in `IMPLEMENTATION_STATUS.md`.

Also verify that `anon` cannot execute public functions or use public tables,
that the new trigger functions are not RPC-executable by `authenticated`, and
that attachment object deletion requires uploader ownership or admin access.

```sql
-- Both counts must be 0.
select count(*) from information_schema.role_table_grants
 where grantee = 'anon' and table_schema = 'public';
select count(*) from information_schema.role_usage_grants
 where grantee = 'anon' and object_schema = 'public';
-- Inspect postgres-owned defaults: no anon table/sequence grants and no
-- PUBLIC/anon/authenticated function EXECUTE grants may remain.
select defaclobjtype, defaclacl from pg_default_acl d
 join pg_roles r on r.oid = d.defaclrole
 where r.rolname = 'postgres';
```

The old build keeps running untouched throughout — it never touches the new
tables.

## 6. Deploy the application

Merge/promote this branch per the repository's release convention and let the
Vercel git integration build, or `vercel deploy --prod` from CI. The build
must come from a commit that contains both the migrations and the redesign
(this branch). Confirm the deployment completes and the build log shows all
45 routes.

## 7. Smoke tests (unauthenticated)

- `/login` renders the bright centered card, no console errors.
- `/intake` renders and submits (rate limiter permitting) — it exercises the
  service-role path end to end.
- Security headers still present (`curl -sI https://<origin>/login`):
  `x-frame-options`, `x-content-type-options`, CSP, no `x-powered-by`.

## 8. Authenticated workflow tests

From a machine with normal egress:

```bash
E2E_BASE_URL=https://grace-force.vercel.app E2E_EMAIL=… E2E_PASSWORD=… npm run e2e
```

Then a manual pass as a staff account through the new surfaces:

1. **Shell**: light sidebar shows Dashboard, People, Follow-ups, Planned
   gifts, Events, Call reports + the More group; selected states correct.
2. **People**: search, filters, Name / Last activity sorting, pagination; row
   preview opens the side panel, Escape closes it, quick actions work.
3. **Donor record**: three zones render; About channels are tappable and
   respect do-not flags; Overview / Activity / Planned gifts / Giving /
   Events tabs all load; quick activity bar logs a note (dialog pre-selected
   correctly); association rail add/remove for a relationship, an event
   attendance, an interest.
4. **Work**: complete + snooze a follow-up; move a pipeline card; file a call
   report draft; create a planned gift and change its stage.
5. **Roles**: as a viewer, no write affordances anywhere; as a
   non-giving-visible account, Planned gifts/Giving tabs and the nav entries
   are absent.

## 9. Attachment upload/download verification

The full manual script is in `IMPLEMENTATION_STATUS.md` § "Manual
verification, once the migrations are deployed". Short form: upload a small
PDF from a person's Files rail section → row appears with correct name/size;
`storage.objects` holds exactly one object whose `name` equals the row's
`storage_path` (contact-id-prefixed, no donor name); download link works and
expires after ~60s; a viewer sees the file but no Remove; Remove as uploader
deletes row *and* object; a 21MB file and a `.zip` are refused in-page with
no network request; a ~19MB file succeeds (proves both body-size ceilings).

## 10. Rollback considerations

- **Application**: instant — promote the previous Vercel deployment
  ("Instant Rollback"). The old build runs correctly against the migrated
  database because every change is additive; this is the primary, low-drama
  rollback path for any UI-level problem.
- **Database**: leave the new tables in place even if the app is rolled
  back — they are unreachable from the old build and empty (or nearly so).
  Dropping them is a last resort, in strict reverse order (`…000900` down to
  `…000100`), and destroys any attachments metadata/objects and development
  records created in the interim; export first if anything real was entered.
  The `attachments` bucket must be emptied before it can be dropped.
- **Auth/session**: no auth, middleware or cookie changes in this release —
  no session invalidation on either deploy or rollback.
- Watch after deploy: Vercel runtime logs for PostgREST `42P01`
  (missing-table — would indicate the build went out before the migrations)
  and storage 4xx on `/storage/v1/object` (policy problems).
