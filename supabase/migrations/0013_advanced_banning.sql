-- =====================================================================
-- Legacy Warzone Launcher — advanced banning (0013)
-- =====================================================================
--
-- Apply this migration in Supabase SQL Editor after 0012.
--
-- Changes:
--   1. Adds `profiles.is_banned`, editable by an administrator in the
--      Supabase dashboard Table Editor.
--   2. Stores the launcher's required `discord_username` signup metadata
--      on the profile row and backfills any metadata already present.
--   3. Adds `check_identity_ban()`, a security-definer RPC that returns only
--      true/false to an authenticated launcher client. It blocks when the
--      current account is banned, when ANY account shares the local file's
--      Discord username with a banned account, or when ANY account shares its
--      email with a banned account. Gamertag is deliberately not a
--      cross-account match.

-- ---------------------------------------------------------------------
-- 1) Administrator-controlled ban flag
-- ---------------------------------------------------------------------
alter table public.profiles
  add column if not exists is_banned boolean not null default false;

-- The older profiles grant allowed authenticated users to update every
-- column on their own row. Replace it with a column-scoped grant so a client
-- can never clear or set the administrator-controlled ban flag.
revoke update on table public.profiles from authenticated;
grant update (display_name, discord_id, discord_username, discord_avatar_url, username, region)
  on table public.profiles to authenticated;

-- ---------------------------------------------------------------------
-- 2) Keep new email signups' Discord identity on the profile row
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user() returns trigger
  language plpgsql security definer set search_path = public as $$
declare
  attempted_username text := coalesce(
    new.raw_user_meta_data->>'username',
    new.raw_user_meta_data->>'gamertag'
  );
  attempted_discord_username text := nullif(
    trim(new.raw_user_meta_data->>'discord_username'),
    ''
  );
begin
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
    attempted_discord_username,
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (user_id) do nothing;
  return new;
end;
$$;

update public.profiles p
   set discord_username = nullif(trim(u.raw_user_meta_data->>'discord_username'), '')
  from auth.users u
 where p.user_id = u.id
   and p.discord_username is null
   and nullif(trim(u.raw_user_meta_data->>'discord_username'), '') is not null;

-- ---------------------------------------------------------------------
-- 3) Secure boolean ban check for the desktop client
-- ---------------------------------------------------------------------
create or replace function public.check_identity_ban(
  p_discord_username text,
  p_email text,
  p_gamertag text
) returns boolean
  language sql
  security definer
  set search_path = public, auth
as $$
  select exists (
    select 1
      from public.profiles p
      left join auth.users u on u.id = p.user_id
     where coalesce(p.is_banned, false)
       and (
         -- The current account's own ban always applies. This is the
         -- gamertag/account-specific branch; gamertags are not shared bans.
         p.user_id = auth.uid()
         -- Discord username and email are shared-identity ban links.
         or (
           nullif(trim(p_discord_username), '') is not null
           and lower(trim(p.discord_username)) = lower(trim(p_discord_username))
         )
         or (
           nullif(trim(p_email), '') is not null
           and lower(u.email) = lower(trim(p_email))
         )
       )
  );
$$;

-- Do not expose the function to unauthenticated callers. The function only
-- returns a boolean, but keeping it authenticated-only prevents anonymous
-- probing of identity combinations.
revoke execute on function public.check_identity_ban(text, text, text) from public;
grant execute on function public.check_identity_ban(text, text, text) to authenticated;

notify pgrst, 'reload schema';
