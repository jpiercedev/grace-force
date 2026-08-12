-- ---------------------------------------------------------------------------
-- Enumerations for the relationship-development domain: related constituents,
-- communication preferences, giving capability, events, proposals and call
-- reports.
--
-- Why this is a file of its own: `alter type … add value` may run inside a
-- transaction, but the new label cannot be *used* until that transaction
-- commits. Every migration file is applied as one implicit transaction (both
-- by the Supabase CLI and by the PGlite harness), so the additions to
-- `activity_type` below have to land in a file that does nothing else with
-- them. The tables and triggers that reference them live in 000200 onwards.
-- ---------------------------------------------------------------------------

-- --- Related constituents ---------------------------------------------------
--
-- Direction matters and is deliberately encoded once. A row means
--
--     <from_contact> is the <kind> of <to_contact>
--
-- so a single row answers both directions: the label shown on the *to* side is
-- the kind itself ("Spouse", "Referred by"), and the label shown on the *from*
-- side is its inverse ("Spouse", "Referred"). Storing one row rather than a
-- mirrored pair means a link can never disagree with itself.
do $$ begin
  create type public.relationship_kind as enum (
    'spouse',
    'partner',
    'parent',
    'child',
    'sibling',
    'family_member',
    'friend',
    'colleague',
    'business_associate',
    'professional_advisor',
    'employer',
    'referrer',
    'introducer',
    'other'
  );
exception when duplicate_object then null; end $$;

-- --- Communication preferences ----------------------------------------------

do $$ begin
  create type public.contact_method as enum ('email', 'phone', 'text', 'mail');
exception when duplicate_object then null; end $$;

-- --- Giving capability ------------------------------------------------------
--
-- A relationship-strategy signal, not financial underwriting. `unrated` is the
-- default so an unreviewed record never reads as "this person cannot give".
do $$ begin
  create type public.capability_level as enum (
    'unrated',
    'modest',
    'moderate',
    'significant',
    'major'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.capability_confidence as enum ('low', 'medium', 'high');
exception when duplicate_object then null; end $$;

-- --- Events -----------------------------------------------------------------

do $$ begin
  create type public.event_kind as enum (
    'gathering',
    'service',
    'banquet',
    'tour',
    'meeting',
    'conference',
    'volunteer',
    'other'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.event_attendance as enum (
    'invited',
    'attended',
    'declined',
    'no_show'
  );
exception when duplicate_object then null; end $$;

-- --- Proposals and planned gifts --------------------------------------------

do $$ begin
  create type public.proposal_kind as enum (
    'trust',
    'charitable_gift_annuity',
    'outright_gift',
    'estate_gift',
    'other_planned_gift'
  );
exception when duplicate_object then null; end $$;

-- Six stages, ordered as they occur. `funded` and `declined` are the two
-- terminal states; a check constraint ties them to `closed_at`.
do $$ begin
  create type public.proposal_status as enum (
    'exploring',
    'drafted',
    'presented',
    'committed',
    'funded',
    'declined'
  );
exception when duplicate_object then null; end $$;

-- --- Call reports -----------------------------------------------------------

do $$ begin
  create type public.meeting_kind as enum (
    'in_person',
    'video',
    'phone',
    'event',
    'other'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.call_report_status as enum ('draft', 'filed');
exception when duplicate_object then null; end $$;

-- --- Timeline additions -----------------------------------------------------
--
-- The timeline stays the one place a relationship's history is told, so the
-- new objects post into it by trigger exactly as engagements, pipeline cards,
-- follow-ups and gifts already do.
--
-- `outreach_attempt` is the "we tried and did not reach them" entry: staff
-- need to record the attempt without it reading as a completed conversation.
alter type public.activity_type add value if not exists 'outreach_attempt';
alter type public.activity_type add value if not exists 'call_report';
alter type public.activity_type add value if not exists 'proposal_created';
alter type public.activity_type add value if not exists 'proposal_stage_changed';
alter type public.activity_type add value if not exists 'proposal_closed';
alter type public.activity_type add value if not exists 'event_attended';
