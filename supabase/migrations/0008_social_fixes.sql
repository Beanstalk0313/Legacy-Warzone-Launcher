-- =====================================================================
-- Legacy Warzone Launcher — social fixes (0008)
-- =====================================================================
--
-- Apply via Supabase SQL Editor:
--   1. Open https://supabase.com/dashboard
--   2. Pick your project → SQL Editor (left sidebar)
--   3. Paste this file's contents → Run
--
-- The migration is idempotent (DROP POLICY IF EXISTS, CREATE OR REPLACE
-- FUNCTION, guarded UPDATE) so re-running it is safe.
--
-- Changes:
--   1. Lets any authenticated user look up a party by its invite code.
--      Join-by-code was silently failing: the only SELECT policy on
--      `parties` allowed the leader or existing members to read a row, so
--      the join query (`select ... where invite_code = :code`) returned
--      nothing and the app reported "No party found with that code."
--      Invite codes are the shareable join mechanism, so any party that
--      HAS a code is readable by any signed-in user.
--   2. handle_new_user() now also reads `raw_user_meta_data->>'gamertag'`
--      when `username` is absent. The launcher sends the sign-up gamertag
--      under the `gamertag` key (used by the frontend's display-name
--      chain), but the trigger only ever looked at `username` — so
--      profiles.username stayed NULL and friend search by gamertag
--      matched nothing. Accepting both keys keeps old + new clients safe.
--   3. Backfills profiles.username for existing accounts from
--      auth.users.raw_user_meta_data->>'gamertag' so accounts created
--      before this fix become searchable by their gamertag.

-- ---------------------------------------------------------------------
-- 1) Join-by-code: any authenticated user can read a coded party
-- ---------------------------------------------------------------------
drop policy if exists "anyone can look up parties by invite code" on public.parties;
create policy "anyone can look up parties by invite code"
  on public.parties for select
  to authenticated
  using (invite_code is not null);

-- ---------------------------------------------------------------------
-- 2) handle_new_user: accept the gamertag key as a username source
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user() returns trigger
  language plpgsql security definer set search_path = public as $$
declare
  attempted_username text := coalesce(
    new.raw_user_meta_data->>'username',
    new.raw_user_meta_data->>'gamertag'
  );
begin
  -- Wrap the username-storing branch in an EXCEPTION block so a malformed
  -- payload (e.g. a direct API call that bypassed the AccountTab's
  -- client-side validation) REJECTING the CHECK constraint cannot abort
  -- the whole auth.users insert — that would surface as a confusing
  -- Supabase signup error in the running app. Silently drop the bad
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

-- ---------------------------------------------------------------------
-- 3) Backfill usernames for pre-0008 accounts (gamertag already lives in
--    auth.users.raw_user_meta_data under the `gamertag` key).
-- ---------------------------------------------------------------------
update public.profiles p
  set username = u.raw_user_meta_data->>'gamertag'
  from auth.users u
  where p.user_id = u.id
    and p.username is null
    and u.raw_user_meta_data->>'gamertag' is not null
    and u.raw_user_meta_data->>'gamertag' ~ '^[A-Za-z0-9_.]{3,20}$';

-- Ask PostgREST (Supabase's REST API) to reload its schema cache immediately.
notify pgrst, 'reload schema';
