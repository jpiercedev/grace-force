-- ---------------------------------------------------------------------------
-- Tighten EXECUTE on SECURITY DEFINER functions.
--
-- PostgREST exposes every function in `public` as an RPC endpoint, and Postgres
-- grants EXECUTE to PUBLIC by default. That combination made all sixteen
-- SECURITY DEFINER functions callable over HTTP as `/rest/v1/rpc/<name>` —
-- including the trigger functions, which have no business being reachable at
-- all. Supabase's database linter flags this as
-- `anon_security_definer_function_executable` /
-- `authenticated_security_definer_function_executable`.
--
-- The fix has to be surgical, because the three groups behave differently.
-- Both claims below were verified against a real Postgres before being written:
--
--   1. Trigger functions: revoking EXECUTE does NOT stop a trigger firing —
--      Postgres checks TRIGGER privilege on the table when the trigger is
--      created, not EXECUTE on each invocation. Revoking only closes the RPC
--      door. Safe.
--
--   2. RLS helpers: a policy expression is evaluated with the *querying* role's
--      privileges. Revoking EXECUTE from `authenticated` makes every query
--      against a protected table fail with "permission denied for function".
--      So `authenticated` must keep EXECUTE on these five. `anon` never
--      queries a CRM table (it holds no table privileges), so no policy is ever
--      evaluated as `anon` and revoking there costs nothing.
--
--   3. Deliberate RPCs: `convert_lead` is called by the application on behalf of
--      a signed-in user and guards itself with `can_write()`. It stays granted,
--      and the linter will continue to report it — that report is expected and
--      accepted rather than a defect.
-- ---------------------------------------------------------------------------

-- --- 1. Trigger functions: not callable by anyone over the API --------------

revoke all on function public.handle_new_user()             from public, anon, authenticated;
revoke all on function public.ensure_admin_remains()        from public, anon, authenticated;
revoke all on function public.protect_profile_privileges()  from public, anon, authenticated;
revoke all on function public.touch_contact_last_activity() from public, anon, authenticated;
revoke all on function public.log_engagement_activity()     from public, anon, authenticated;
revoke all on function public.log_pipeline_card_activity()  from public, anon, authenticated;
revoke all on function public.log_contact_assignment()      from public, anon, authenticated;
revoke all on function public.log_follow_up_activity()      from public, anon, authenticated;
revoke all on function public.log_gift_activity()           from public, anon, authenticated;
revoke all on function public.default_follow_up_remind_at() from public, anon, authenticated;
revoke all on function public.set_updated_at()              from public, anon, authenticated;

-- --- 2. RLS helpers: signed-in users only ----------------------------------
--
-- `authenticated` keeps EXECUTE because the policies depend on it. Revoking
-- from PUBLIC first is what actually removes `anon`'s implicit grant; the
-- explicit grants then restore exactly the roles that need it.

revoke all on function public.current_user_role() from public, anon, authenticated;
revoke all on function public.is_active_user()    from public, anon, authenticated;
revoke all on function public.is_admin()          from public, anon, authenticated;
revoke all on function public.can_write()         from public, anon, authenticated;
revoke all on function public.can_view_giving()   from public, anon, authenticated;

grant execute on function public.current_user_role() to authenticated, service_role;
grant execute on function public.is_active_user()    to authenticated, service_role;
grant execute on function public.is_admin()          to authenticated, service_role;
grant execute on function public.can_write()         to authenticated, service_role;
grant execute on function public.can_view_giving()   to authenticated, service_role;

-- --- 3. Normalisation helpers ----------------------------------------------
--
-- `normalize_email` and `normalize_phone` back generated columns on `contacts`,
-- `leads` and the Mailchimp tables. They are SECURITY INVOKER and are evaluated
-- while inserting, so `authenticated` must retain EXECUTE or every insert
-- fails. They expose nothing — both are pure string functions over their own
-- argument — so leaving them callable is not a disclosure risk.

revoke all on function public.normalize_email(text) from public, anon;
revoke all on function public.normalize_phone(text) from public, anon;
grant execute on function public.normalize_email(text) to authenticated, service_role;
grant execute on function public.normalize_phone(text) to authenticated, service_role;

comment on function public.convert_lead(uuid, uuid) is
  'Atomically converts a lead into a contact. Intentionally callable by signed-in users; it re-checks can_write() internally. The database linter reports this by design.';
