-- ---------------------------------------------------------------------------
-- Rebrand: "Grace Force CRM" becomes "Grace Lead Manager".
--
-- Two pieces of shipped copy live in the database rather than in the app, so
-- editing the source files is not enough for a database that already exists.
--
-- `20260805001300_reference_data.sql` now carries the reworded engagement-type
-- descriptions, but it inserts with `on conflict (slug) do nothing`, so a
-- database provisioned before this rename still holds the old text. Rewrite it
-- here — matching on the exact string that migration shipped, so an operator
-- who has since reworded a description keeps their wording. That also makes
-- this migration a no-op on a database created after the rename.
-- ---------------------------------------------------------------------------

update public.engagement_types
   set description = 'Gives financially to the ministry'
 where slug = 'donor'
   and description = 'Gives financially to Grace Force';

update public.engagement_types
   set description = 'Has attended a ministry event'
 where slug = 'event_attendee'
   and description = 'Has attended a Grace Force event';

-- The table comment is documentation with no operator customisation worth
-- preserving, and `comment on` is idempotent, so it is simply restated.
comment on table public.contacts is
  'People and organisations the ministry is in relationship with.';
