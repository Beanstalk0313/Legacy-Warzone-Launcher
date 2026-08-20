-- =====================================================================
-- Legacy Warzone Launcher — initial Supabase schema (0001)
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
-- The migration is idempotent: it uses CREATE TABLE IF NOT EXISTS, DROP
-- TRIGGER IF EXISTS, and ON CONFLICT DO NOTHING so running it twice will
-- not error out.
--
-- All three tables below have RLS enabled with policies keyed on auth.uid()
-- so users can only read/write their own rows (except `servers`, where
-- public rows are visible to everyone but only the host can mutate).

-- ---------------------------------------------------------------------
-- 1) profiles — per-user metadata mirror of auth.users
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  discord_id text unique,
  discord_username text,
  discord_avatar_url text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

alter table public.profiles enable row level security;

-- Every policy is restricted to the `authenticated` role so anonymous
-- requests (the anon key with no active session) cannot read or write
-- anything, even public server rows. Tradeoff: a fresh user must sign in
-- before seeing any in-app data. The Discord button on the launcher keeps
-- that friction to one click.
drop policy if exists "users can view own profile" on public.profiles;
create policy "users can view own profile"
  on public.profiles for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "users can update own profile" on public.profiles;
create policy "users can update own profile"
  on public.profiles for update
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "users can insert own profile" on public.profiles;
create policy "users can insert own profile"
  on public.profiles for insert
  to authenticated
  with check (auth.uid() = user_id);

-- Auto-create a profile row the moment a user signs up. The trigger pulls
-- any Discord identity off the `raw_user_meta_data` Supabase attaches to
-- identities and mirrors it onto the public row. Falls back gracefully
-- for email signups (where the metadata fields don't exist).
create or replace function public.handle_new_user() returns trigger
  language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (
    user_id, display_name, discord_id, discord_username, discord_avatar_url
  ) values (
    new.id,
    coalesce(
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

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- ---------------------------------------------------------------------
-- 2) friendships — mutual relationships between users
-- ---------------------------------------------------------------------
create table if not exists public.friendships (
  id bigserial primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  friend_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'accepted' check (status in ('pending', 'accepted', 'blocked')),
  created_at timestamp with time zone default now(),
  unique (user_id, friend_id),
  check (user_id <> friend_id)
);

create index if not exists friendships_user_idx on public.friendships(user_id);
create index if not exists friendships_friend_idx on public.friendships(friend_id);

alter table public.friendships enable row level security;

drop policy if exists "users can read own friendships" on public.friendships;
create policy "users can read own friendships"
  on public.friendships for select
  to authenticated
  using (auth.uid() = user_id or auth.uid() = friend_id);

drop policy if exists "users can add friends" on public.friendships;
create policy "users can add friends"
  on public.friendships for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "users can update own outgoing friendships" on public.friendships;
create policy "users can update own outgoing friendships"
  on public.friendships for update
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "users can remove own friendships" on public.friendships;
create policy "users can remove own friendships"
  on public.friendships for delete
  to authenticated
  using (auth.uid() = user_id or auth.uid() = friend_id);

-- ---------------------------------------------------------------------
-- 3) servers — game lobbies, public or private
-- ---------------------------------------------------------------------
create table if not exists public.servers (
  id bigserial primary key,
  host_user_id uuid references auth.users(id) on delete set null,
  name text not null,
  description text,
  version text not null,
  map text not null,
  mode text not null,
  region text,
  players_current int not null default 0,
  players_max int not null default 0,
  is_private boolean not null default false,
  join_code text,
  ip text,
  port int,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

create index if not exists servers_region_idx on public.servers(region);
create index if not exists servers_visibility_idx on public.servers(is_private, created_at desc);
create index if not exists servers_host_idx on public.servers(host_user_id);

alter table public.servers enable row level security;

-- Only signed-in users see lobbies. A user can read every public lobby plus
-- their own private ones. Note on edge case: when a host deletes their
-- Supabase account, host_user_id becomes NULL via ON DELETE SET NULL.
-- is_private rows then match neither branch and become invisible to
-- everyone (intentional privacy default — better than leaking a private
-- lobby the new "anonymous" requester shouldn't see). is_public rows
-- remain browsable by everyone, which is the intended graceful fallback.
drop policy if exists "authenticated users can view public servers" on public.servers;
create policy "authenticated users can view public servers"
  on public.servers for select
  to authenticated
  using (is_private = false or auth.uid() = host_user_id);

drop policy if exists "authenticated users can host servers" on public.servers;
create policy "authenticated users can host servers"
  on public.servers for insert
  to authenticated
  with check (auth.uid() = host_user_id);

drop policy if exists "host can update own server" on public.servers;
create policy "host can update own server"
  on public.servers for update
  to authenticated
  using (auth.uid() = host_user_id);

drop policy if exists "host can delete own server" on public.servers;
create policy "host can delete own server"
  on public.servers for delete
  to authenticated
  using (auth.uid() = host_user_id);
