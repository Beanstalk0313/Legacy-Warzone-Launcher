-- =====================================================================
-- Legacy Warzone Launcher — LAN sessions + public browsing (0003)
-- =====================================================================
--
-- Apply via Supabase SQL Editor:
--   1. Open https://supabase.com/dashboard
--   2. Pick your project → SQL Editor (left sidebar)
--   3. Paste this file's contents → Run
--
-- Or via the Supabase CLI (after `supabase init` + `supabase link`):
--   supabase db push
--
-- The migration is idempotent (ADD COLUMN IF NOT EXISTS, DROP POLICY IF
-- EXISTS, CREATE OR REPLACE VIEW) so re-running it is safe.
--
-- Changes:
--   1. Adds `servers.lan_session` (text) — the LAN Session code a host
--      pastes into the Host a Match form. It is what the game client
--      needs when connecting to this server (not "same Wi-Fi": these
--      private-server mods run LAN-style sessions even over the
--      internet). Empty/NULL means no LAN session. (If you already ran
--      an earlier 0003 where this column was boolean, run 0004 to
--      convert it.)
--   2. Relaxes the `servers` SELECT policy so anyone (anon included) can
--      browse public lobbies without signing in. Hosting (INSERT) still
--      requires an authenticated session, and private lobbies remain
--      visible only to their host.
--   3. Adds a public `profile_names` view exposing ONLY user_id +
--      username/display_name so the server browser can label hosts
--      without leaking emails or Discord ids.

-- ---------------------------------------------------------------------
-- 1) LAN session code on servers (pasted text, not a boolean)
-- ---------------------------------------------------------------------
alter table public.servers
  add column if not exists lan_session text;

-- ---------------------------------------------------------------------
-- 2) Public browsing of public lobbies (guests can browse, not host)
-- ---------------------------------------------------------------------
drop policy if exists "authenticated users can view public servers" on public.servers;
drop policy if exists "anyone can view public servers" on public.servers;
create policy "anyone can view public servers"
  on public.servers for select
  to anon, authenticated
  using (is_private = false or auth.uid() = host_user_id);

-- ---------------------------------------------------------------------
-- 3) Public host-name labels (user_id + username/display_name only)
-- ---------------------------------------------------------------------
-- Views run with definer rights (owner = postgres), so RLS on profiles
-- is bypassed here — which is exactly why the view projects a whitelist
-- of columns and nothing else. Grants below open it to anonymous users.
create or replace view public.profile_names as
  select
    user_id,
    username,
    display_name
  from public.profiles;

grant select on public.profile_names to anon, authenticated;
