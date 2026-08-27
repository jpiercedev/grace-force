-- ---------------------------------------------------------------------------
-- Engagements — the many ways one contact relates to the ministry.
--
-- This is the table that makes the CRM a *relationship* system rather than a
-- list: the same person can simultaneously be a monthly donor, a volunteer
-- team lead, and a partner-church contact, each with its own status, owner
-- and history.
-- ---------------------------------------------------------------------------

create table if not exists public.engagement_types (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  label       text not null,
  description text,
  -- Tailwind-friendly token used by badges in the UI.
  color       text not null default 'slate',
  icon        text,
  is_active   boolean not null default true,
  sort_order  integer not null default 100,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint engagement_types_slug_format check (slug ~ '^[a-z0-9_]+$')
);

comment on table public.engagement_types is
  'Admin-managed catalogue of engagement kinds (donor, volunteer, ...).';

create index if not exists engagement_types_active_idx
  on public.engagement_types (is_active, sort_order);

create trigger engagement_types_set_updated_at
  before update on public.engagement_types
  for each row execute function public.set_updated_at();

create table if not exists public.engagements (
  id                  uuid primary key default gen_random_uuid(),
  contact_id          uuid not null references public.contacts (id) on delete cascade,
  engagement_type_id  uuid not null references public.engagement_types (id) on delete restrict,
  status              public.engagement_status not null default 'prospect',
  -- Free-text specialisation, e.g. "Worship team", "Monthly partner".
  role_detail         text,
  owner_id            uuid references public.profiles (id) on delete set null,
  started_on          date not null default current_date,
  ended_on            date,
  last_touch_at       timestamptz,
  notes               text,
  metadata            jsonb not null default '{}'::jsonb,
  external_source     text,
  external_id         text,
  created_by          uuid references public.profiles (id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint engagements_date_order check (ended_on is null or ended_on >= started_on),
  -- An ended engagement must record when it ended, and a live one must not.
  constraint engagements_ended_consistency check (
    (status = 'ended' and ended_on is not null) or
    (status <> 'ended' and ended_on is null)
  )
);

comment on table public.engagements is
  'A contact''s participation in one engagement type. Multiple rows per contact are expected.';

-- A contact holds at most one *live* engagement of each type; ended ones are
-- retained as history, so re-engaging someone later is a new row.
create unique index if not exists engagements_one_live_per_type
  on public.engagements (contact_id, engagement_type_id)
  where status <> 'ended';

create unique index if not exists engagements_external_key
  on public.engagements (external_source, external_id)
  where external_id is not null;

create index if not exists engagements_contact_idx
  on public.engagements (contact_id);

create index if not exists engagements_type_status_idx
  on public.engagements (engagement_type_id, status);

create index if not exists engagements_owner_idx
  on public.engagements (owner_id) where status <> 'ended';

create trigger engagements_set_updated_at
  before update on public.engagements
  for each row execute function public.set_updated_at();

-- --- RLS -------------------------------------------------------------------

alter table public.engagement_types enable row level security;

create policy engagement_types_select on public.engagement_types
  for select to authenticated
  using (public.is_active_user());

-- The catalogue shapes reporting across the whole org, so only admins edit it.
create policy engagement_types_write on public.engagement_types
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

alter table public.engagements enable row level security;

create policy engagements_select on public.engagements
  for select to authenticated
  using (public.is_active_user());

create policy engagements_insert on public.engagements
  for insert to authenticated
  with check (public.can_write());

create policy engagements_update on public.engagements
  for update to authenticated
  using (public.can_write())
  with check (public.can_write());

create policy engagements_delete on public.engagements
  for delete to authenticated
  using (public.is_admin());
