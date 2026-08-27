-- ---------------------------------------------------------------------------
-- Grace Lead Manager — foundation
--
-- Extensions, shared enums, and the utility triggers/functions every other
-- migration builds on.
--
-- Conventions used throughout this schema:
--   * Every table lives in `public` and has RLS enabled with explicit policies.
--   * Authorisation is decided by SECURITY DEFINER helpers (see 000200) so that
--     policies never re-enter a policy-protected table and recurse.
--   * External systems are joined on natural keys (`*_external_id`) so that
--     re-running a sync is a no-op rather than a duplicate.
-- ---------------------------------------------------------------------------

-- `gen_random_uuid()` is core Postgres since 13, so no pgcrypto dependency.
-- pg_trgm backs the fuzzy name/email lookups used by global search. It lives
-- in a dedicated schema (Supabase convention) rather than polluting `public`.
create schema if not exists extensions;
grant usage on schema extensions to public;
create extension if not exists "pg_trgm" with schema extensions;

-- --- Shared enums ----------------------------------------------------------

-- Team member capability level.
do $$ begin
  create type public.user_role as enum ('admin', 'staff', 'viewer');
exception when duplicate_object then null; end $$;

-- Where a contact/lead originally came from.
do $$ begin
  create type public.contact_source as enum (
    'manual',
    'web_form',
    'event',
    'referral',
    'import',
    'mailchimp',
    'giving_platform',
    'other'
  );
exception when duplicate_object then null; end $$;

-- Coarse relationship temperature, independent of any single engagement.
do $$ begin
  create type public.lifecycle_stage as enum (
    'prospect',
    'engaged',
    'active',
    'lapsed',
    'archived'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.contact_status as enum ('active', 'inactive', 'archived');
exception when duplicate_object then null; end $$;

-- A contact may hold several of these at once (donor AND volunteer AND ...).
do $$ begin
  create type public.engagement_status as enum (
    'prospect',
    'active',
    'paused',
    'lapsed',
    'ended'
  );
exception when duplicate_object then null; end $$;

-- The unified timeline discriminator.
do $$ begin
  create type public.activity_type as enum (
    'note',
    'call',
    'email',
    'meeting',
    'text_message',
    'visit',
    'prayer_request',
    'follow_up_created',
    'follow_up_completed',
    'engagement_started',
    'engagement_changed',
    'pipeline_stage_changed',
    'pipeline_card_created',
    'pipeline_card_closed',
    'gift_recorded',
    'assignment_changed',
    'lead_submitted',
    'lead_converted',
    'mailchimp_subscribed',
    'mailchimp_unsubscribed',
    'mailchimp_campaign_sent',
    'mailchimp_campaign_opened',
    'mailchimp_campaign_clicked',
    'mailchimp_bounced',
    'import',
    'system'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.activity_direction as enum ('inbound', 'outbound', 'internal');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.activity_source as enum (
    'manual',
    'system',
    'mailchimp',
    'import',
    'lead_form'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.follow_up_status as enum ('open', 'completed', 'cancelled');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.follow_up_priority as enum ('low', 'normal', 'high', 'urgent');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.pipeline_card_status as enum ('open', 'won', 'lost');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.lead_status as enum ('new', 'in_review', 'converted', 'spam', 'archived');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.gift_method as enum (
    'cash',
    'check',
    'card',
    'ach',
    'stock',
    'in_kind',
    'other'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.sync_status as enum ('running', 'succeeded', 'failed', 'partial');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.notification_status as enum ('pending', 'sent', 'failed', 'skipped');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.import_status as enum ('pending', 'validated', 'committed', 'failed');
exception when duplicate_object then null; end $$;

-- --- Utility functions -----------------------------------------------------

-- Keeps `updated_at` honest without trusting the client.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

comment on function public.set_updated_at() is
  'BEFORE UPDATE trigger: stamps updated_at server-side.';

-- Normalises an email for matching: trimmed + lowercased, NULL when blank.
-- Marked IMMUTABLE so it can back generated columns and unique indexes.
create or replace function public.normalize_email(value text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select nullif(lower(btrim(value)), '');
$$;

comment on function public.normalize_email(text) is
  'Canonical email form used for contact matching and unique indexes.';

-- Reduces a phone number to digits (keeping a leading +) for fuzzy matching.
create or replace function public.normalize_phone(value text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select nullif(
    case
      when btrim(value) like '+%' then '+' || regexp_replace(value, '[^0-9]', '', 'g')
      else regexp_replace(value, '[^0-9]', '', 'g')
    end,
    ''
  );
$$;

comment on function public.normalize_phone(text) is
  'Digits-only phone form used for duplicate detection during import.';
