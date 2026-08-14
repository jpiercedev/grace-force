-- ---------------------------------------------------------------------------
-- Configurable pipelines and generalized sales opportunities.
--
-- Pipelines stop being fixed reference data: active staff may create, rename,
-- reorder and archive pipelines and their stages from the application. The
-- existing pipeline_cards table becomes the single opportunity record — no
-- parallel "sales" table — so every current card, its id, its stage and its
-- timeline history carry forward unchanged.
--
-- Two safety properties are enforced here rather than in the application,
-- because the FK from cards to pipelines/stages is ON DELETE CASCADE and a
-- buggy or malicious DELETE must not be able to take opportunities with it:
--   * a pipeline that still holds any opportunity cannot be deleted;
--   * a stage that still holds any opportunity cannot be deleted, and one
--     with *open* opportunities cannot be archived.
-- ---------------------------------------------------------------------------

-- --- Opportunity fields ------------------------------------------------------

-- Optional organization on the opportunity itself. Free text, like
-- contacts.organization_name (there is no organizations table); the app
-- defaults it from the contact but a deal may be with a different entity.
alter table public.pipeline_cards
  add column if not exists organization_name text;

-- The single next action that moves this opportunity forward. Dated,
-- assignable actions remain follow_ups; this is the board-visible one-liner.
alter table public.pipeline_cards
  add column if not exists next_step text;

comment on column public.pipeline_cards.organization_name is
  'Organization this opportunity is with, when different from (or absent on) the contact. Free text.';
comment on column public.pipeline_cards.next_step is
  'Short next-action note surfaced on boards and the opportunity list. Dated work belongs in follow_ups.';

-- --- Stage archiving ---------------------------------------------------------

-- Archived stages disappear from boards and pickers but keep their history;
-- closed cards may still reference them.
alter table public.pipeline_stages
  add column if not exists archived_at timestamptz;

comment on column public.pipeline_stages.archived_at is
  'Set when a stage is retired from the board. Stages with open cards cannot be archived (trigger-enforced).';

-- --- Deletion and archive guards --------------------------------------------
--
-- SECURITY DEFINER so the guard sees every card regardless of the caller''s
-- row visibility; search_path pinned like every definer function here. Not
-- RPC-callable (EXECUTE revoked below, matching 20260805001500).

create or replace function public.prevent_pipeline_delete_with_cards()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.pipeline_cards c where c.pipeline_id = old.id) then
    raise exception 'Pipeline "%" still holds opportunities. Move or archive them before deleting it.', old.name
      using errcode = 'check_violation';
  end if;
  return old;
end;
$$;

revoke all on function public.prevent_pipeline_delete_with_cards() from public, anon, authenticated;

drop trigger if exists pipelines_prevent_delete_with_cards on public.pipelines;
create trigger pipelines_prevent_delete_with_cards
  before delete on public.pipelines
  for each row execute function public.prevent_pipeline_delete_with_cards();

create or replace function public.prevent_stage_delete_with_cards()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.pipeline_cards c where c.stage_id = old.id) then
    raise exception 'Stage "%" still holds opportunities. Move or archive them before deleting it.', old.name
      using errcode = 'check_violation';
  end if;
  return old;
end;
$$;

revoke all on function public.prevent_stage_delete_with_cards() from public, anon, authenticated;

drop trigger if exists pipeline_stages_prevent_delete_with_cards on public.pipeline_stages;
create trigger pipeline_stages_prevent_delete_with_cards
  before delete on public.pipeline_stages
  for each row execute function public.prevent_stage_delete_with_cards();

create or replace function public.prevent_stage_archive_with_open_cards()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.archived_at is not null and old.archived_at is null
     and exists (
       select 1 from public.pipeline_cards c
       where c.stage_id = old.id and c.status = 'open'
     )
  then
    raise exception 'Stage "%" still has open opportunities. Move them to another stage first.', old.name
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function public.prevent_stage_archive_with_open_cards() from public, anon, authenticated;

drop trigger if exists pipeline_stages_prevent_archive_with_open_cards on public.pipeline_stages;
create trigger pipeline_stages_prevent_archive_with_open_cards
  before update of archived_at on public.pipeline_stages
  for each row execute function public.prevent_stage_archive_with_open_cards();

-- --- Staff management of pipelines and stages --------------------------------
--
-- Pipelines were admin-only reference data; they are now shared working
-- structure that any active staff member may shape. DELETE is likewise staff
-- so an empty, mistaken pipeline can be removed without an admin — the
-- triggers above make a destructive delete of real work impossible.

drop policy if exists pipelines_insert on public.pipelines;
drop policy if exists pipelines_update on public.pipelines;
drop policy if exists pipelines_delete on public.pipelines;

create policy pipelines_insert on public.pipelines
  for insert to authenticated with check (public.can_write());
create policy pipelines_update on public.pipelines
  for update to authenticated using (public.can_write()) with check (public.can_write());
create policy pipelines_delete on public.pipelines
  for delete to authenticated using (public.can_write());

drop policy if exists pipeline_stages_insert on public.pipeline_stages;
drop policy if exists pipeline_stages_update on public.pipeline_stages;
drop policy if exists pipeline_stages_delete on public.pipeline_stages;

create policy pipeline_stages_insert on public.pipeline_stages
  for insert to authenticated with check (public.can_write());
create policy pipeline_stages_update on public.pipeline_stages
  for update to authenticated using (public.can_write()) with check (public.can_write());
create policy pipeline_stages_delete on public.pipeline_stages
  for delete to authenticated using (public.can_write());
