# Production rollout — relationship-development schema + HubSpot-style redesign

> The ordered plan for taking the current feature branch to production.
> Nothing in this document has been executed against production: applying
> migrations and deploying both require explicit approval. Written 2026-08-13
> on `claude/donor-crm-hubspot-redesign-smpmo4`.

**State today:** production (Supabase project `phhkhvewcclzjkdbjmqw`, Vercel
project `grace-force`) runs the original 20-table schema with the 16
`20260805…` migrations applied. The application on this branch expects 29
tables plus the private `attachments` Storage bucket — the 8 `20260806…`
migrations below have **not** been applied to production. The redesign itself
adds no schema, no environment variables and no routes beyond this set.

The order matters: the schema is additive and the running production build
never queries the new tables, so migrations go first and are safe under the
old build; the new build must not go first, because it queries tables that
would not exist yet.

## 1. Apply the eight migrations, in filename order

Via `supabase db push` from this branch (the recorded migration versions on
the hosted project were previously realigned to filename prefixes, so push
will apply exactly these), or paste each into the SQL editor in order:

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

All are additive — no destructive statements, no rewrites of existing rows.

## 2. Storage bucket and policies

Created by `…000600` itself (guarded on `storage.buckets` existing, so it
works on hosted Supabase). Nothing to click in the dashboard, but confirm
after applying:

```sql
select count(*) from storage.buckets where id = 'attachments';        -- 1, public = false
select policyname from pg_policies
  where schemaname = 'storage' and tablename = 'objects';
-- attachments_read, attachments_write, attachments_remove
```

## 3. Environment variables

**No new variables are required by this release.** Verify the existing set on
Vercel (Production scope): `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`,
`NEXT_PUBLIC_SITE_URL`, `CRON_SECRET`. Still intentionally unset until their
integrations are turned on: `MAILCHIMP_API_KEY` (+ optional
`MAILCHIMP_AUDIENCE_ID`, `MAILCHIMP_SERVER_PREFIX`), `RESEND_API_KEY`,
`RESEND_FROM_EMAIL`, `NOTIFY_INTERNAL_EMAILS`, `LEAD_INTAKE_SECRET`.
Remember `NEXT_PUBLIC_*` values are inlined at build time — changing one
requires a redeploy, not a restart.

## 4. Verify the migrations before deploying the app

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

The old build keeps running untouched throughout — it never touches the new
tables.

## 5. Deploy the application

Merge/promote this branch per the repository's release convention and let the
Vercel git integration build, or `vercel deploy --prod` from CI. The build
must come from a commit that contains both the migrations and the redesign
(this branch). Confirm the deployment completes and the build log shows all
45 routes.

## 6. Smoke tests (unauthenticated)

- `/login` renders the bright centered card, no console errors.
- `/intake` renders and submits (rate limiter permitting) — it exercises the
  service-role path end to end.
- Security headers still present (`curl -sI https://<origin>/login`):
  `x-frame-options`, `x-content-type-options`, CSP, no `x-powered-by`.

## 7. Authenticated workflow tests

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

## 8. Attachment upload/download verification

The full manual script is in `IMPLEMENTATION_STATUS.md` § "Manual
verification, once the migrations are deployed". Short form: upload a small
PDF from a person's Files rail section → row appears with correct name/size;
`storage.objects` holds exactly one object whose `name` equals the row's
`storage_path` (contact-id-prefixed, no donor name); download link works and
expires after ~60s; a viewer sees the file but no Remove; Remove as uploader
deletes row *and* object; a 21MB file and a `.zip` are refused in-page with
no network request; a ~19MB file succeeds (proves both body-size ceilings).

## 9. Rollback considerations

- **Application**: instant — promote the previous Vercel deployment
  ("Instant Rollback"). The old build runs correctly against the migrated
  database because every change is additive; this is the primary, low-drama
  rollback path for any UI-level problem.
- **Database**: leave the new tables in place even if the app is rolled
  back — they are unreachable from the old build and empty (or nearly so).
  Dropping them is a last resort, in strict reverse order (`…000800` down to
  `…000100`), and destroys any attachments metadata/objects and development
  records created in the interim; export first if anything real was entered.
  The `attachments` bucket must be emptied before it can be dropped.
- **Auth/session**: no auth, middleware or cookie changes in this release —
  no session invalidation on either deploy or rollback.
- Watch after deploy: Vercel runtime logs for PostgREST `42P01`
  (missing-table — would indicate the build went out before the migrations)
  and storage 4xx on `/storage/v1/object` (policy problems).
