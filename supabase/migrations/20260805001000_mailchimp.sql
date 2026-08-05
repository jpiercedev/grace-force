-- ---------------------------------------------------------------------------
-- Mailchimp mirror.
--
-- Every table here is a local projection of Mailchimp state, keyed on the
-- provider's own identifiers so that a sync is an upsert, never an append.
-- Nothing in this schema is writable by end users: the sync jobs run with the
-- service role, and staff see the results read-only inside the CRM.
-- ---------------------------------------------------------------------------

create table if not exists public.mailchimp_audiences (
  id                  uuid primary key default gen_random_uuid(),
  mailchimp_list_id   text not null unique,
  name                text not null,
  web_id              text,
  permission_reminder text,
  member_count        integer not null default 0,
  unsubscribe_count   integer not null default 0,
  cleaned_count       integer not null default 0,
  is_active           boolean not null default true,
  last_synced_at      timestamptz,
  raw                 jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

comment on table public.mailchimp_audiences is
  'Mailchimp lists/audiences mirrored locally. Keyed on mailchimp_list_id.';

create trigger mailchimp_audiences_set_updated_at
  before update on public.mailchimp_audiences
  for each row execute function public.set_updated_at();

create table if not exists public.mailchimp_members (
  id                  uuid primary key default gen_random_uuid(),
  audience_id         uuid not null references public.mailchimp_audiences (id) on delete cascade,
  -- Mailchimp's subscriber hash: md5(lower(email)). Stable per list.
  mailchimp_member_id text not null,
  email_address       text not null,
  email_normalized    text generated always as (public.normalize_email(email_address)) stored,

  status              text not null default 'subscribed',
  -- NULL means "seen in Mailchimp but not matched to anyone in the CRM";
  -- those rows surface in the unmatched-subscribers review queue.
  contact_id          uuid references public.contacts (id) on delete set null,
  matched_at          timestamptz,
  -- How the link was established: exact email, secondary email, or manual.
  match_method        text,

  merge_fields        jsonb not null default '{}'::jsonb,
  tags                jsonb not null default '[]'::jsonb,
  member_rating       integer,
  is_vip              boolean not null default false,

  opt_in_at           timestamptz,
  last_changed_at     timestamptz,
  unsubscribed_at     timestamptz,

  raw                 jsonb not null default '{}'::jsonb,
  synced_at           timestamptz not null default now(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),

  unique (audience_id, mailchimp_member_id),
  constraint mailchimp_members_status_known check (
    status in ('subscribed', 'unsubscribed', 'cleaned', 'pending', 'transactional', 'archived')
  )
);

comment on column public.mailchimp_members.contact_id is
  'CRM contact this subscriber resolves to, or NULL when unmatched.';

-- Mailchimp guarantees one member per email per audience; mirror that so a
-- bad sync can never fan out duplicates.
create unique index if not exists mailchimp_members_audience_email_uniq
  on public.mailchimp_members (audience_id, email_normalized);

create index if not exists mailchimp_members_contact_idx
  on public.mailchimp_members (contact_id) where contact_id is not null;

create index if not exists mailchimp_members_unmatched_idx
  on public.mailchimp_members (audience_id) where contact_id is null;

create index if not exists mailchimp_members_email_idx
  on public.mailchimp_members (email_normalized);

create trigger mailchimp_members_set_updated_at
  before update on public.mailchimp_members
  for each row execute function public.set_updated_at();

create table if not exists public.mailchimp_campaigns (
  id                    uuid primary key default gen_random_uuid(),
  mailchimp_campaign_id text not null unique,
  audience_id           uuid references public.mailchimp_audiences (id) on delete set null,
  web_id                text,

  title                 text,
  subject_line          text,
  preview_text          text,
  from_name             text,
  reply_to              text,
  campaign_type         text,
  status                text,
  send_time             timestamptz,

  emails_sent           integer not null default 0,
  opens_total           integer not null default 0,
  unique_opens          integer not null default 0,
  clicks_total          integer not null default 0,
  subscriber_clicks     integer not null default 0,
  unsubscribed          integer not null default 0,
  bounces               integer not null default 0,
  open_rate             numeric(6, 4),
  click_rate            numeric(6, 4),
  archive_url           text,

  raw                   jsonb not null default '{}'::jsonb,
  synced_at             timestamptz not null default now(),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

comment on table public.mailchimp_campaigns is
  'Sent campaigns with aggregate performance, mirrored from Mailchimp reports.';

create index if not exists mailchimp_campaigns_send_time_idx
  on public.mailchimp_campaigns (send_time desc nulls last);

create trigger mailchimp_campaigns_set_updated_at
  before update on public.mailchimp_campaigns
  for each row execute function public.set_updated_at();

create table if not exists public.mailchimp_campaign_activity (
  id               uuid primary key default gen_random_uuid(),
  campaign_id      uuid not null references public.mailchimp_campaigns (id) on delete cascade,
  member_id        uuid references public.mailchimp_members (id) on delete set null,
  contact_id       uuid references public.contacts (id) on delete set null,

  email_address    text not null,
  email_normalized text generated always as (public.normalize_email(email_address)) stored,

  action           text not null,
  action_at        timestamptz,
  url              text,
  -- Mailchimp reports repeated opens/clicks as a count rather than N rows.
  event_count      integer not null default 1,

  -- Deterministic: campaign + email + action (+ url). Re-running the sync
  -- updates the count instead of inserting a second row.
  dedupe_key       text not null,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint mailchimp_activity_action_known check (
    action in ('sent', 'open', 'click', 'bounce', 'unsub', 'abuse')
  )
);

comment on table public.mailchimp_campaign_activity is
  'Per-subscriber campaign engagement. dedupe_key makes re-sync idempotent.';

create unique index if not exists mailchimp_campaign_activity_dedupe_uniq
  on public.mailchimp_campaign_activity (dedupe_key);

create index if not exists mailchimp_campaign_activity_contact_idx
  on public.mailchimp_campaign_activity (contact_id, action_at desc)
  where contact_id is not null;

create index if not exists mailchimp_campaign_activity_campaign_idx
  on public.mailchimp_campaign_activity (campaign_id, action);

create trigger mailchimp_campaign_activity_set_updated_at
  before update on public.mailchimp_campaign_activity
  for each row execute function public.set_updated_at();

-- --- Sync bookkeeping ------------------------------------------------------

create table if not exists public.integration_sync_runs (
  id           uuid primary key default gen_random_uuid(),
  integration  text not null,
  job          text not null,
  status       public.sync_status not null default 'running',
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  stats        jsonb not null default '{}'::jsonb,
  error        text,
  triggered_by uuid references public.profiles (id) on delete set null,
  created_at   timestamptz not null default now()
);

comment on table public.integration_sync_runs is
  'Audit trail of integration sync executions and their row counts.';

create index if not exists integration_sync_runs_recent_idx
  on public.integration_sync_runs (integration, started_at desc);

-- --- Contact-level email engagement ---------------------------------------

create or replace view public.contact_email_engagement
with (security_invoker = on) as
select
  a.contact_id,
  count(*) filter (where a.action = 'sent')::bigint   as emails_received,
  count(*) filter (where a.action = 'open')::bigint   as campaigns_opened,
  count(*) filter (where a.action = 'click')::bigint  as campaigns_clicked,
  count(*) filter (where a.action = 'bounce')::bigint as bounces,
  count(*) filter (where a.action = 'unsub')::bigint  as unsubscribes,
  max(a.action_at) filter (where a.action = 'open')   as last_opened_at,
  max(a.action_at) filter (where a.action = 'click')  as last_clicked_at,
  max(a.action_at)                                    as last_email_event_at
from public.mailchimp_campaign_activity a
where a.contact_id is not null
group by a.contact_id;

comment on view public.contact_email_engagement is
  'Per-contact rollup of Mailchimp engagement, shown on the contact record.';

-- --- RLS -------------------------------------------------------------------
--
-- Read-only for the team; all writes belong to the service-role sync jobs.
-- The one exception is manual match correction, which admins may perform.

alter table public.mailchimp_audiences enable row level security;
alter table public.mailchimp_members enable row level security;
alter table public.mailchimp_campaigns enable row level security;
alter table public.mailchimp_campaign_activity enable row level security;
alter table public.integration_sync_runs enable row level security;

create policy mailchimp_audiences_select on public.mailchimp_audiences
  for select to authenticated using (public.is_active_user());

create policy mailchimp_members_select on public.mailchimp_members
  for select to authenticated using (public.is_active_user());

-- Lets an admin resolve an ambiguous subscriber to the right contact.
create policy mailchimp_members_admin_update on public.mailchimp_members
  for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy mailchimp_campaigns_select on public.mailchimp_campaigns
  for select to authenticated using (public.is_active_user());

create policy mailchimp_campaign_activity_select on public.mailchimp_campaign_activity
  for select to authenticated using (public.is_active_user());

create policy integration_sync_runs_select on public.integration_sync_runs
  for select to authenticated using (public.is_active_user());
