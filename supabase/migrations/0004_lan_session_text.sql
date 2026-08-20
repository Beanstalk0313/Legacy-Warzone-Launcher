-- =====================================================================
-- Legacy Warzone Launcher — lan_session: boolean → text (0004)
-- =====================================================================
--
-- Apply via Supabase SQL Editor:
--   1. Open https://supabase.com/dashboard
--   2. Pick your project → SQL Editor (left sidebar)
--   3. Paste this file's contents → Run
--
-- Why this file exists:
--   An earlier draft of 0003 added `lan_session` as a BOOLEAN. The field
--   turned out to be a text input where the host pastes their LAN session
--   code (what the game client needs to connect), so the column must be
--   TEXT. This migration converts databases that already applied the
--   boolean version; fresh installs that run the current 0003 already
--   get the text column, and this block is a safe no-op for them.
--
-- Existing rows are preserved: true → 'true', false → ''.

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'servers'
      and column_name = 'lan_session'
      and data_type = 'boolean'
  ) then
    alter table public.servers
      alter column lan_session type text
      using (case when lan_session then 'true' else '' end);
    alter table public.servers
      alter column lan_session set default '';
  end if;
end $$;
