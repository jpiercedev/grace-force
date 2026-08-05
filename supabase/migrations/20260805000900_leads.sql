-- ---------------------------------------------------------------------------
-- Lead intake — the public front door.
--
-- Submissions arrive from public web forms via a service-role API route; the
-- anon key is never given write access here. Alongside the leads table sits a
-- race-safe fixed-window rate limiter used to blunt abuse of that route.
-- ---------------------------------------------------------------------------

create table if not exists public.leads (
  id                uuid primary key default gen_random_uuid(),

  first_name        text,
  last_name         text,
  email             text,
  email_normalized  text generated always as (public.normalize_email(email)) stored,
  phone             text,
  organization_name text,

  message           text,
  -- Slug of the engagement type the person expressed interest in.
  interest          text,

  source            public.contact_source not null default 'web_form',
  -- Identifies which form/page produced the lead.
  form_key          text not null default 'default',
  page_url          text,
  utm               jsonb not null default '{}'::jsonb,

  -- Never store a raw IP: the route stores a salted hash for rate limiting
  -- and abuse investigation only.
  ip_hash           text,
  user_agent        text,
  honeypot_tripped  boolean not null default false,

  status            public.lead_status not null default 'new',
  assigned_to       uuid references public.profiles (id) on delete set null,

  contact_id        uuid references public.contacts (id) on delete set null,
  converted_at      timestamptz,
  converted_by      uuid references public.profiles (id) on delete set null,

  -- Deterministic key computed by the intake route from
  -- (form_key, email, message, coarse time bucket). Collapses double-submits
  -- without discarding a genuine second enquiry days later.
  dedupe_key        text,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint leads_needs_contact_detail check (
    coalesce(btrim(email), '') <> '' or coalesce(btrim(phone), '') <> ''
  ),
  constraint leads_conversion_consistency check (
    (status = 'converted' and contact_id is not null and converted_at is not null) or
    (status <> 'converted')
  )
);

comment on table public.leads is
  'Inbound enquiries from public forms, pending triage into contacts.';

create unique index if not exists leads_dedupe_key_uniq
  on public.leads (dedupe_key) where dedupe_key is not null;

create index if not exists leads_status_idx on public.leads (status, created_at desc);
create index if not exists leads_email_idx on public.leads (email_normalized);
create index if not exists leads_assigned_idx on public.leads (assigned_to) where status <> 'converted';

create trigger leads_set_updated_at
  before update on public.leads
  for each row execute function public.set_updated_at();

-- --- Rate limiting ---------------------------------------------------------

create table if not exists public.rate_limit_hits (
  bucket       text not null,
  window_start timestamptz not null,
  hits         integer not null default 0,
  primary key (bucket, window_start)
);

comment on table public.rate_limit_hits is
  'Fixed-window counters for public endpoints. Service-role only; no RLS policies exist.';

create index if not exists rate_limit_hits_window_idx
  on public.rate_limit_hits (window_start);

-- Atomically records a hit and reports whether the caller is still within
-- budget. INSERT ... ON CONFLICT DO UPDATE makes this safe under concurrency:
-- two simultaneous requests cannot both read a stale count.
create or replace function public.consume_rate_limit(
  p_bucket         text,
  p_limit          integer,
  p_window_seconds integer default 3600
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window_start timestamptz;
  v_hits integer;
begin
  if p_limit <= 0 then
    return true;
  end if;

  v_window_start := to_timestamp(
    floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds
  );

  insert into public.rate_limit_hits (bucket, window_start, hits)
  values (p_bucket, v_window_start, 1)
  on conflict (bucket, window_start)
  do update set hits = public.rate_limit_hits.hits + 1
  returning hits into v_hits;

  return v_hits <= p_limit;
end;
$$;

revoke all on function public.consume_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.consume_rate_limit(text, integer, integer) to service_role;

comment on function public.consume_rate_limit(text, integer, integer) is
  'Returns true while the bucket is under its limit for the current window. Service-role only.';

-- Housekeeping for the counter table; called by the cron route.
create or replace function public.prune_rate_limit_hits(p_older_than_hours integer default 48)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_deleted integer;
begin
  delete from public.rate_limit_hits
  where window_start < now() - make_interval(hours => p_older_than_hours);
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function public.prune_rate_limit_hits(integer) from public, anon, authenticated;
grant execute on function public.prune_rate_limit_hits(integer) to service_role;

-- --- Lead conversion -------------------------------------------------------
--
-- Atomic: creating the contact, the engagement, the timeline entries and the
-- lead update either all happen or none do. Doing this in application code
-- would risk a half-converted lead if any step failed.
create or replace function public.convert_lead(
  p_lead_id  uuid,
  p_owner_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lead        public.leads%rowtype;
  v_contact_id  uuid;
  v_type_id     uuid;
  v_actor       uuid := (select auth.uid());
begin
  -- When invoked by a signed-in user, they must have write rights. A NULL
  -- auth.uid() means a trusted server-side caller (service role).
  if v_actor is not null and not public.can_write() then
    raise exception 'insufficient privilege to convert leads'
      using errcode = 'insufficient_privilege';
  end if;

  select * into v_lead from public.leads where id = p_lead_id for update;
  if not found then
    raise exception 'lead % not found', p_lead_id using errcode = 'no_data_found';
  end if;

  if v_lead.status = 'converted' then
    return v_lead.contact_id;
  end if;

  -- Re-use an existing contact when the email already matches, so triaging a
  -- lead from a known supporter enriches rather than duplicates.
  if v_lead.email_normalized is not null then
    select c.id into v_contact_id
    from public.contacts c
    where c.email_normalized = v_lead.email_normalized
      and c.deleted_at is null
    order by c.created_at
    limit 1;
  end if;

  if v_contact_id is null then
    insert into public.contacts
      (first_name, last_name, email, phone, organization_name,
       source, source_detail, lifecycle_stage, owner_id, created_by, notes)
    values (
      v_lead.first_name, v_lead.last_name, v_lead.email, v_lead.phone,
      v_lead.organization_name, v_lead.source, v_lead.form_key, 'prospect',
      coalesce(p_owner_id, v_lead.assigned_to), v_actor, v_lead.message
    )
    returning id into v_contact_id;
  end if;

  -- Honour the interest expressed on the form, when it maps to a live type.
  if v_lead.interest is not null then
    select et.id into v_type_id
    from public.engagement_types et
    where et.slug = v_lead.interest and et.is_active;

    if v_type_id is not null then
      insert into public.engagements
        (contact_id, engagement_type_id, status, owner_id, created_by, notes)
      values (
        v_contact_id, v_type_id, 'prospect',
        coalesce(p_owner_id, v_lead.assigned_to), v_actor,
        'Created from lead intake'
      )
      on conflict do nothing;
    end if;
  end if;

  insert into public.activities
    (contact_id, type, source, subject, body, occurred_at, actor_id, actor_label, metadata, dedupe_key)
  values (
    v_contact_id, 'lead_submitted', 'lead_form',
    'Lead submitted via ' || v_lead.form_key, v_lead.message, v_lead.created_at,
    null, 'Web form',
    jsonb_build_object('lead_id', v_lead.id, 'utm', v_lead.utm, 'page_url', v_lead.page_url),
    'lead:submitted:' || v_lead.id::text
  )
  on conflict (dedupe_key) where dedupe_key is not null do nothing;

  insert into public.activities
    (contact_id, type, source, subject, actor_id, metadata, dedupe_key)
  values (
    v_contact_id, 'lead_converted', 'system', 'Lead converted to contact',
    v_actor, jsonb_build_object('lead_id', v_lead.id),
    'lead:converted:' || v_lead.id::text
  )
  on conflict (dedupe_key) where dedupe_key is not null do nothing;

  update public.leads
     set status       = 'converted',
         contact_id   = v_contact_id,
         converted_at = now(),
         converted_by = v_actor
   where id = p_lead_id;

  return v_contact_id;
end;
$$;

revoke all on function public.convert_lead(uuid, uuid) from public, anon;
grant execute on function public.convert_lead(uuid, uuid) to authenticated, service_role;

-- --- RLS -------------------------------------------------------------------

alter table public.leads enable row level security;

-- Leads contain unvetted third-party PII, so viewers do not see them at all.
create policy leads_select on public.leads
  for select to authenticated
  using (public.can_write());

create policy leads_insert on public.leads
  for insert to authenticated
  with check (public.can_write());

create policy leads_update on public.leads
  for update to authenticated
  using (public.can_write())
  with check (public.can_write());

create policy leads_delete on public.leads
  for delete to authenticated
  using (public.is_admin());

-- RLS on with zero policies: unreachable by anon/authenticated by design.
alter table public.rate_limit_hits enable row level security;
