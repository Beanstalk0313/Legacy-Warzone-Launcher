-- =====================================================================
-- Legacy Warzone Launcher — mod filters, server members, parties (0007)
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
-- The migration is idempotent (ADD COLUMN IF NOT EXISTS, CREATE TABLE IF
-- NOT EXISTS, DROP POLICY IF EXISTS) so re-running it is safe.
--
-- Changes:
--   1. `servers.mod` ('iw8' | 'jupiter') — lets each interface show only
--      its own mod's lobbies. Backfills existing rows from `version`
--      ('Jupiter' → jupiter, everything else → iw8).
--   2. `servers.instance_id` — a per-app-launch id so a fresh app process
--      can delete lobbies left behind by a previous (possibly force-killed)
--      process on startup.
--   3. `server_members` — who is currently sitting in a lobby. Signed-in
--      players store their user_id + display name; guests get a random
--      `player_code` (e.g. "Player#123456"). The host's dashboard polls this
--      to show who is in the game; member clients heartbeat `last_seen_at`
--      so stale rows can be pruned.
--   4. `parties` + `party_members` — the party system. The leader's
--      `leader_server_id` is the "join this server" broadcast: when the
--      leader joins a lobby the launcher sets it, and each member's client
--      auto-runs the join flow for that server. NULL on delete of the
--      server row (ON DELETE SET NULL).
--   5. `party_invites` — friend → party invitations. Pending invites are
--      polled by the launcher so the invitee gets an in-app notification
--      and can accept/decline from the toast or the Social tab.

-- ---------------------------------------------------------------------
-- 1) servers: mod filter + instance id
-- ---------------------------------------------------------------------
alter table public.servers
  add column if not exists mod text;

alter table public.servers
  add column if not exists instance_id text;

-- Backfill existing rows: Jupiter lobbies were version 'Jupiter', IW8
-- lobbies used version strings like '1.44' / '1.64' / 'Other'.
update public.servers
  set mod = case when version = 'Jupiter' then 'jupiter' else 'iw8' end
  where mod is null;

create index if not exists servers_mod_idx on public.servers(mod);

-- ---------------------------------------------------------------------
-- 2) server_members — players currently in a lobby
-- ---------------------------------------------------------------------
create table if not exists public.server_members (
  id bigserial primary key,
  server_id bigint not null references public.servers(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  display_name text,
  player_code text,
  last_seen_at timestamp with time zone default now(),
  created_at timestamp with time zone default now()
);

-- One member row per signed-in player per server; guests are identified by
-- their player_code (user_id IS NULL).
create unique index if not exists server_members_signedin_uniq
  on public.server_members (server_id, user_id)
  where user_id is not null;

create index if not exists server_members_server_idx
  on public.server_members (server_id);

create index if not exists server_members_stale_idx
  on public.server_members (server_id, last_seen_at);

alter table public.server_members enable row level security;

-- The host of a server can see who is in their lobby (needed for the
-- hosting dashboard's player list).
drop policy if exists "host reads server members" on public.server_members;
create policy "host reads server members"
  on public.server_members for select
  to authenticated
  using (
    exists (
      select 1 from public.servers s
      where s.id = server_id and s.host_user_id = auth.uid()
    )
  );

-- Any player — signed in or guest — can register in a lobby. Guests must
-- supply a player_code (their user_id stays null).
drop policy if exists "players register in lobbies" on public.server_members;
create policy "players register in lobbies"
  on public.server_members for insert
  to anon, authenticated
  with check (
    (user_id is not null and auth.uid() = user_id)
    or (user_id is null and player_code is not null)
  );

-- A player can heartbeat their own row (keeps last_seen_at fresh so the
-- host knows they're still here). Guests update via their player_code.
--
-- Known tradeoff: a guest can update/delete ANY guest row (the policy can't
-- compare against the client's player_code). The app narrows every query by
-- (server_id, player_code) so a guest only ever touches their own row in
-- practice; the residual risk (spoofing another guest's heartbeat in a game
-- lobby) is accepted for v1 — a per-row secret would be needed to close it.
drop policy if exists "players heartbeat own membership" on public.server_members;
create policy "players heartbeat own membership"
  on public.server_members for update
  to anon, authenticated
  using (
    (user_id is not null and user_id = auth.uid())
    or (user_id is null and player_code is not null)
  );

-- Leaving a lobby removes your own row. Hosts can also clear out rows for
-- their server (e.g. pruning stale guests).
drop policy if exists "players leave lobbies" on public.server_members;
create policy "players leave lobbies"
  on public.server_members for delete
  to anon, authenticated
  using (
    (user_id is not null and user_id = auth.uid())
    or (user_id is null and player_code is not null)
    or exists (
      select 1 from public.servers s
      where s.id = server_id and s.host_user_id = auth.uid()
    )
  );

-- ---------------------------------------------------------------------
-- 3) parties + party_members
-- ---------------------------------------------------------------------
create table if not exists public.parties (
  id uuid primary key default gen_random_uuid(),
  leader_user_id uuid not null references auth.users(id) on delete cascade,
  invite_code text unique,
  -- The server the leader is currently in — the auto-join broadcast.
  -- Set when the leader joins a lobby, cleared when they leave or the
  -- server row is deleted (ON DELETE SET NULL).
  leader_server_id bigint references public.servers(id) on delete set null,
  created_at timestamp with time zone default now()
);

create index if not exists parties_leader_idx on public.parties(leader_user_id);

create table if not exists public.party_members (
  party_id uuid not null references public.parties(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamp with time zone default now(),
  primary key (party_id, user_id)
);

alter table public.parties enable row level security;
alter table public.party_members enable row level security;

-- Security-definer helper: is the current user in the given party (as a
-- member, or as its leader)? Bypasses RLS so the member policies below can
-- check party membership without recursing into the same table's policy.
create or replace function public.is_in_party(check_party uuid) returns boolean
  language sql security definer stable set search_path = public as $$
  select exists (
    select 1 from public.party_members pm
    where pm.party_id = check_party and pm.user_id = auth.uid()
  )
  or exists (
    select 1 from public.parties p
    where p.id = check_party and p.leader_user_id = auth.uid()
  );
$$;

-- Party row: the leader creates it; everyone in the party can read it
-- (members need leader_server_id + invite_code for the auto-join watcher).
drop policy if exists "leader creates party" on public.parties;
create policy "leader creates party"
  on public.parties for insert
  to authenticated
  with check (auth.uid() = leader_user_id);

drop policy if exists "party members read party" on public.parties;
create policy "party members read party"
  on public.parties for select
  to authenticated
  using (leader_user_id = auth.uid() or public.is_in_party(id));

-- The leader can update the party (invite_code, leader_server_id). Members
-- must NOT update it.
drop policy if exists "leader updates party" on public.parties;
create policy "leader updates party"
  on public.parties for update
  to authenticated
  using (auth.uid() = leader_user_id);

drop policy if exists "leader deletes party" on public.parties;
create policy "leader deletes party"
  on public.parties for delete
  to authenticated
  using (auth.uid() = leader_user_id);

-- party_members: join with your own user_id, leave by deleting your own row,
-- read anyone's membership of a party you are in (for member lists).
drop policy if exists "players join party" on public.party_members;
create policy "players join party"
  on public.party_members for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "party members read memberships" on public.party_members;
create policy "party members read memberships"
  on public.party_members for select
  to authenticated
  using (user_id = auth.uid() or public.is_in_party(party_id));

drop policy if exists "players leave party" on public.party_members;
create policy "players leave party"
  on public.party_members for delete
  to authenticated
  using (auth.uid() = user_id);

-- ---------------------------------------------------------------------
-- 4) party_invites — friend → party invitations
-- ---------------------------------------------------------------------
create table if not exists public.party_invites (
  id bigserial primary key,
  party_id uuid not null references public.parties(id) on delete cascade,
  invited_by_user_id uuid not null references auth.users(id) on delete cascade,
  invitee_user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  created_at timestamp with time zone default now(),
  unique (party_id, invitee_user_id)
);

create index if not exists party_invites_invitee_idx
  on public.party_invites (invitee_user_id, status);

alter table public.party_invites enable row level security;

-- The inviter sends the invite.
drop policy if exists "leader sends party invites" on public.party_invites;
create policy "leader sends party invites"
  on public.party_invites for insert
  to authenticated
  with check (auth.uid() = invited_by_user_id);

-- The invitee can read their own invites (notification polling) and the
-- inviter can read theirs (to show "invited" state).
drop policy if exists "invite parties read invites" on public.party_invites;
create policy "invite parties read invites"
  on public.party_invites for select
  to authenticated
  using (auth.uid() = invitee_user_id or auth.uid() = invited_by_user_id);

-- The invitee accepts/declines.
drop policy if exists "invitee updates invite" on public.party_invites;
create policy "invitee updates invite"
  on public.party_invites for update
  to authenticated
  using (auth.uid() = invitee_user_id);

-- The inviter can retract an invite.
drop policy if exists "inviter deletes invite" on public.party_invites;
create policy "inviter deletes invite"
  on public.party_invites for delete
  to authenticated
  using (auth.uid() = invited_by_user_id);

-- ---------------------------------------------------------------------
-- 5) Grants
-- ---------------------------------------------------------------------
-- server_members: guests (anon) may register + heartbeat; authenticated can
-- do everything their policies allow.
grant select, insert, update, delete on table public.server_members to anon, authenticated;
grant usage, select on sequence server_members_id_seq to anon, authenticated;

-- parties / party_members / party_invites are authenticated-only features.
grant select, insert, update, delete on table public.parties to authenticated;
grant select, insert, update, delete on table public.party_members to authenticated;
grant select, insert, update, delete on table public.party_invites to authenticated;
grant usage, select on sequence party_invites_id_seq to authenticated;

-- Ask PostgREST (Supabase's REST API) to reload its schema cache immediately.
notify pgrst, 'reload schema';
