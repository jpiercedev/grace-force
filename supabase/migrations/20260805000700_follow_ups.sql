-- ---------------------------------------------------------------------------
-- Follow-ups — the "what do I owe someone this week" queue.
--
-- Deliberately separate from activities: an activity is something that already
-- happened, a follow-up is something owed. Completing one writes an activity.
-- ---------------------------------------------------------------------------

create table if not exists public.follow_ups (
  id               uuid primary key default gen_random_uuid(),
  contact_id       uuid not null references public.contacts (id) on delete cascade,
  engagement_id    uuid references public.engagements (id) on delete set null,
  pipeline_card_id uuid references public.pipeline_cards (id) on delete set null,

  title            text not null,
  details          text,
  due_at           timestamptz not null,
  -- When the reminder job should notify. Defaults to due_at via trigger.
  remind_at        timestamptz,

  priority         public.follow_up_priority not null default 'normal',
  status           public.follow_up_status not null default 'open',

  assigned_to      uuid references public.profiles (id) on delete set null,
  created_by       uuid references public.profiles (id) on delete set null,

  completed_at     timestamptz,
  completed_by     uuid references public.profiles (id) on delete set null,
  outcome_note     text,

  -- Set once the reminder email has gone out; the notification job uses this
  -- (together with the notifications dedupe key) to avoid repeat sends.
  reminder_sent_at timestamptz,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint follow_ups_title_present check (btrim(title) <> ''),
  constraint follow_ups_completion_consistency check (
    (status = 'completed' and completed_at is not null) or
    (status <> 'completed' and completed_at is null)
  )
);

comment on table public.follow_ups is
  'Outstanding commitments to a contact, owned by a staff member.';

create index if not exists follow_ups_open_due_idx
  on public.follow_ups (due_at) where status = 'open';

create index if not exists follow_ups_assignee_open_idx
  on public.follow_ups (assigned_to, due_at) where status = 'open';

create index if not exists follow_ups_contact_idx
  on public.follow_ups (contact_id, due_at desc);

-- Drives the reminder job: open, due, not yet reminded.
create index if not exists follow_ups_pending_reminder_idx
  on public.follow_ups (remind_at)
  where status = 'open' and reminder_sent_at is null;

create trigger follow_ups_set_updated_at
  before update on public.follow_ups
  for each row execute function public.set_updated_at();

create or replace function public.default_follow_up_remind_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.remind_at is null then
    new.remind_at := new.due_at;
  end if;
  return new;
end;
$$;

create trigger follow_ups_default_remind_at
  before insert on public.follow_ups
  for each row execute function public.default_follow_up_remind_at();

create or replace function public.log_follow_up_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.activities
      (contact_id, engagement_id, pipeline_card_id, type, source, subject, body, actor_id, metadata)
    values (
      new.contact_id, new.engagement_id, new.pipeline_card_id,
      'follow_up_created', 'system',
      'Follow-up scheduled: ' || new.title,
      new.details,
      (select auth.uid()),
      jsonb_build_object('follow_up_id', new.id, 'due_at', new.due_at, 'priority', new.priority)
    );
  elsif new.status = 'completed' and old.status <> 'completed' then
    insert into public.activities
      (contact_id, engagement_id, pipeline_card_id, type, source, subject, body, actor_id, metadata)
    values (
      new.contact_id, new.engagement_id, new.pipeline_card_id,
      'follow_up_completed', 'system',
      'Follow-up completed: ' || new.title,
      new.outcome_note,
      coalesce(new.completed_by, (select auth.uid())),
      jsonb_build_object('follow_up_id', new.id, 'due_at', new.due_at)
    );
  end if;
  return null;
end;
$$;

create trigger follow_ups_log_activity
  after insert or update of status on public.follow_ups
  for each row execute function public.log_follow_up_activity();

-- --- RLS -------------------------------------------------------------------

alter table public.follow_ups enable row level security;

create policy follow_ups_select on public.follow_ups
  for select to authenticated
  using (public.is_active_user());

create policy follow_ups_insert on public.follow_ups
  for insert to authenticated
  with check (public.can_write());

-- Staff may resolve work that is theirs (assigned or authored); admins may
-- resolve anything — e.g. reassigning a departing team member's queue.
create policy follow_ups_update on public.follow_ups
  for update to authenticated
  using (
    public.is_admin() or (
      public.can_write() and (
        assigned_to = (select auth.uid()) or
        created_by = (select auth.uid()) or
        assigned_to is null
      )
    )
  )
  with check (public.can_write());

create policy follow_ups_delete on public.follow_ups
  for delete to authenticated
  using (public.is_admin() or created_by = (select auth.uid()));
