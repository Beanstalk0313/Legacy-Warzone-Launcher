-- =====================================================================
-- Legacy Warzone Launcher — device check also matches gamertag (0016)
-- =====================================================================
--
-- The pre-sign-in device check runs WITHOUT a session (anon role), so the
-- only way check_identity_ban() can link the device identity file to
-- a banned profile is through shared fields. It already matches Discord
-- username and email — but the p_gamertag parameter was accepted and sent
-- by the launcher yet never used in the query. If the banned profile's
-- discord_username is NULL/mismatched AND its auth email differs from
-- the device identity file's, the device slips through even though the
-- gamertag stored in the identity file matches the banned profile's
-- username exactly.
--
-- This migration adds the gamertag → profiles.username match. The launcher
-- stores the sign-up gamertag in profiles.username (handle_new_user), and
-- the device identity file carries the same gamertag, so a banned profile
-- whose username equals the device gamertag now blocks the device.
--
-- Tradeoff: gamertags are NOT guaranteed unique across accounts, so a
-- device whose identity file shares a gamertag with a banned profile on
-- a DIFFERENT account will be blocked too (a false positive). 0013 excluded
-- gamertags from ban matching for exactly this reason, but the device-ban
-- requirement ("block the PC, not just the account") makes the stricter
-- match the right default. Revert by re-running 0013's function body.

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
         -- The current account's own ban (session branch — signed-in check).
         p.user_id = auth.uid()
         -- Shared-identity links used by the pre-sign-in device check.
         or (
           nullif(trim(p_discord_username), '') is not null
           and lower(trim(p.discord_username)) = lower(trim(p_discord_username))
         )
         or (
           nullif(trim(p_email), '') is not null
           and lower(u.email) = lower(trim(p_email))
         )
         -- Device-side gamertag link (0016): identity-file gamertag ↔
         -- profiles.username.
         or (
           nullif(trim(p_gamertag), '') is not null
           and lower(trim(p.username)) = lower(trim(p_gamertag))
         )
       )
  );
$$;

-- Keep the same role grants: anon execute is required for the pre-sign-in
-- device check; authenticated covers signed-in account checks.
revoke execute on function public.check_identity_ban(text, text, text) from public;
grant execute on function public.check_identity_ban(text, text, text) to authenticated, anon;

notify pgrst, 'reload schema';
