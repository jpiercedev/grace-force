# Production rollout — Grace Lead Manager

> The ordered plan for taking `claude/grace-lead-management-rebrand-f86mf8`
> (the rename, the Sales section, staff-managed pipelines and shared team
> visibility) live on top of the currently deployed
> `claude/donor-crm-hubspot-redesign-smpmo4` @ `0e078c9`.

**State when this branch was cut:** production (Supabase project
`phhkhvewcclzjkdbjmqw`, Vercel project `grace-force`) runs the HubSpot-style
redesign at `0e078c9` with migrations through `20260806000800` applied. The
ninth migration of the previous release, `20260806000900_anon_privilege_lockdown`,
**may still be pending** — verify first, apply it first. This release then adds
four more migrations, `20260814000100`–`20260814000400`.

The order matters, same reasoning as the last release: every schema change is
additive (new enum label, new nullable columns, replaced policies, new seeded
rows), so the running production build keeps working after the migrations are
applied; the new build must not go first, because it selects columns
(`pipeline_cards.next_step`, `pipeline_stages.archived_at`) that would not
exist yet.

## 0. Confirm the starting state

```bash
supabase migration list --linked
```

Expect everything through `20260806000800` applied. If `20260806000900` is
unapplied, it goes first (it is part of this push anyway — filename order
already sequences it before the `20260814` files).

## 1. Dry-run and apply the migrations

```bash
supabase db push --linked --dry-run
# Must list ONLY: 20260806000900 (if still pending) and
# 20260814000100, 20260814000200, 20260814000300, 20260814000400 — in that order.
supabase db push --linked
```

| Migration | What it does to the live database |
| --- | --- |
| `20260806000900_anon_privilege_lockdown` | strips hosted `anon` grants, seals postgres-owned default ACLs (previous release's pending tail) |
| `20260814000100_sales_enums` | `pipeline_card_status` gains `archived` — pure enum addition |
| `20260814000200_configurable_pipelines` | adds `pipeline_cards.organization_name`/`next_step` and `pipeline_stages.archived_at` (all nullable, no rewrite); replaces pipeline/stage write policies (admin → staff); installs the four delete/archive guard triggers (non-empty pipelines/stages refuse deletion, stages with open cards refuse archiving, archived stages refuse receiving open cards) |
| `20260814000300_sales_reference_data` | seeds the General Sales and Relationship Development pipelines + stages; `on conflict do nothing`, so re-runs and re-deploys cannot duplicate |
| `20260814000400_shared_team_visibility` | replaces SELECT policies on gifts, contact_capability, proposals, activities, leads and call_reports with `is_active_user()`; drops the giving-flag condition from capability/proposal writes |

No table is dropped, no row is rewritten, no id changes. Existing pipeline
cards keep their ids, stages and history — the sales model *is* the existing
card model with new nullable columns.

## 2. Verify the migrations before deploying the app

```sql
-- Enum gained the label
select enumlabel from pg_enum e join pg_type t on t.oid = e.enumtypid
 where t.typname = 'pipeline_card_status' order by enumsortorder;
-- open, won, lost, archived

-- New columns exist and are all NULL (nothing rewritten)
select count(*) from public.pipeline_cards where next_step is not null;      -- 0
select count(*) from public.pipeline_stages where archived_at is not null;   -- 0

-- Seeds landed exactly once
select slug from public.pipelines order by sort_order;
-- supporter_journey, major_gift, volunteer_onboarding, general_sales, relationship_development
select count(*) from public.pipelines where is_default;                       -- 1

-- Guard triggers present
select tgname from pg_trigger where tgname like '%prevent%';
-- pipelines_prevent_delete_with_cards, pipeline_stages_prevent_delete_with_cards,
-- pipeline_stages_prevent_archive_with_open_cards, pipeline_cards_prevent_archived_stage

-- Shared visibility: policies now use is_active_user()
select tablename, policyname from pg_policies
 where policyname in ('gifts_select','proposals_select','contact_capability_select',
                      'activities_select','leads_select','call_reports_select');

-- Existing cards survived, count unchanged from before the push
select count(*) from public.pipeline_cards;
```

Then re-run the Supabase advisors (security + performance) and compare against
the accepted findings in `IMPLEMENTATION_STATUS.md`. The three new
`prevent_*` trigger functions must not be EXECUTE-able by `anon`/`authenticated`
(the migration revokes this; the db test suite asserts it).

## 3. Environment variables

**No new variables.** Optional cosmetic change: the `RESEND_FROM_EMAIL`
display name still reads "Grace Force CRM" in Vercel — update it to
`Grace Lead Manager <…>` at any convenient moment (it is runtime-read by
the notification worker, not build-inlined).

## 4. Deploy the application

Point the Vercel production branch at
`claude/grace-lead-management-rebrand-f86mf8` (or merge this branch into the
current production branch per repo convention) and let the git integration
build. Confirm the build completes with the expected route count and that
`/sales`, `/sales/new`, `/sales/pipelines` and `/sales/pipelines/[slug]`
appear in the route list.

## 5. Smoke tests

- `/login` renders the Grace “G” mark and the "Grace Lead Manager"
  wordmark; browser tab shows the new title and favicon; no console errors.
- Signed in as a **staff** account: Sales appears in the rail; `/sales` lists
  open opportunities; the board at `/pipelines/general_sales` renders;
  `/sales/pipelines` shows five pipelines.
- Move a card between stages on a board; confirm exactly one
  `pipeline_stage_changed` timeline entry (triggers unchanged — no
  double-posting).
- As a staff account **without** the old giving flag: Giving and Planned
  gifts destinations are visible and populated.
- As a **viewer**: every destination readable, zero write affordances, the
  lead queue visible but not triageable.
- `/intake` still renders and submits (service-role path untouched).
- Security headers unchanged (`curl -sI https://<origin>/login`).

## 6. Rollback

- **Application**: instant — promote the previous Vercel deployment
  ("Instant Rollback"). The old build runs correctly against the migrated
  database: the new enum label, nullable columns, seeded pipelines and wider
  SELECT policies are all invisible to it (it never queries the new columns,
  and wider read policies only *add* rows it already knows how to render;
  the two new pipelines simply appear on its Pipelines index).
- **Database — shared visibility**: to restore the giving partition and
  owner-scoped drafts, re-create the previous policies (they are preserved
  verbatim in git history in `20260805000800_gifts.sql`,
  `20260806000200_contact_profile.sql`, `20260806000400_proposals.sql`,
  `20260805000900_leads.sql`, `20260806000500_call_reports.sql`):

  ```sql
  -- gifts / capability / proposals back behind the flag
  drop policy gifts_select on public.gifts;
  create policy gifts_select on public.gifts
    for select to authenticated using (public.can_view_giving());
  -- …and equivalently for contact_capability_select, proposals_select,
  -- the capability/proposal write policies (add `and public.can_view_giving()`),
  -- activities_select (the four-type carve-out), leads_select (can_write()),
  -- call_reports_select (filed-or-author-or-admin).
  ```

  `profiles.can_view_giving` and `public.can_view_giving()` were deliberately
  left in place, so this restores the exact prior behavior with no data work.
- **Database — pipeline management**: to return pipelines to admin-only
  management, re-create the four `is_admin()` policies from
  `20260805001600_policy_and_index_tuning.sql`. The guard triggers are pure
  safety and can stay under any policy regime. The two seeded pipelines can
  be archived from the UI (`is_active = false`) or left; deleting them
  requires them to be empty, by design.
- **Columns/enum**: leave `organization_name`, `next_step`, `archived_at` and
  the `archived` enum label in place on rollback — they are nullable, unused
  by the old build, and dropping an enum label is not supported by Postgres
  anyway. If any card was archived before rolling back, re-open it or accept
  that the old build shows it as neither open nor won/lost in its two count
  queries (it is filtered out of boards either way, since boards select
  `status = 'open'`).
- **Auth/session**: no auth, middleware or cookie changes — no session
  invalidation either way.
- Watch after deploy: Vercel runtime logs for PostgREST `42703`
  (undefined column — the build went out before the migrations) and `42501`
  (permission denied — a policy regression).
