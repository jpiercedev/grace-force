-- ---------------------------------------------------------------------------
-- Internal notifications (Resend).
--
-- The table is the deduplication mechanism, not a log written after the fact.
-- Sending follows a claim-then-send pattern:
--
--   insert ... on conflict (dedupe_key) do nothing returning id
--
-- If the insert returns no row, some other request/worker already claimed that
-- notification and this caller must not send. That makes "notify once" hold
-- even across concurrent invocations and repeated cron runs.
-- ---------------------------------------------------------------------------

create table if not exists public.notifications (
  id                  uuid primary key default gen_random_uuid(),
  kind                text not null,

  -- Deterministic per real-world event, e.g. 'lead_created:<lead_id>' or
  -- 'follow_up_due:<follow_up_id>:2026-08-05'.
  dedupe_key          text not null unique,

  recipients          text[] not null default '{}',
  subject             text not null,
  body_text           text,
  body_html           text,

  status              public.notification_status not null default 'pending',
  provider            text not null default 'resend',
  provider_message_id text,
  error               text,
  attempts            integer not null default 0,

  payload             jsonb not null default '{}'::jsonb,

  related_contact_id   uuid references public.contacts (id) on delete set null,
  related_lead_id      uuid references public.leads (id) on delete set null,
  related_follow_up_id uuid references public.follow_ups (id) on delete set null,

  sent_at             timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  constraint notifications_recipients_present check (
    status = 'skipped' or cardinality(recipients) > 0
  )
);

comment on table public.notifications is
  'Internal email notifications. The unique dedupe_key guarantees at-most-once delivery per event.';
comment on column public.notifications.status is
  'skipped = Resend not configured or no recipients; the event is still recorded.';

create index if not exists notifications_status_idx
  on public.notifications (status, created_at desc);

create index if not exists notifications_kind_idx
  on public.notifications (kind, created_at desc);

-- Backlog view for the retry job.
create index if not exists notifications_pending_idx
  on public.notifications (created_at) where status = 'pending';

create trigger notifications_set_updated_at
  before update on public.notifications
  for each row execute function public.set_updated_at();

-- --- RLS -------------------------------------------------------------------
--
-- Notification bodies quote lead and contact details, so only admins may read
-- the outbox. All writes belong to the service role.

alter table public.notifications enable row level security;

create policy notifications_select on public.notifications
  for select to authenticated
  using (public.is_admin());
