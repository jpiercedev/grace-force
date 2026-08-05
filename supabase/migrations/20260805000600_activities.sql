-- ---------------------------------------------------------------------------
-- Activities — the unified contact timeline.
--
-- Every meaningful thing that happens to a relationship lands here: notes and
-- calls logged by staff, pipeline stage moves, gifts, Mailchimp opens and
-- clicks, lead submissions, imports. One table, one chronological view.
--
-- `dedupe_key` is the backbone of idempotent integration sync: an external
-- event carries a deterministic key, so replaying a sync inserts nothing new.
-- ---------------------------------------------------------------------------

create table if not exists public.activities (
  id               uuid primary key default gen_random_uuid(),
  contact_id       uuid not null references public.contacts (id) on delete cascade,
  engagement_id    uuid references public.engagements (id) on delete set null,
  pipeline_card_id uuid references public.pipeline_cards (id) on delete set null,

  type             public.activity_type not null,
  direction        public.activity_direction not null default 'internal',
  source           public.activity_source not null default 'manual',

  subject          text,
  body             text,
  occurred_at      timestamptz not null default now(),

  -- Who performed it. NULL for machine-generated events, which use
  -- `actor_label` ("Mailchimp", "CSV import") for display instead.
  actor_id         uuid references public.profiles (id) on delete set null,
  actor_label      text,

  metadata         jsonb not null default '{}'::jsonb,

  -- Deterministic natural key for externally-sourced events. NULL for manual
  -- entries, which are free to repeat.
  dedupe_key       text,

  is_pinned        boolean not null default false,
  created_at       timestamptz not null default now()
);

comment on table public.activities is
  'Append-only unified timeline for a contact.';
comment on column public.activities.dedupe_key is
  'Deterministic key for external events (e.g. mailchimp:open:<campaign>:<email>:<ts>). Unique when present, which makes re-syncing a no-op.';

create unique index if not exists activities_dedupe_key_uniq
  on public.activities (dedupe_key) where dedupe_key is not null;

create index if not exists activities_contact_time_idx
  on public.activities (contact_id, occurred_at desc);

create index if not exists activities_type_time_idx
  on public.activities (type, occurred_at desc);

create index if not exists activities_time_idx
  on public.activities (occurred_at desc);

create index if not exists activities_actor_idx
  on public.activities (actor_id, occurred_at desc);

create index if not exists activities_engagement_idx
  on public.activities (engagement_id) where engagement_id is not null;

-- --- Denormalised recency --------------------------------------------------

-- Keeps contacts.last_activity_at current. SECURITY DEFINER so the stamp is
-- always applied, even when the inserting role's policy on `contacts` would
-- not permit a direct UPDATE.
create or replace function public.touch_contact_last_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.contacts c
     set last_activity_at = greatest(coalesce(c.last_activity_at, new.occurred_at), new.occurred_at)
   where c.id = new.contact_id
     and (c.last_activity_at is null or c.last_activity_at < new.occurred_at);
  return null;
end;
$$;

create trigger activities_touch_contact
  after insert on public.activities
  for each row execute function public.touch_contact_last_activity();

-- --- Automatic timeline entries -------------------------------------------

create or replace function public.log_engagement_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  type_label text;
begin
  select et.label into type_label
  from public.engagement_types et
  where et.id = new.engagement_type_id;

  if tg_op = 'INSERT' then
    insert into public.activities
      (contact_id, engagement_id, type, source, subject, actor_id, metadata)
    values (
      new.contact_id, new.id, 'engagement_started', 'system',
      coalesce(type_label, 'Engagement') || ' engagement started',
      (select auth.uid()),
      jsonb_build_object('status', new.status, 'engagement_type', type_label)
    );
  elsif new.status is distinct from old.status then
    insert into public.activities
      (contact_id, engagement_id, type, source, subject, actor_id, metadata)
    values (
      new.contact_id, new.id, 'engagement_changed', 'system',
      coalesce(type_label, 'Engagement') || ' status: ' || old.status || ' → ' || new.status,
      (select auth.uid()),
      jsonb_build_object('from', old.status, 'to', new.status, 'engagement_type', type_label)
    );
  end if;

  return null;
end;
$$;

create trigger engagements_log_activity
  after insert or update of status on public.engagements
  for each row execute function public.log_engagement_activity();

create or replace function public.log_pipeline_card_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_stage text;
  new_stage text;
  pipeline_name text;
begin
  select p.name into pipeline_name from public.pipelines p where p.id = new.pipeline_id;

  if tg_op = 'INSERT' then
    select s.name into new_stage from public.pipeline_stages s where s.id = new.stage_id;
    insert into public.activities
      (contact_id, engagement_id, pipeline_card_id, type, source, subject, actor_id, metadata)
    values (
      new.contact_id, new.engagement_id, new.id, 'pipeline_card_created', 'system',
      'Added to ' || coalesce(pipeline_name, 'pipeline') || ' — ' || coalesce(new_stage, 'stage'),
      (select auth.uid()),
      jsonb_build_object('pipeline', pipeline_name, 'stage', new_stage)
    );
    return null;
  end if;

  if new.status is distinct from old.status and new.status <> 'open' then
    insert into public.activities
      (contact_id, engagement_id, pipeline_card_id, type, source, subject, actor_id, metadata)
    values (
      new.contact_id, new.engagement_id, new.id, 'pipeline_card_closed', 'system',
      coalesce(pipeline_name, 'Pipeline') || ' marked ' || new.status,
      (select auth.uid()),
      jsonb_build_object('pipeline', pipeline_name, 'status', new.status,
                         'reason', new.close_reason, 'value_cents', new.value_cents)
    );
  elsif new.stage_id is distinct from old.stage_id then
    select s.name into old_stage from public.pipeline_stages s where s.id = old.stage_id;
    select s.name into new_stage from public.pipeline_stages s where s.id = new.stage_id;
    insert into public.activities
      (contact_id, engagement_id, pipeline_card_id, type, source, subject, actor_id, metadata)
    values (
      new.contact_id, new.engagement_id, new.id, 'pipeline_stage_changed', 'system',
      coalesce(old_stage, '?') || ' → ' || coalesce(new_stage, '?'),
      (select auth.uid()),
      jsonb_build_object('pipeline', pipeline_name, 'from', old_stage, 'to', new_stage)
    );
  end if;

  return null;
end;
$$;

create trigger pipeline_cards_log_activity
  after insert or update of stage_id, status on public.pipeline_cards
  for each row execute function public.log_pipeline_card_activity();

-- Records reassignment so ownership changes are visible in the timeline.
create or replace function public.log_contact_assignment()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  old_name text;
  new_name text;
begin
  select coalesce(p.full_name, p.email) into old_name
  from public.profiles p where p.id = old.owner_id;
  select coalesce(p.full_name, p.email) into new_name
  from public.profiles p where p.id = new.owner_id;

  insert into public.activities
    (contact_id, type, source, subject, actor_id, metadata)
  values (
    new.id, 'assignment_changed', 'system',
    'Owner: ' || coalesce(old_name, 'unassigned') || ' → ' || coalesce(new_name, 'unassigned'),
    (select auth.uid()),
    jsonb_build_object('from', old.owner_id, 'to', new.owner_id)
  );
  return null;
end;
$$;

create trigger contacts_log_assignment
  after update of owner_id on public.contacts
  for each row
  when (old.owner_id is distinct from new.owner_id)
  execute function public.log_contact_assignment();

-- --- RLS -------------------------------------------------------------------

alter table public.activities enable row level security;

create policy activities_select on public.activities
  for select to authenticated
  using (public.is_active_user());

create policy activities_insert on public.activities
  for insert to authenticated
  with check (public.can_write());

-- The timeline is an audit trail: only the author may amend their own entry,
-- and only admins may remove anything.
create policy activities_update on public.activities
  for update to authenticated
  using (public.is_admin() or (public.can_write() and actor_id = (select auth.uid())))
  with check (public.is_admin() or (public.can_write() and actor_id = (select auth.uid())));

create policy activities_delete on public.activities
  for delete to authenticated
  using (public.is_admin());
