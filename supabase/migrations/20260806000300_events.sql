-- ---------------------------------------------------------------------------
-- Events — relationship context, not an event-registration platform.
--
-- The question this table answers is "was she at the Legacy dinner, and what
-- happened there?", asked from a donor record. It deliberately has no ticket
-- types, no capacity, no invitations, no waitlist: the moment those appear the
-- CRM has grown a second product inside it.
-- ---------------------------------------------------------------------------

create table if not exists public.events (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  kind        public.event_kind not null default 'gathering',

  -- Date and time are separate because most of these are recorded after the
  -- fact from a calendar entry or someone's memory, and "the banquet, some
  -- time that evening" is a real answer. A timestamptz would force a lie.
  event_date  date not null,
  start_time  time,
  location    text,
  description text,

  owner_id    uuid references public.profiles (id) on delete set null,
  created_by  uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint events_has_a_name check (btrim(name) <> '')
);

comment on table public.events is
  'Gatherings a contact can be recorded as having attended. Lightweight by design.';

create index if not exists events_date_idx on public.events (event_date desc);
create index if not exists events_owner_idx on public.events (owner_id);

create trigger events_set_updated_at
  before update on public.events
  for each row execute function public.set_updated_at();

create table if not exists public.event_attendees (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references public.events (id) on delete cascade,
  contact_id uuid not null references public.contacts (id) on delete cascade,
  status     public.event_attendance not null default 'invited',
  -- "Sat with the Hendersons; asked about the land." The reason a development
  -- officer opens this screen at all.
  note       text,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (event_id, contact_id)
);

comment on table public.event_attendees is
  'Who was at an event, and what was worth remembering about it.';

create index if not exists event_attendees_contact_idx
  on public.event_attendees (contact_id);

create trigger event_attendees_set_updated_at
  before update on public.event_attendees
  for each row execute function public.set_updated_at();

-- --- Timeline --------------------------------------------------------------

alter table public.activities
  add column if not exists event_id uuid references public.events (id) on delete set null;

create index if not exists activities_event_idx
  on public.activities (event_id) where event_id is not null;

/**
 * Attendance posts to the contact's timeline the moment it becomes 'attended',
 * and only then — an invitation is not a thing that happened to the
 * relationship. The dedupe key means flipping a record away from 'attended'
 * and back does not post twice.
 */
create or replace function public.log_event_attendance_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  event_row public.events%rowtype;
begin
  if new.status <> 'attended' then
    return null;
  end if;
  if tg_op = 'UPDATE' and old.status = 'attended' then
    return null;
  end if;

  select * into event_row from public.events e where e.id = new.event_id;

  insert into public.activities
    (contact_id, event_id, type, source, subject, body, occurred_at,
     actor_id, metadata, dedupe_key)
  values (
    new.contact_id, new.event_id, 'event_attended', 'system',
    'Attended ' || coalesce(event_row.name, 'an event'),
    new.note,
    coalesce(event_row.event_date, current_date)::timestamptz,
    (select auth.uid()),
    jsonb_build_object(
      'event', event_row.name,
      'location', event_row.location,
      'event_date', event_row.event_date
    ),
    'event:' || new.event_id::text || ':' || new.contact_id::text
  )
  -- No conflict target: `activities_dedupe_key_uniq` is a partial index, and
  -- inferring a partial arbiter would mean restating its predicate here.
  on conflict do nothing;

  return null;
end;
$$;

create trigger event_attendees_log_activity
  after insert or update of status on public.event_attendees
  for each row execute function public.log_event_attendance_activity();

-- --- RLS --------------------------------------------------------------------

alter table public.events enable row level security;

create policy events_select on public.events
  for select to authenticated
  using (public.is_active_user());

create policy events_insert on public.events
  for insert to authenticated
  with check (public.can_write());

create policy events_update on public.events
  for update to authenticated
  using (public.can_write())
  with check (public.can_write());

create policy events_delete on public.events
  for delete to authenticated
  using (public.is_admin());

alter table public.event_attendees enable row level security;

create policy event_attendees_select on public.event_attendees
  for select to authenticated
  using (public.is_active_user());

create policy event_attendees_insert on public.event_attendees
  for insert to authenticated
  with check (public.can_write());

create policy event_attendees_update on public.event_attendees
  for update to authenticated
  using (public.can_write())
  with check (public.can_write());

create policy event_attendees_delete on public.event_attendees
  for delete to authenticated
  using (public.can_write());
