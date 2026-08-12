-- ---------------------------------------------------------------------------
-- The donor profile: how to reach someone the way they want to be reached,
-- what they care about, who they are connected to, and — held separately
-- because it is sensitive — what they may be capable of giving.
-- ---------------------------------------------------------------------------

-- --- Communication preferences ---------------------------------------------
--
-- `do_not_contact` and `do_not_email` already existed. The rest complete the
-- set staff actually need at the moment they pick up the phone, which is why
-- they live on `contacts` rather than in a settings table: they are rendered
-- beside the call/text/email actions, not behind a preferences screen.
--
-- `preferred_phone` / `preferred_email` are free text rather than a pointer at
-- one of the stored values. A pointer cannot express "her office line, ask for
-- reception", and a copy that drifts out of date is visible and correctable —
-- an invisible stale pointer is not.
alter table public.contacts
  add column if not exists do_not_call               boolean not null default false,
  add column if not exists do_not_text               boolean not null default false,
  add column if not exists do_not_mail               boolean not null default false,
  add column if not exists preferred_contact_method  public.contact_method,
  add column if not exists preferred_phone           text,
  add column if not exists preferred_email           text,
  add column if not exists best_time_to_contact      text,
  add column if not exists contact_preference_notes  text;

comment on column public.contacts.preferred_phone is
  'Free text, not a pointer at phone/mobile_phone: real preferences include instructions ("office line, ask for reception").';

-- --- Philanthropic interests ------------------------------------------------
--
-- A curated catalogue rather than free tags. `contacts.tags` still exists for
-- operational labels; interests are what the donor cares about, and staff need
-- to be able to ask "who cares about the Life Centre?" — which a text array
-- shared with every other kind of label answers badly.

create table if not exists public.interest_areas (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  label       text not null,
  description text,
  sort_order  integer not null default 100,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.interest_areas is
  'The catalogue of philanthropic interests and goals a contact can be associated with.';

create trigger interest_areas_set_updated_at
  before update on public.interest_areas
  for each row execute function public.set_updated_at();

create table if not exists public.contact_interests (
  id               uuid primary key default gen_random_uuid(),
  contact_id       uuid not null references public.contacts (id) on delete cascade,
  interest_area_id uuid not null references public.interest_areas (id) on delete cascade,
  -- What they actually said. The difference between a tag and a relationship.
  note             text,
  created_by       uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  unique (contact_id, interest_area_id)
);

comment on table public.contact_interests is
  'What a contact cares about, with the sentence that explains why.';

create index if not exists contact_interests_contact_idx
  on public.contact_interests (contact_id);

create index if not exists contact_interests_area_idx
  on public.contact_interests (interest_area_id);

-- --- Related constituents ---------------------------------------------------
--
-- One row, both directions. See the comment on `relationship_kind` in 000100:
-- the row reads "<from> is the <kind> of <to>", the *to* side displays the kind
-- and the *from* side displays its inverse. A mirrored pair of rows would let
-- the two halves of one fact disagree.

create table if not exists public.contact_relationships (
  id               uuid primary key default gen_random_uuid(),
  from_contact_id  uuid not null references public.contacts (id) on delete cascade,
  to_contact_id    uuid not null references public.contacts (id) on delete cascade,
  kind             public.relationship_kind not null,
  -- "Met through the Tuesday study" — the context that makes the link useful.
  note             text,
  created_by       uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint contact_relationships_not_self check (from_contact_id <> to_contact_id)
);

comment on table public.contact_relationships is
  'Directed link between two contacts: "<from> is the <kind> of <to>". Displayed from both sides using the kind and its inverse.';

create unique index if not exists contact_relationships_unique_link
  on public.contact_relationships (from_contact_id, to_contact_id, kind);

create index if not exists contact_relationships_from_idx
  on public.contact_relationships (from_contact_id);

create index if not exists contact_relationships_to_idx
  on public.contact_relationships (to_contact_id);

create trigger contact_relationships_set_updated_at
  before update on public.contact_relationships
  for each row execute function public.set_updated_at();

-- --- Giving capability ------------------------------------------------------
--
-- Its own table, not columns on `contacts`, for one reason: it is as sensitive
-- as giving history and must obey the same permission. Postgres RLS is
-- row-level, so a capability column on `contacts` would be readable by every
-- active user the moment they could read the contact. A separate table gets a
-- policy of its own.

create table if not exists public.contact_capability (
  contact_id       uuid primary key references public.contacts (id) on delete cascade,
  level            public.capability_level not null default 'unrated',
  -- Minor units, like every other money column in the schema.
  range_low_cents  bigint,
  range_high_cents bigint,
  confidence       public.capability_confidence,
  -- Where the estimate came from: "wealth screening 2026", "she told us".
  source           text,
  reviewed_on      date,
  notes            text,
  updated_by       uuid references public.profiles (id) on delete set null,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint contact_capability_range_non_negative check (
    (range_low_cents  is null or range_low_cents  >= 0) and
    (range_high_cents is null or range_high_cents >= 0)
  ),
  constraint contact_capability_range_ordered check (
    range_low_cents is null or range_high_cents is null or range_low_cents <= range_high_cents
  )
);

comment on table public.contact_capability is
  'Estimated giving capability. Separate from contacts so it can carry the same permission as giving history.';

create trigger contact_capability_set_updated_at
  before update on public.contact_capability
  for each row execute function public.set_updated_at();

-- --- RLS --------------------------------------------------------------------

alter table public.interest_areas enable row level security;

create policy interest_areas_select on public.interest_areas
  for select to authenticated
  using (public.is_active_user());

create policy interest_areas_insert on public.interest_areas
  for insert to authenticated
  with check (public.is_admin());

create policy interest_areas_update on public.interest_areas
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy interest_areas_delete on public.interest_areas
  for delete to authenticated
  using (public.is_admin());

alter table public.contact_interests enable row level security;

create policy contact_interests_select on public.contact_interests
  for select to authenticated
  using (public.is_active_user());

create policy contact_interests_insert on public.contact_interests
  for insert to authenticated
  with check (public.can_write());

create policy contact_interests_update on public.contact_interests
  for update to authenticated
  using (public.can_write())
  with check (public.can_write());

create policy contact_interests_delete on public.contact_interests
  for delete to authenticated
  using (public.can_write());

alter table public.contact_relationships enable row level security;

create policy contact_relationships_select on public.contact_relationships
  for select to authenticated
  using (public.is_active_user());

create policy contact_relationships_insert on public.contact_relationships
  for insert to authenticated
  with check (public.can_write());

create policy contact_relationships_update on public.contact_relationships
  for update to authenticated
  using (public.can_write())
  with check (public.can_write());

create policy contact_relationships_delete on public.contact_relationships
  for delete to authenticated
  using (public.can_write());

alter table public.contact_capability enable row level security;

-- Capability follows the giving permission, not the contact permission: a
-- viewer who may read the person may still not read what they could give.
create policy contact_capability_select on public.contact_capability
  for select to authenticated
  using (public.can_view_giving());

create policy contact_capability_insert on public.contact_capability
  for insert to authenticated
  with check (public.can_write() and public.can_view_giving());

create policy contact_capability_update on public.contact_capability
  for update to authenticated
  using (public.can_write() and public.can_view_giving())
  with check (public.can_write() and public.can_view_giving());

create policy contact_capability_delete on public.contact_capability
  for delete to authenticated
  using (public.is_admin());

-- --- Reference data ---------------------------------------------------------
--
-- Ships as a migration for the same reason the engagement types do: the
-- application links to these by slug. `on conflict do nothing` so an operator's
-- edits survive re-running it.

insert into public.interest_areas (slug, label, description, sort_order) values
  ('life-centre',      'Life Centre',       'The Life Centre and the work that happens inside it.', 10),
  ('legacy-event',     'Legacy Event',      'The annual legacy gathering.',                          20),
  ('planned-giving',   'Planned Giving',    'Estate, trust and deferred gift conversations.',        30),
  ('capital-projects', 'Capital Projects',  'Buildings, renovations and capital campaigns.',         40),
  ('ministries',       'Specific Ministries','A named ministry or programme.',                       50),
  ('land-development', 'Land Development',  'Land acquisition and site development.',                60),
  ('missions',         'Missions',          'Field partners and mission work.',                      70),
  ('benevolence',      'Benevolence',       'Direct help for families in need.',                     80),
  ('other',            'Other',             'Something not yet on this list.',                      900)
on conflict (slug) do nothing;
