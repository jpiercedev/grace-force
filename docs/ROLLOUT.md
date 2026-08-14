# Production rollout — Grace Lead Management

> The ordered production plan for the rebrand + Sales + shared-visibility
> release on `claude/grace-lead-management-rebrand-x2a0bf`. Nothing in this
> plan has been executed against production except where explicitly marked
> **already true**; the deploy steps are gated on explicit approval.

## State today

| Layer | State |
| --- | --- |
| Vercel production | `claude/donor-crm-hubspot-redesign-smpmo4` @ `0e078c9` (the HubSpot-style redesign) |
| Supabase (`phhkhvewcclzjkdbjmqw`) | All 29 migrations applied — including the four `20260814…` sales/visibility migrations |
| Data | 1 contact, 5 pipelines (3 original + 2 seeded), 27 stages, 0 opportunities, 0 gifts, 3 profiles |

**Already true:** the four schema migrations this release describes —
`20260814183037_sales_enums`, `…183153_configurable_pipelines`,
`…183201_sales_reference_data`, `…183353_shared_team_visibility` — were
applied to production on 2026-08-14 (they appear in
`supabase_migrations.schema_migrations`). This branch adds those files to the
repository **byte-identical to the applied history** (md5-verified), so
`supabase db push` considers them applied and a fresh environment converges
to the same schema. This release therefore ships **no new migrations**: the
production rollout is an application deploy.

That ordering is also why the current production build keeps working: the
schema changes are additive and policy-widening, and the old build simply
does not query the new columns. The old UI still hides giving from unflagged
staff — a cosmetic mismatch that disappears with this deploy.

## 1. Pre-deploy verification (read-only)

```bash
supabase migration list --linked   # must show 29 applied, ending at 20260814183353
supabase db push --linked --dry-run  # must report nothing to push
```

Stop if the dry run wants to apply anything.

```sql
-- The two seeded pipelines exist exactly once each
select slug, count(*) from public.pipelines
 where slug in ('general_sales','relationship_development') group by slug;
-- Guard triggers present
select tgname from pg_trigger where tgname in (
  'pipelines_prevent_delete_with_cards',
  'pipeline_stages_prevent_delete_with_cards',
  'pipeline_stages_prevent_archive_with_open_cards',
  'pipeline_cards_prevent_archived_stage');
-- Shared visibility in force (all four should read is_active_user())
select tablename, policyname, qual from pg_policies
 where policyname in ('gifts_select','proposals_select','leads_select','call_reports_select');
-- anon still holds nothing
select count(*) from information_schema.role_table_grants
 where grantee = 'anon' and table_schema = 'public';   -- 0
```

## 2. Deploy the application

Point the Vercel production branch at
`claude/grace-lead-management-rebrand-x2a0bf` (or merge this branch per the
repository's release convention) and let the git integration build. No
environment variable changes: the release adds none and changes none.

Confirm the build completes and the route list includes the `/sales` tree
(`/sales`, `/sales/opportunities`, `/sales/opportunities/[id]`, `/sales/new`,
`/sales/pipelines/[slug]`, `/sales/pipelines/[slug]/add`, `/sales/manage`,
`/sales/manage/[slug]`) alongside the `/pipelines` redirects.

## 3. Smoke tests (unauthenticated)

- `/login` shows the Grace G mark and "Grace Lead Management"; the tab title
  and favicon match.
- `/intake` renders branded as **Grace** (not the internal product name) and
  submits.
- Security headers still present (`curl -sI https://<origin>/login`):
  `x-frame-options`, `x-content-type-options`, HSTS, no `x-powered-by`.

## 4. Authenticated workflow pass

From a machine with normal egress:

```bash
E2E_BASE_URL=https://grace-force.vercel.app E2E_EMAIL=… E2E_PASSWORD=… npm run e2e
```

Then a manual pass as a staff account:

1. **Shell**: sidebar reads Dashboard · People · Sales · Follow-ups · Leads ·
   Events · Call reports, with Giving and Planned gifts under More; the Grace
   G wordmark tops the rail.
2. **Sales**: overview renders the figures band and both seeded boards; a
   board opens; create an opportunity from `/sales/new` and from a person's
   record; move it between stages; edit its next step; archive it.
3. **Manage pipelines**: create a pipeline, add stages, rename one, reorder
   with the arrows, archive a stage, archive the pipeline, restore it; try to
   delete a pipeline holding the test opportunity and read the refusal.
4. **Shared visibility**: as a second staff account *without* the old giving
   flag, open the same person — Giving and Planned gifts tabs are present and
   populated; the opportunity created above is visible and editable. As a
   viewer, everything above is readable and nothing offers a write control.
5. **Old links**: `/pipelines` and a bookmarked `/pipelines/<slug>` land on
   the Sales equivalents.

## 5. Watch after deploy

Vercel runtime logs for PostgREST `42P01`/`42501` (would indicate a query
against a missing table or a policy regression) and any spike in 500s on
`/sales/*` routes.

## 6. Rollback

- **Application**: instant — promote the previous production deployment
  (Vercel "Instant Rollback" to the `0e078c9` build). The old build runs
  correctly against the current database: every schema change is additive,
  and the wider read policies are invisible to it. This is the primary path
  for any UI-level problem.
- **Shared visibility** (policy-level rollback, only if the team decides the
  old giving partition must return): apply a reverse migration recreating the
  previous policies — `gifts_select`/`contact_capability_select`/
  `proposals_select` on `public.can_view_giving()`, the giving-typed
  `activities_select` carve-out, `leads_select` on `public.can_write()`, and
  the author-or-admin `call_reports_select`. `can_view_giving()` and
  `profiles.can_view_giving` were deliberately kept so this is one file with
  no data migration.
- **Configurable pipelines**: leave in place even if the app is rolled back —
  the guard triggers and new columns are inert under the old build. Removing
  them is a last resort: drop the four triggers and their functions, then the
  three added columns; the seeded pipelines can stay (the old build lists
  them) or be deleted only while they hold no cards.
- **Auth/session**: no auth, middleware or cookie changes in this release —
  no session invalidation on deploy or rollback.
