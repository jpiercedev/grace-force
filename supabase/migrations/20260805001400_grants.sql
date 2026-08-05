-- ---------------------------------------------------------------------------
-- Role grants.
--
-- Supabase's model is: table privileges are broad, and RLS decides which rows
-- each request may touch. Stating the grants explicitly here means the schema
-- reproduces identically anywhere Postgres runs — including the PGlite
-- harness the RLS test-suite uses — instead of depending on the hosted
-- project's preconfigured default privileges.
--
-- Note what is deliberately absent:
--   * `anon` receives no table privileges at all. Public traffic reaches the
--     database only through the service-role lead-intake route, so the
--     anonymous key cannot read or write CRM data even if it leaks.
--   * Function privileges are not blanket-granted. Postgres makes functions
--     executable by PUBLIC already, and the sensitive ones (consume_rate_limit,
--     prune_rate_limit_hits) were explicitly revoked at definition time — a
--     blanket grant here would silently undo that.
-- ---------------------------------------------------------------------------

grant usage on schema public to anon, authenticated, service_role;
grant usage on schema extensions to anon, authenticated, service_role;

grant all on all tables    in schema public to authenticated, service_role;
grant all on all sequences in schema public to authenticated, service_role;

-- Anything added by a later migration should inherit the same shape.
alter default privileges in schema public
  grant all on tables to authenticated, service_role;
alter default privileges in schema public
  grant all on sequences to authenticated, service_role;
