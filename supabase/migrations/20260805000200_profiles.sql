-- ---------------------------------------------------------------------------
-- Team members (profiles) and the authorisation helpers used by every policy.
--
-- `profiles` mirrors `auth.users` 1:1 and carries the CRM capability level.
-- Because the helpers are consulted *inside* policies on `profiles` itself,
-- they must be SECURITY DEFINER — otherwise evaluating the policy would
-- re-enter the policy and recurse infinitely.
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  id            uuid primary key references auth.users (id) on delete cascade,
  email         text not null,
  full_name     text,
  avatar_url    text,
  title         text,
  phone         text,
  role          public.user_role not null default 'staff',
  -- Giving history is sensitive; access is opt-in per staff member.
  can_view_giving boolean not null default false,
  is_active     boolean not null default true,
  last_seen_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on table public.profiles is
  'CRM team members. One row per auth.users row.';
comment on column public.profiles.can_view_giving is
  'Grants read access to the gifts table. Admins always have access.';

create unique index if not exists profiles_email_key
  on public.profiles (public.normalize_email(email));

create index if not exists profiles_active_idx
  on public.profiles (is_active) where is_active;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- --- Authorisation helpers -------------------------------------------------
--
-- All are SECURITY DEFINER + STABLE + locked search_path. They return false
-- rather than raising when there is no authenticated user, so policies stay
-- simple boolean expressions.

create or replace function public.current_user_role()
returns public.user_role
language sql
stable
security definer
set search_path = ''
as $$
  select p.role
  from public.profiles p
  where p.id = (select auth.uid())
    and p.is_active;
$$;

create or replace function public.is_active_user()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.is_active
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid()) and p.is_active and p.role = 'admin'
  );
$$;

-- Admins and staff may create/modify CRM records; viewers are read-only.
create or replace function public.can_write()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.is_active
      and p.role in ('admin', 'staff')
  );
$$;

create or replace function public.can_view_giving()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = (select auth.uid())
      and p.is_active
      and (p.role = 'admin' or p.can_view_giving)
  );
$$;

comment on function public.can_view_giving() is
  'True for admins, or staff explicitly granted giving visibility.';

-- --- Provisioning ----------------------------------------------------------

-- The very first person to sign up bootstraps the workspace as an admin;
-- everyone after that lands as staff and an admin adjusts them.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  assigned_role public.user_role;
begin
  select case when count(*) = 0 then 'admin'::public.user_role
              else 'staff'::public.user_role end
    into assigned_role
  from public.profiles;

  insert into public.profiles (id, email, full_name, avatar_url, role, can_view_giving)
  values (
    new.id,
    new.email,
    nullif(btrim(coalesce(new.raw_user_meta_data ->> 'full_name',
                          new.raw_user_meta_data ->> 'name', '')), ''),
    new.raw_user_meta_data ->> 'avatar_url',
    assigned_role,
    assigned_role = 'admin'
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Stops a non-admin from escalating their own capabilities by PATCHing their
-- profile row. RLS decides *which rows* are writable; this decides which
-- *columns* actually take effect.
--
-- A NULL auth.uid() means there is no end-user request behind this statement —
-- it is the service role running provisioning or admin tooling, which is
-- trusted. That path is unreachable for anon/authenticated callers: the
-- profiles policies match no rows without a JWT subject, so only a
-- BYPASSRLS role can get here.
create or replace function public.protect_profile_privileges()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or public.is_admin() then
    return new;
  end if;

  new.role            := old.role;
  new.is_active       := old.is_active;
  new.can_view_giving := old.can_view_giving;
  return new;
end;
$$;

create trigger profiles_protect_privileges
  before update on public.profiles
  for each row execute function public.protect_profile_privileges();

-- Never let the last remaining admin be demoted or deactivated — that would
-- lock every human out of user administration.
create or replace function public.ensure_admin_remains()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (old.role = 'admin' and old.is_active)
     and (new.role <> 'admin' or not new.is_active)
     and not exists (
       select 1 from public.profiles p
       where p.role = 'admin' and p.is_active and p.id <> old.id
     )
  then
    raise exception 'Cannot remove the last active administrator'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger profiles_ensure_admin_remains
  before update on public.profiles
  for each row execute function public.ensure_admin_remains();

-- --- RLS -------------------------------------------------------------------

alter table public.profiles enable row level security;

-- Everyone active can see the roster (needed for owner/assignee pickers).
-- A deactivated user can still read their own row so the UI can explain why
-- they have no access.
create policy profiles_select on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or public.is_active_user());

create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

create policy profiles_update_admin on public.profiles
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Deliberately no INSERT/DELETE policies: rows are created by the
-- `on_auth_user_created` trigger and removed by cascade from auth.users.
