-- ---------------------------------------------------------------------------
-- Shared team visibility.
--
-- Grace Lead Management is one shared workspace: every active, authenticated
-- team member sees the same business records. Ownership and attribution
-- columns (owner_id, assigned_to, created_by, author_id, uploaded_by) keep
-- recording *responsibility* but stop acting as *visibility* boundaries.
--
-- What changes — SELECT opens to every active user on:
--   * gifts                (was: can_view_giving())
--   * contact_capability   (was: can_view_giving())
--   * proposals            (was: can_view_giving())
--   * activities           (was: giving-typed rows hidden without the flag)
--   * leads                (was: staff/admin only — viewers excluded)
--   * call_reports         (was: drafts visible only to author/admin)
-- and staff writes on capability/proposals drop their giving-flag condition.
--
-- What deliberately does not change:
--   * anon still reaches nothing, deactivated profiles still see nothing —
--     every predicate below starts from is_active_user();
--   * viewers stay read-only: no write policy is touched except to *remove*
--     the giving-flag condition for staff;
--   * notifications stay admin-only (an operational outbox quoting lead PII,
--     not a shared business record), imports stay staff tooling, and
--     rate_limit_hits stays sealed;
--   * attachment deletion still requires the uploader or an admin;
--   * profiles.can_view_giving and public.can_view_giving() remain defined —
--     nothing references them after this migration, but keeping them makes
--     this change cleanly reversible (see docs/ROLLOUT.md for the rollback).
-- ---------------------------------------------------------------------------

-- --- Giving history ----------------------------------------------------------

drop policy if exists gifts_select on public.gifts;
create policy gifts_select on public.gifts
  for select to authenticated using (public.is_active_user());

-- --- Giving capability -------------------------------------------------------

drop policy if exists contact_capability_select on public.contact_capability;
create policy contact_capability_select on public.contact_capability
  for select to authenticated using (public.is_active_user());

drop policy if exists contact_capability_insert on public.contact_capability;
create policy contact_capability_insert on public.contact_capability
  for insert to authenticated with check (public.can_write());

drop policy if exists contact_capability_update on public.contact_capability;
create policy contact_capability_update on public.contact_capability
  for update to authenticated using (public.can_write()) with check (public.can_write());

-- --- Proposals / planned gifts ----------------------------------------------

drop policy if exists proposals_select on public.proposals;
create policy proposals_select on public.proposals
  for select to authenticated using (public.is_active_user());

drop policy if exists proposals_insert on public.proposals;
create policy proposals_insert on public.proposals
  for insert to authenticated with check (public.can_write());

drop policy if exists proposals_update on public.proposals;
create policy proposals_update on public.proposals
  for update to authenticated using (public.can_write()) with check (public.can_write());

-- --- The timeline ------------------------------------------------------------

-- Restores the original 20260805000600 shape: one shared timeline. The
-- giving-typed rows (gift_recorded, proposal_*) become visible to every
-- active user, matching the tables they mirror.
drop policy if exists activities_select on public.activities;
create policy activities_select on public.activities
  for select to authenticated using (public.is_active_user());

-- --- Leads -------------------------------------------------------------------

-- Viewers may now read the lead queue. Triage writes remain staff-only.
drop policy if exists leads_select on public.leads;
create policy leads_select on public.leads
  for select to authenticated using (public.is_active_user());

-- --- Call reports ------------------------------------------------------------

-- Drafts included: authorship no longer hides a report from the team.
-- Editing stays author-or-admin, deletion stays admin.
drop policy if exists call_reports_select on public.call_reports;
create policy call_reports_select on public.call_reports
  for select to authenticated using (public.is_active_user());
