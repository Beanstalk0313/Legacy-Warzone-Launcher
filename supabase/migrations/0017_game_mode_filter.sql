-- 0017: Add game_mode column to servers so each Jupiter mode
-- (multiplayer / warzone / zombies) only sees its own lobbies.

ALTER TABLE public.servers
  ADD COLUMN IF NOT EXISTS game_mode text NOT NULL DEFAULT 'multiplayer';

-- Backfill existing rows (all legacy lobbies are multiplayer).
UPDATE public.servers SET game_mode = 'multiplayer' WHERE game_mode IS NULL;

-- Index for filtered browsing (ServerBrowser queries by mod + game_mode).
CREATE INDEX IF NOT EXISTS idx_servers_game_mode ON public.servers (game_mode);
