-- ---------------------------------------------------------------------------
-- Pipelines — staged processes a contact moves through.
--
-- Grace Force runs several in parallel (major-donor cultivation, volunteer
-- onboarding, partner-church outreach), so pipelines are data, not code.
-- ---------------------------------------------------------------------------

create table if not exists public.pipelines (
  id                 uuid primary key default gen_random_uuid(),
  slug               text not null unique,
  name               text not null,
  description        text,
  -- Optional affinity: a volunteer-onboarding pipeline relates to the
  -- 'volunteer' engagement type.
  engagement_type_id uuid references public.engagement_types (id) on delete set null,
  -- Pipelines that track monetary asks surface value totals in the UI.
  tracks_value       boolean not null default false,
  is_default         boolean not null default false,
  is_active          boolean not null default true,
  sort_order         integer not null default 100,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint pipelines_slug_format check (slug ~ '^[a-z0-9_-]+$')
);

-- At most one default pipeline for the "add to pipeline" quick action.
create unique index if not exists pipelines_single_default
  on public.pipelines ((is_default)) where is_default;

create trigger pipelines_set_updated_at
  before update on public.pipelines
  for each row execute function public.set_updated_at();

create table if not exists public.pipeline_stages (
  id          uuid primary key default gen_random_uuid(),
  pipeline_id uuid not null references public.pipelines (id) on delete cascade,
  slug        text not null,
  name        text not null,
  description text,
  position    integer not null default 0,
  -- Terminal stages. A stage may be neither (in-flight) but never both.
  is_won      boolean not null default false,
  is_lost     boolean not null default false,
  color       text not null default 'slate',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  unique (pipeline_id, slug),
  -- Lets pipeline_cards enforce "stage belongs to the card's pipeline".
  unique (id, pipeline_id),
  constraint pipeline_stages_not_both_outcomes check (not (is_won and is_lost))
);

create index if not exists pipeline_stages_order_idx
  on public.pipeline_stages (pipeline_id, position);

create trigger pipeline_stages_set_updated_at
  before update on public.pipeline_stages
  for each row execute function public.set_updated_at();

create table if not exists public.pipeline_cards (
  id               uuid primary key default gen_random_uuid(),
  pipeline_id      uuid not null references public.pipelines (id) on delete cascade,
  stage_id         uuid not null,
  contact_id       uuid not null references public.contacts (id) on delete cascade,
  engagement_id    uuid references public.engagements (id) on delete set null,
  title            text not null,
  details          text,
  -- Stored in minor units to avoid floating-point money.
  value_cents      bigint,
  currency         text not null default 'USD',
  status           public.pipeline_card_status not null default 'open',
  owner_id         uuid references public.profiles (id) on delete set null,
  expected_close_on date,
  closed_at        timestamptz,
  close_reason     text,
  position         integer not null default 0,
  created_by       uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  -- Composite FK: a card can never point at a stage from another pipeline.
  foreign key (stage_id, pipeline_id)
    references public.pipeline_stages (id, pipeline_id) on delete cascade,
  constraint pipeline_cards_value_non_negative check (value_cents is null or value_cents >= 0),
  constraint pipeline_cards_closed_consistency check (
    (status = 'open' and closed_at is null) or
    (status <> 'open' and closed_at is not null)
  )
);

comment on table public.pipeline_cards is
  'One contact''s journey through one pipeline. Stage moves are recorded to the activity timeline by trigger.';

-- Prevent the same contact being worked twice in one pipeline at once.
create unique index if not exists pipeline_cards_one_open_per_contact
  on public.pipeline_cards (pipeline_id, contact_id)
  where status = 'open';

create index if not exists pipeline_cards_stage_idx
  on public.pipeline_cards (stage_id, position);

create index if not exists pipeline_cards_contact_idx
  on public.pipeline_cards (contact_id);

create index if not exists pipeline_cards_owner_open_idx
  on public.pipeline_cards (owner_id) where status = 'open';

create trigger pipeline_cards_set_updated_at
  before update on public.pipeline_cards
  for each row execute function public.set_updated_at();

-- --- RLS -------------------------------------------------------------------

alter table public.pipelines enable row level security;
alter table public.pipeline_stages enable row level security;
alter table public.pipeline_cards enable row level security;

create policy pipelines_select on public.pipelines
  for select to authenticated using (public.is_active_user());
create policy pipelines_write on public.pipelines
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy pipeline_stages_select on public.pipeline_stages
  for select to authenticated using (public.is_active_user());
create policy pipeline_stages_write on public.pipeline_stages
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- Cards are day-to-day work, so any staff member may create and move them.
create policy pipeline_cards_select on public.pipeline_cards
  for select to authenticated using (public.is_active_user());
create policy pipeline_cards_insert on public.pipeline_cards
  for insert to authenticated with check (public.can_write());
create policy pipeline_cards_update on public.pipeline_cards
  for update to authenticated using (public.can_write()) with check (public.can_write());
create policy pipeline_cards_delete on public.pipeline_cards
  for delete to authenticated using (public.is_admin());
