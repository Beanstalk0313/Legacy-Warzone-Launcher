-- =====================================================================
-- Legacy Warzone Launcher — username column on profiles (0002)
-- =====================================================================
--
-- Apply via Supabase SQL Editor:
--   1. Open https://supabase.com/dashboard
--   2. Pick your project → SQL Editor (left sidebar)
--   3. Paste this file's contents → Run
--
-- This migration is idempotent (ADD COLUMN IF NOT EXISTS, CREATE INDEX IF
-- NOT EXISTS, CREATE OR REPLACE on the trigger function) so re-running it
-- is safe.
--
-- Why a separate file instead of editing 0001:
--   Anyone who already ran 0001 has the original schema on their db. We
--   keep their history intact and just layer a 0002 on top. Drop-in.
--
-- Changes:
--   1. Adds `public.profiles.username` with a partial-unique index
--      (NULLs allowed; uniqueness applies only when present).
--   2. Re-points `handle_new_user()` so it picks up the username from
--      `raw_user_meta_data->>'username'`. Email sign-ups in AccountTab
--      ship the username via `options.data: { username }` so it shows up
--      there; OAuth providers (Discord/Google) don't set it, so they fall
--      back to whatever the existing display_name coalesce picked.

-- ---------------------------------------------------------------------
-- 1) username column + uniqueness
-- ---------------------------------------------------------------------
alter table public.profiles
  add column if not exists username text;

create unique index if not exists profiles_username_unique_idx
  on public.profiles (username)
  where username is not null;

-- ---------------------------------------------------------------------
-- 2) updated handle_new_user trigger
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user() returns trigger
  language plpgsql security definer set search_path = public as $$
declare
  attempted_username text := new.raw_user_meta_data->>'username';
begin
  -- Wrap the username-storing branch in an EXCEPTION block so a malformed
  -- payload (e.g. a direct API call that bypassed the AccountTab's
  -- client-side validation) REJECTING the CHECK constraint cannot abort
  -- the whole auth.users insert — that would surface as a confusing
  -- Supabase signup error in the running app. silently drop the bad
  -- username; profiles.display_name will still populate so the row is
  -- usable, and the user simply picks a valid username via AccountTab
  -- later.
  if attempted_username is not null
     and attempted_username !~ '^[A-Za-z0-9_.]{3,20}$' then
    attempted_username := null;
  end if;

  insert into public.profiles (
    user_id,
    username,
    display_name,
    discord_id,
    discord_username,
    discord_avatar_url
  ) values (
    new.id,
    attempted_username,
    coalesce(
      attempted_username,
      new.raw_user_meta_data->>'full_name',
      new.raw_user_meta_data->>'name',
      split_part(new.email, '@', 1)
    ),
    new.raw_user_meta_data->>'provider_id',
    new.raw_user_meta_data->>'full_name',
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ---------------------------------------------------------------------
-- 3) RLS policy update — let users change their own username
-- ---------------------------------------------------------------------
-- (The existing "users can update own profile" policy already lets them
-- update any column on their own row, so no new policy is strictly
-- necessary. We DO add a check constraint here to enforce the same
-- format AccountTab validates on the client side: keeps bad-form
-- usernames out of the row even if someone hits the API directly.)
alter table public.profiles
  drop constraint if exists profiles_username_format_chk;
alter table public.profiles
  add constraint profiles_username_format_chk
  check (username is null or username ~ '^[A-Za-z0-9_.]{3,20}$');
