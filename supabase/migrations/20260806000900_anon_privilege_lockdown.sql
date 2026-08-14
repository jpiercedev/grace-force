-- ---------------------------------------------------------------------------
-- Anonymous privilege lockdown.
--
-- Hosted projects can carry platform-managed grants and default ACLs that are
-- broader than the repository's explicit grant migration. RLS remains the
-- row-level boundary, but this release does not expose CRM relations directly
-- to the anonymous API role. Remove both the existing grants and the defaults
-- that would otherwise put them back on later migrations.
-- ---------------------------------------------------------------------------

revoke all privileges on all tables in schema public from anon;
revoke all privileges on all sequences in schema public from anon;

alter default privileges for role postgres
  revoke all privileges on tables from anon;
alter default privileges for role postgres in schema public
  revoke all privileges on tables from anon;
alter default privileges for role postgres
  revoke all privileges on sequences from anon;
alter default privileges for role postgres in schema public
  revoke all privileges on sequences from anon;

-- Function EXECUTE has a global PUBLIC default in Postgres. Revoke that global
-- default as well as any explicit public-schema grants carried by the hosted
-- project. Future functions are server-internal until a migration opts in a
-- narrower caller; service_role retains its trusted-server access.
alter default privileges for role postgres
  revoke execute on functions from public, anon, authenticated;
alter default privileges for role postgres in schema public
  revoke execute on functions from public, anon, authenticated;
alter default privileges for role postgres in schema public
  grant execute on functions to service_role;
