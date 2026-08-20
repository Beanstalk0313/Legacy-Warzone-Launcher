-- =====================================================================
-- Legacy Warzone Launcher — friendships / profiles grants (0011)
-- =====================================================================
--
-- Apply via Supabase SQL Editor:
--   1. Open https://supabase.com/dashboard
--   2. Pick your project → SQL Editor (left sidebar)
--   3. Paste this file's contents → Run
--
-- The migration is idempotent (GRANT is safe to re-run).
--
-- Why: `friendships` (migration 0001) and `profiles` (migration 0001)
-- were created with RLS policies but the `authenticated` role was never
-- GRANTed privileges on them — so every query fails with "permission
-- denied for table friendships" / "permission denied for table profiles".
-- (The add-friend flow, the friend list, and the Account tab's region
-- load/save all hit these tables; the region saves were silently failing
-- for the same reason — which is why player-card flags showed the neutral
-- globe even after picking a region.)
--
-- Only `authenticated` is granted — both tables' policies are
-- authenticated-only (no anon access), and the parties/server grants in
-- 0007 follow the same pattern. `friendships.id` is a bigserial, so its
-- sequence needs usage+select for INSERTs that rely on the default.

-- ---------------------------------------------------------------------
-- friendships — authenticated friend system
-- ---------------------------------------------------------------------
grant select, insert, update, delete on table public.friendships to authenticated;
grant usage, select on sequence friendships_id_seq to authenticated;

-- ---------------------------------------------------------------------
-- profiles — authenticated users read/update their own row (no sequence:
-- user_id is the PK; the sign-up trigger is security definer and inserts
-- the row regardless of these grants). Grants mirror the existing
-- policies (no delete policy exists on profiles).
-- ---------------------------------------------------------------------
grant select, insert, update on table public.profiles to authenticated;

-- Ask PostgREST (Supabase's REST API) to reload its schema cache immediately.
notify pgrst, 'reload schema';
