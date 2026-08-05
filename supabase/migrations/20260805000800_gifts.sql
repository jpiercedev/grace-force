-- ---------------------------------------------------------------------------
-- Giving history.
--
-- Grace Force's system of record for money is its giving platform; this table
-- holds a synchronised copy so that staff can see generosity *in context* on
-- the contact record without leaving the CRM.
--
-- Access is narrower than the rest of the CRM: giving data is visible only to
-- admins and staff explicitly granted `can_view_giving`.
-- ---------------------------------------------------------------------------

create table if not exists public.gifts (
  id              uuid primary key default gen_random_uuid(),
  contact_id      uuid not null references public.contacts (id) on delete cascade,

  -- Minor units (cents). Never store money as floating point.
  amount_cents    bigint not null,
  currency        text not null default 'USD',
  given_on        date not null,

  method          public.gift_method not null default 'other',
  -- Designation, e.g. "General Fund", "Church Planting".
  fund            text,
  campaign        text,

  is_recurring    boolean not null default false,
  recurrence      text,
  is_anonymous    boolean not null default false,

  receipt_number  text,
  notes           text,

  -- Natural key from the giving platform / import file. Makes re-imports and
  -- re-syncs idempotent.
  external_source text,
  external_id     text,

  created_by      uuid references public.profiles (id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),

  constraint gifts_amount_positive check (amount_cents > 0),
  constraint gifts_currency_format check (currency ~ '^[A-Z]{3}$'),
  constraint gifts_external_pair check (
    (external_source is null and external_id is null) or
    (external_source is not null and external_id is not null)
  )
);

comment on table public.gifts is
  'Giving history mirrored from the giving platform. Read access gated by can_view_giving().';

create unique index if not exists gifts_external_key
  on public.gifts (external_source, external_id)
  where external_id is not null;

create index if not exists gifts_contact_date_idx
  on public.gifts (contact_id, given_on desc);

create index if not exists gifts_given_on_idx
  on public.gifts (given_on desc);

create index if not exists gifts_fund_idx on public.gifts (fund);

create trigger gifts_set_updated_at
  before update on public.gifts
  for each row execute function public.set_updated_at();

-- Gifts appear in the unified timeline like everything else. The dedupe key
-- ties the activity to the gift so re-syncing cannot double-post it.
create or replace function public.log_gift_activity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.activities
    (contact_id, type, source, subject, occurred_at, actor_id, actor_label, metadata, dedupe_key)
  values (
    new.contact_id,
    'gift_recorded',
    -- CASE resolves to text, so the enum cast has to be explicit.
    (case when new.external_source is null then 'manual' else 'import' end)::public.activity_source,
    'Gift recorded',
    new.given_on::timestamptz,
    (select auth.uid()),
    new.external_source,
    jsonb_build_object(
      'gift_id', new.id,
      'amount_cents', new.amount_cents,
      'currency', new.currency,
      'fund', new.fund,
      'campaign', new.campaign,
      'method', new.method,
      'is_recurring', new.is_recurring
    ),
    'gift:' || new.id::text
  )
  on conflict (dedupe_key) where dedupe_key is not null do nothing;

  return null;
end;
$$;

create trigger gifts_log_activity
  after insert on public.gifts
  for each row execute function public.log_gift_activity();

-- --- Giving context --------------------------------------------------------
--
-- `security_invoker` is essential: without it the view would run as its owner
-- and hand giving totals to every authenticated user, silently bypassing the
-- RLS policy below.
create or replace view public.contact_giving_summary
with (security_invoker = on) as
select
  g.contact_id,
  count(*)::bigint                       as gift_count,
  sum(g.amount_cents)::bigint            as total_cents,
  min(g.given_on)                        as first_gift_on,
  max(g.given_on)                        as last_gift_on,
  max(g.amount_cents)::bigint            as largest_gift_cents,
  round(avg(g.amount_cents))::bigint     as average_gift_cents,
  coalesce(sum(g.amount_cents) filter (
    where g.given_on >= date_trunc('year', current_date)::date), 0)::bigint
                                         as ytd_cents,
  coalesce(sum(g.amount_cents) filter (
    where g.given_on >= (current_date - interval '365 days')::date), 0)::bigint
                                         as trailing_12mo_cents,
  bool_or(g.is_recurring)                as has_recurring
from public.gifts g
group by g.contact_id;

comment on view public.contact_giving_summary is
  'Per-contact giving rollup. security_invoker keeps the gifts RLS policy in force.';

-- --- RLS -------------------------------------------------------------------

alter table public.gifts enable row level security;

create policy gifts_select on public.gifts
  for select to authenticated
  using (public.can_view_giving());

-- Gifts normally arrive by sync/import (service role). Manual correction is
-- an admin action so the giving record cannot drift silently.
create policy gifts_insert on public.gifts
  for insert to authenticated
  with check (public.is_admin());

create policy gifts_update on public.gifts
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy gifts_delete on public.gifts
  for delete to authenticated
  using (public.is_admin());
