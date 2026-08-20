-- =====================================================================
-- Legacy Warzone Launcher — friend nicknames (0012)
-- =====================================================================
--
-- Apply via Supabase SQL Editor:
--   1. Open https://supabase.com/dashboard
--   2. Pick your project → SQL Editor (left sidebar)
--   3. Paste this file's contents → Run
--
-- The migration is idempotent (CREATE TABLE IF NOT EXISTS, DROP POLICY
-- IF EXISTS) so re-running it is safe.
--
-- Why: each user can give their friends a personal nickname (set from the
-- Social tab's friend-row context menu) that overrides the gamertag
-- wherever that friend appears. Nicknames are per-viewer, so they live in
-- their own table keyed by (viewer user_id, friend_id) rather than on the
-- shared `friendships` row.

create table if not exists public.friend_nicknames (
  user_id uuid not null references auth.users(id) on delete cascade,
  friend_id uuid not null references auth.users(id) on delete cascade,
  nickname text not null check (char_length(nickname) between 1 and 24),
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  primary key (user_id, friend_id)
);

alter table public.friend_nicknames enable row level security;

-- A user manages only their own nickname rows (the (viewer, friend) pair
-- they own). `for all` covers select/update/delete via `using` and
-- insert/update via `with check`.
drop policy if exists "users manage own nicknames" on public.friend_nicknames;
create policy "users manage own nicknames"
  on public.friend_nicknames for all
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- authenticated-only feature (matches friendships / parties grants).
grant select, insert, update, delete on table public.friend_nicknames to authenticated;

-- Ask PostgREST (Supabase's REST API) to reload its schema cache immediately.
notify pgrst, 'reload schema';
