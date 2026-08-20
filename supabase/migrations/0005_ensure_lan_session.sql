-- =====================================================================
-- Legacy Warzone Launcher — ensure LAN session column (0005)
-- =====================================================================
--
-- This is a targeted repair for projects that already created `servers`
-- but never applied 0003/0004. The app sends the LAN session as text.

alter table public.servers
  add column if not exists lan_session text;

-- Ask PostgREST (Supabase's REST API) to reload its schema cache immediately.
notify pgrst, 'reload schema';
