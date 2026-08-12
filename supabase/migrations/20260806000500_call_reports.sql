-- ---------------------------------------------------------------------------
-- Call reports — the written record of a donor meeting.
--
-- This is the workflow a development officer performs after every significant
-- conversation, and it is a *document*, not a form: a summary in their own
-- words, what the donor is interested in, what worried them, what they
-- committed to, and what happens next. The columns follow that narrative order
-- so the interface can render the sections in the order a person thinks.
--
-- Drafts are first class. A report written from the car park is worth more
-- than a perfect one that never gets filed.
-- ---------------------------------------------------------------------------

create table if not exists public.call_reports (
  id                 uuid primary key default gen_random_uuid(),

  contact_id         uuid not null references public.contacts (id) on delete cascade,
  -- A meeting frequently *is* the proposal conversation.
  proposal_id        uuid references public.proposals (id) on delete set null,

  status             public.call_report_status not null default 'draft',

  -- Meeting details
  met_on             date not null default current_date,
  met_at_time        time,
  meeting_kind       public.meeting_kind not null default 'in_person',
  location           text,

  -- Who was there. `author_id` is the staff member filing the report, and
  -- `staff_attendee_ids` are the colleagues who were also in the room.
  --
  -- The array carries no foreign key — Postgres cannot declare one on an array
  -- element. The trade-off is deliberate: the alternative is a join table with
  -- its own policies and its own UI for a field that is edited as one control
  -- and read as one line. Ids that no longer resolve to a profile are simply
  -- not rendered, which is the same outcome an `on delete set null` would give.
  author_id          uuid references public.profiles (id) on delete set null,
  staff_attendee_ids uuid[] not null default '{}',
  external_attendees text,

  -- The narrative, in the order it is written.
  summary            text,
  discussion_points  text,
  interests_expressed text,
  concerns           text,
  commitments        text,
  next_steps         text,

  follow_up_on       date,
  -- The follow-up this report created, if the author asked for one.
  follow_up_id       uuid references public.follow_ups (id) on delete set null,

  filed_at           timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint call_reports_filed_consistency check (
    (status = 'filed' and filed_at is not null) or
    (status = 'draft' and filed_at is null)
  )
);

comment on table public.call_reports is
  'A written record of a donor meeting or call. Filing one posts it to the contact timeline.';
comment on column public.call_reports.staff_attendee_ids is
  'Colleagues who attended. Denormalised array — see the table comment in the migration for why there is no FK.';

create index if not exists call_reports_contact_idx
  on public.call_reports (contact_id, met_on desc);

create index if not exists call_reports_proposal_idx
  on public.call_reports (proposal_id) where proposal_id is not null;

create index if not exists call_reports_author_idx
  on public.call_reports (author_id, met_on desc);

create trigger call_reports_set_updated_at
  before update on public.call_reports
  for each row execute function public.set_updated_at();

-- --- Timeline --------------------------------------------------------------

alter table public.activities
  add column if not exists call_report_id uuid references public.call_reports (id) on delete set null;

create index if not exists activities_call_report_idx
  on public.activities (call_report_id) where call_report_id is not null;

/**
 * A filed report lands on the timeline once. The dedupe key is the report id,
 * so editing a filed report updates the document without posting a second
 * entry, and a draft posts nothing at all.
 */
create or replace function public.log_call_report_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status <> 'filed' then
    return null;
  end if;
  if tg_op = 'UPDATE' and old.status = 'filed' then
    return null;
  end if;

  insert into public.activities
    (contact_id, proposal_id, call_report_id, type, source, subject, body,
     occurred_at, actor_id, metadata, dedupe_key)
  values (
    new.contact_id, new.proposal_id, new.id, 'call_report', 'system',
    'Call report — ' || to_char(new.met_on, 'FMMonth FMDD, YYYY'),
    new.summary,
    (new.met_on + coalesce(new.met_at_time, time '12:00'))::timestamptz,
    coalesce(new.author_id, (select auth.uid())),
    jsonb_build_object('meeting_kind', new.meeting_kind, 'location', new.location),
    'call_report:' || new.id::text
  )
  on conflict do nothing;

  return null;
end;
$$;

create trigger call_reports_log_activity
  after insert or update of status on public.call_reports
  for each row execute function public.log_call_report_activity();

-- --- RLS --------------------------------------------------------------------
--
-- A filed report is the shared record and everyone active may read it. A draft
-- is unfinished thinking and stays with its author (and administrators, who
-- have to be able to clean up after someone leaves).

alter table public.call_reports enable row level security;

create policy call_reports_select on public.call_reports
  for select to authenticated
  using (
    public.is_active_user()
    and (
      status = 'filed'
      or author_id = (select auth.uid())
      or public.is_admin()
    )
  );

create policy call_reports_insert on public.call_reports
  for insert to authenticated
  with check (public.can_write());

create policy call_reports_update on public.call_reports
  for update to authenticated
  using (public.can_write() and (author_id = (select auth.uid()) or public.is_admin()))
  with check (public.can_write());

create policy call_reports_delete on public.call_reports
  for delete to authenticated
  using (public.is_admin());
