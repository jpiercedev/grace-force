-- ---------------------------------------------------------------------------
-- Contacts — the person record at the centre of the CRM.
--
-- A contact is deliberately *not* typed as "donor" or "volunteer": those are
-- engagements (see 000400), and one person can hold several at once. The
-- contact row holds identity, reachability and ownership only.
-- ---------------------------------------------------------------------------

create table if not exists public.contacts (
  id                uuid primary key default gen_random_uuid(),

  -- Identity
  first_name        text,
  last_name         text,
  preferred_name    text,
  full_name         text generated always as (
                      nullif(btrim(coalesce(first_name, '') || ' ' || coalesce(last_name, '')), '')
                    ) stored,

  -- Reachability. Email is intentionally NOT unique: spouses and households
  -- legitimately share an address. Duplicate detection happens at import time
  -- and via the merge tooling, not as a hard constraint that would block
  -- real-world data.
  email             text,
  email_normalized  text generated always as (public.normalize_email(email)) stored,
  secondary_email   text,
  phone             text,
  phone_normalized  text generated always as (public.normalize_phone(phone)) stored,
  mobile_phone      text,

  -- Location
  address_line1     text,
  address_line2     text,
  city              text,
  region            text,
  postal_code       text,
  country           text default 'US',

  -- Affiliation
  organization_name text,
  job_title         text,

  -- Relationship state
  lifecycle_stage   public.lifecycle_stage not null default 'prospect',
  status            public.contact_status not null default 'active',
  source            public.contact_source not null default 'manual',
  source_detail     text,

  -- Ownership: the staff member responsible for this relationship.
  owner_id          uuid references public.profiles (id) on delete set null,

  -- Communication preferences
  do_not_contact    boolean not null default false,
  do_not_email      boolean not null default false,

  birthday          date,
  tags              text[] not null default '{}',
  notes             text,

  -- Stable natural key from whatever system a record originally came from
  -- (a CSV import, the giving platform, Mailchimp). Lets a re-import update
  -- rather than duplicate, and gives exports a key that survives round-trips.
  external_source   text,
  external_id       text,

  -- Denormalised for cheap "recently touched" sorting; maintained by the
  -- activities trigger in 000600.
  last_activity_at  timestamptz,

  created_by        uuid references public.profiles (id) on delete set null,
  updated_by        uuid references public.profiles (id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz,

  search_vector     tsvector generated always as (
    setweight(to_tsvector('simple',
      coalesce(first_name, '') || ' ' || coalesce(last_name, '') || ' ' ||
      coalesce(preferred_name, '')), 'A') ||
    setweight(to_tsvector('simple',
      coalesce(email, '') || ' ' || coalesce(secondary_email, '') || ' ' ||
      coalesce(phone, '') || ' ' || coalesce(mobile_phone, '')), 'B') ||
    setweight(to_tsvector('simple',
      coalesce(organization_name, '') || ' ' || coalesce(job_title, '') || ' ' ||
      coalesce(city, '') || ' ' || coalesce(region, '')), 'C') ||
    setweight(to_tsvector('english', coalesce(notes, '')), 'D')
  ) stored,

  constraint contacts_has_a_name check (
    coalesce(btrim(first_name), '') <> '' or
    coalesce(btrim(last_name), '') <> '' or
    coalesce(btrim(organization_name), '') <> ''
  ),
  constraint contacts_external_pair check (
    (external_source is null and external_id is null) or
    (external_source is not null and external_id is not null)
  )
);

comment on table public.contacts is
  'People and organisations the ministry is in relationship with.';
comment on column public.contacts.external_id is
  'Natural key from the originating system; (external_source, external_id) is unique so re-imports update rather than duplicate.';

-- Idempotent imports/syncs: re-running an import with the same source keys
-- updates the existing row instead of inserting a second one.
create unique index if not exists contacts_external_key
  on public.contacts (external_source, external_id)
  where external_id is not null;

create index if not exists contacts_email_normalized_idx
  on public.contacts (email_normalized)
  where deleted_at is null;

create index if not exists contacts_phone_normalized_idx
  on public.contacts (phone_normalized)
  where deleted_at is null;

create index if not exists contacts_owner_idx
  on public.contacts (owner_id) where deleted_at is null;

create index if not exists contacts_status_idx
  on public.contacts (status, lifecycle_stage) where deleted_at is null;

create index if not exists contacts_last_activity_idx
  on public.contacts (last_activity_at desc nulls last) where deleted_at is null;

create index if not exists contacts_created_at_idx
  on public.contacts (created_at desc) where deleted_at is null;

create index if not exists contacts_tags_idx
  on public.contacts using gin (tags);

create index if not exists contacts_search_idx
  on public.contacts using gin (search_vector);

-- Trigram indexes power "starts typing a partial name/email" lookups, which
-- full-text search alone cannot answer.
create index if not exists contacts_full_name_trgm_idx
  on public.contacts using gin (lower(coalesce(full_name, '')) extensions.gin_trgm_ops);

create index if not exists contacts_email_trgm_idx
  on public.contacts using gin (lower(coalesce(email, '')) extensions.gin_trgm_ops);

create trigger contacts_set_updated_at
  before update on public.contacts
  for each row execute function public.set_updated_at();

-- --- RLS -------------------------------------------------------------------
--
-- The ministry runs a single shared book of relationships: every active team
-- member can see every contact. Write access follows role, and destructive
-- deletes are reserved for admins (staff soft-delete via `deleted_at`).

alter table public.contacts enable row level security;

create policy contacts_select on public.contacts
  for select to authenticated
  using (public.is_active_user());

create policy contacts_insert on public.contacts
  for insert to authenticated
  with check (public.can_write());

create policy contacts_update on public.contacts
  for update to authenticated
  using (public.can_write())
  with check (public.can_write());

create policy contacts_delete on public.contacts
  for delete to authenticated
  using (public.is_admin());
