-- =====================================================================
-- Legacy Warzone Launcher — lobby member roster (0010)
-- =====================================================================
--
-- Apply via Supabase SQL Editor:
--   1. Open https://supabase.com/dashboard
--   2. Pick your project → SQL Editor (left sidebar)
--   3. Paste this file's contents → Run
--
-- The migration is idempotent (DROP POLICY IF EXISTS + CREATE POLICY)
-- so re-running it is safe.
--
-- Why: the right-side player roster shows EVERYONE in the lobby you
-- joined — not just your party. Migration 0007 only let the HOST read
-- `server_members` ("host reads server members"), so a joined member's
-- client couldn't fetch the roster at all. This adds a SELECT policy
-- mirroring the servers browse policy (migration 0003): any anon or
-- authenticated client can read the member rows of a public lobby
-- (is_private = false, or their own hosted lobby). Guest players who
-- joined with a player_code can read it too. RLS policies are OR'd, so
-- the existing host policy is left in place.

-- ---------------------------------------------------------------------
-- server_members: anyone can read who is in a public lobby
-- ---------------------------------------------------------------------
drop policy if exists "anyone reads public lobby members" on public.server_members;
create policy "anyone reads public lobby members"
  on public.server_members for select
  to anon, authenticated
  using (
    exists (
      select 1 from public.servers s
      where s.id = server_id
        and (s.is_private = false or s.host_user_id = auth.uid())
    )
  );

-- Ask PostgREST (Supabase's REST API) to reload its schema cache immediately.
notify pgrst, 'reload schema';
