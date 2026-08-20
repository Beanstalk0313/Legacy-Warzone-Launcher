-- =====================================================================
-- Legacy Warzone Launcher — player region (0009)
-- =====================================================================
--
-- Apply via Supabase SQL Editor:
--   1. Open https://supabase.com/dashboard
--   2. Pick your project → SQL Editor (left sidebar)
--   3. Paste this file's contents → Run
--
-- The migration is idempotent (ADD COLUMN IF NOT EXISTS, CREATE OR
-- REPLACE VIEW) so re-running it is safe.
--
-- Changes:
--   1. Adds `profiles.region` (free text — the launcher uses the region
--      vocabulary 'North America' / 'South America' / 'Europe' /
--      'Asia Pacific' / 'Middle East' / 'Oceania'; NULL when unset).
--      Set from the Account tab; shown as a horizontal flag on the
--      home screen's party player cards.
--   2. Adds `region` to the public `profile_names` view so party
--      members can read each other's region for those player cards.
--      CREATE OR REPLACE VIEW preserves the existing grants, so the
--      view stays readable by anon + authenticated.

-- ---------------------------------------------------------------------
-- 1) region on profiles
-- ---------------------------------------------------------------------
alter table public.profiles
  add column if not exists region text;

-- ---------------------------------------------------------------------
-- 2) expose region through profile_names (public, whitelisted columns)
-- ---------------------------------------------------------------------
create or replace view public.profile_names as
  select
    user_id,
    username,
    display_name,
    region
  from public.profiles;

-- Ask PostgREST (Supabase's REST API) to reload its schema cache immediately.
notify pgrst, 'reload schema';
