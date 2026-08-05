-- ---------------------------------------------------------------------------
-- Advisor follow-up: overlapping policies and foreign-key indexes.
--
-- Two findings from Supabase's performance linter that are genuinely caused by
-- this schema, plus a note on the ones deliberately left alone.
-- ---------------------------------------------------------------------------

-- --- 1. Multiple permissive policies ---------------------------------------
--
-- `FOR ALL` covers SELECT too, so each admin-write policy sat alongside the
-- read policy and both were evaluated on every read. Splitting the write
-- policies into INSERT/UPDATE/DELETE leaves exactly one policy per
-- (role, action) while keeping the permission model identical.

drop policy if exists engagement_types_write on public.engagement_types;

create policy engagement_types_insert on public.engagement_types
  for insert to authenticated with check (public.is_admin());
create policy engagement_types_update on public.engagement_types
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy engagement_types_delete on public.engagement_types
  for delete to authenticated using (public.is_admin());

drop policy if exists pipelines_write on public.pipelines;

create policy pipelines_insert on public.pipelines
  for insert to authenticated with check (public.is_admin());
create policy pipelines_update on public.pipelines
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy pipelines_delete on public.pipelines
  for delete to authenticated using (public.is_admin());

drop policy if exists pipeline_stages_write on public.pipeline_stages;

create policy pipeline_stages_insert on public.pipeline_stages
  for insert to authenticated with check (public.is_admin());
create policy pipeline_stages_update on public.pipeline_stages
  for update to authenticated using (public.is_admin()) with check (public.is_admin());
create policy pipeline_stages_delete on public.pipeline_stages
  for delete to authenticated using (public.is_admin());

-- Two UPDATE policies on profiles (self-edit and admin-edit) were both
-- evaluated on every profile update. One policy with the same disjunction is
-- equivalent — a row is updatable if you own it or you are an admin — and the
-- `protect_profile_privileges` trigger still decides which *columns* stick.
drop policy if exists profiles_update_self on public.profiles;
drop policy if exists profiles_update_admin on public.profiles;

create policy profiles_update on public.profiles
  for update to authenticated
  using (id = (select auth.uid()) or public.is_admin())
  with check (id = (select auth.uid()) or public.is_admin());

-- --- 2. Foreign-key indexes ------------------------------------------------
--
-- Indexed here: foreign keys the application actually filters or joins on, and
-- whose parent rows get deleted (a delete on the parent scans the child for
-- referencing rows, which is a sequential scan without one).
--
-- Deliberately NOT indexed: the audit-stamp columns — created_by, updated_by,
-- completed_by, converted_by, triggered_by. Nothing queries by them, and their
-- parent (`profiles`) has no DELETE policy at all: team members are deactivated,
-- never deleted. Indexing them would add write cost on every insert to buy a
-- lookup nobody performs.

create index if not exists activities_pipeline_card_idx
  on public.activities (pipeline_card_id) where pipeline_card_id is not null;

create index if not exists follow_ups_engagement_idx
  on public.follow_ups (engagement_id) where engagement_id is not null;

create index if not exists follow_ups_pipeline_card_idx
  on public.follow_ups (pipeline_card_id) where pipeline_card_id is not null;

create index if not exists pipeline_cards_engagement_idx
  on public.pipeline_cards (engagement_id) where engagement_id is not null;

create index if not exists leads_contact_idx
  on public.leads (contact_id) where contact_id is not null;

create index if not exists mailchimp_campaigns_audience_idx
  on public.mailchimp_campaigns (audience_id) where audience_id is not null;

create index if not exists mailchimp_campaign_activity_member_idx
  on public.mailchimp_campaign_activity (member_id) where member_id is not null;

create index if not exists import_rows_contact_idx
  on public.import_rows (contact_id) where contact_id is not null;

create index if not exists import_rows_gift_idx
  on public.import_rows (gift_id) where gift_id is not null;

create index if not exists notifications_related_contact_idx
  on public.notifications (related_contact_id) where related_contact_id is not null;

create index if not exists notifications_related_lead_idx
  on public.notifications (related_lead_id) where related_lead_id is not null;

create index if not exists notifications_related_follow_up_idx
  on public.notifications (related_follow_up_id) where related_follow_up_id is not null;

create index if not exists pipelines_engagement_type_idx
  on public.pipelines (engagement_type_id) where engagement_type_id is not null;

-- The linter also reports `pipeline_cards_stage_id_pipeline_id_fkey` as
-- uncovered. It is not: `pipeline_cards_stage_idx` on (stage_id, position)
-- leads with stage_id, which serves the constraint check. No index added.
