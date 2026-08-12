-- ---------------------------------------------------------------------------
-- What came of it.
--
-- A timeline entry recorded *that* a call happened; staff also need to record
-- how it went — "left a voicemail", "she wants the trust illustration", "asked
-- us not to call again before Easter". That is the field a development officer
-- scans when catching up on a relationship, and it was missing.
--
-- Free text rather than an enum: the useful outcomes are sentences, and an
-- enum here would force every conversation into one of six boxes.
-- ---------------------------------------------------------------------------

alter table public.activities
  add column if not exists outcome text;

comment on column public.activities.outcome is
  'How the interaction went. Free text — the useful answers are sentences, not categories.';
