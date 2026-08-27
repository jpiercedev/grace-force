-- ---------------------------------------------------------------------------
-- Forced password rotation on first sign-in.
--
-- An administrator who provisions an account has to pick its first password,
-- which means that password has been typed into a chat, an email or a sticky
-- note before its owner ever sees it. The account is only really theirs once
-- they have replaced it, so accounts can be marked "must change password" and
-- the application refuses to serve anything else until they have.
--
-- **The flag lives in `auth.users.raw_app_meta_data`, deliberately.** The
-- obvious home is a column on `public.profiles`, and it is the wrong one:
-- `profiles_update` lets a person update their own row, and
-- `protect_profile_privileges` only restores `role`, `is_active` and
-- `can_view_giving`. A boolean on `profiles` would therefore be clearable by
-- the very person it is meant to constrain, with one PATCH and no password
-- change — which is not a guard, it is a suggestion.
--
-- `app_metadata` has the property the guard needs: GoTrue accepts `data`
-- (user metadata) on a user-initiated update and silently refuses
-- `app_metadata`, which only the service role can write. It also comes back
-- fresh from `getUser()`, so the application reads live state rather than
-- whatever the JWT was minted with.
--
-- To require a rotation:
--   update auth.users
--      set raw_app_meta_data =
--            coalesce(raw_app_meta_data, '{}'::jsonb)
--            || '{"must_change_password": true}'::jsonb
--    where email = '...';
-- ---------------------------------------------------------------------------

-- Clearing is not the application's job, because an application that clears
-- its own guard can be talked into clearing it without doing the work. The
-- flag is dropped here, by the database, if and only if the password hash
-- actually changed — so "the flag is gone" and "the password was rotated" are
-- the same fact rather than two that have to agree.
--
-- BEFORE UPDATE, editing NEW in place: no second statement, so no RLS policy
-- and no trigger on `profiles` sits between the rotation and the clearance.
create or replace function public.clear_password_rotation_flag()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.encrypted_password is distinct from old.encrypted_password then
    new.raw_app_meta_data :=
      coalesce(new.raw_app_meta_data, '{}'::jsonb) - 'must_change_password';
  end if;
  return new;
end;
$$;

comment on function public.clear_password_rotation_flag() is
  'Drops the must_change_password flag when, and only when, the password hash changes.';

drop trigger if exists on_auth_password_rotated on auth.users;
create trigger on_auth_password_rotated
  before update on auth.users
  for each row execute function public.clear_password_rotation_flag();
