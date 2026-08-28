# Legacy Modern Warfare III Launcher

A desktop **LFG (Looking For Group) launcher** for the **Jupiter Mod** (Warzone III) private-server community. Pick a mode on the launcher (**Warzone**, **Zombies**, or **Multiplayer**), then browse, join, or host games through a console-style menu with full keyboard + gamepad support.

## Highlights

* **Three game modes** — Warzone, Zombies, and Multiplayer each have their own branded shell, map/mode lists, soundtrack, and accent color (zombies runs a red theme)
* **Quick Play / Server Browser / Host a Match** — find or create lobbies, join friends, and get into games fast
* **Per-mode lobby support** — warzone lobbies push the exec-hash config to the game; zombies/multiplayer lobby through the game's own menus (LAN session join only)
* **Mode music** — each mode plays its own quiet background soundtrack (with a classic zombies track toggle), crossfading on mode switch and ducking when you join/host a match
* **RTM automation** — the Modding tab drives the game through trigger files (no external exe): save-data management, mode switches, LAN joins, guided loadout flows, and a raw RTM DEV TOOL panel
* **Friends & parties** — add friends, create/join parties by code, party auto-joins when the leader enters a lobby
* **Theme-aware UI** — console-style menus with keyboard + gamepad navigation, customizable accent color, controller-glyph detection
* **Display monitor** — pick which monitor the launcher lives on, plus fullscreen/windowed control
* **Device ban system** — pre-sign-in identity check against the backend
* **Auto-updates** — signed installers via GitHub Releases

## Prerequisites

* Node.js 18+
* npm
* Rust toolchain + platform build dependencies (for desktop builds only)

## Setup

```bash
npm install
```

Copy `.env.example` to `.env` and fill in your Supabase credentials:

```
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<your anon key>
```

Without these the app runs fully offline (no auth, no server browser). Apply the SQL migrations under `supabase/migrations/` **in order** if you want the backend.

## Running

```bash
npm run dev            # Vite dev server (browser-only) — http://localhost:5173
npm run build          # production frontend build (dist/)
npm run preview        # preview the production build
npm run tauri:dev      # Tauri dev window (needs Rust toolchain)
npm run tauri:build    # production desktop build (NSIS installer)
```

## Environment variables

### Frontend (`.env`)

| Variable                 | Required | Description                                          |
| ------------------------ | -------- | ---------------------------------------------------- |
| `VITE_SUPABASE_URL`      | No       | Supabase project URL — enables auth, server browser, friends |
| `VITE_SUPABASE_ANON_KEY` | No       | Supabase anon key — safe to ship in the bundle (RLS is the gate) |

### Desktop builds (shell environment)

| Variable            | Required | Description                                                        |
| ------------------- | -------- | -------------------------------------------------------------------|
| `LWZ_IDENTITY_DIR`  | **Yes**  | Folder where the device identity file is stored — baked into the binary at build time |
| `LWZ_IDENTITY_FILE` | **Yes**  | Identity file name (used verbatim, no `.json` appended) — also baked in |

These **must** be set before `npm run tauri:dev` or `npm run tauri:build` — the Rust build fails without them.

## Settings

Settings persist to `Documents/retdonetskmod/settings.json` (desktop). On first run a `settings_default.json` template is also created — hand-edit it and swap it in to override defaults.

Settings include: display mode/monitor, silent mode + music + classic zombies soundtrack toggles, accent color, controller glyph platform, testing server + RTM mode, and the game install path.

## Auto-updates

The app checks GitHub Releases on startup. One-time setup:

1. Generate a signing key: `npm run tauri signer generate -- -w ~/.tauri/legacy-warzone-launcher.key`
2. Paste the **public key** into `src-tauri/tauri.conf.json` → `plugins.updater.pubkey`
3. Add the **private key** to GitHub Actions secrets (`TAURI_SIGNING_PRIVATE_KEY`)
4. Bump the version in `tauri.conf.json`, `Cargo.toml`, and `package.json`, then `git tag v1.x.x && git push origin v1.x.x`

The workflow builds, signs, and creates a draft release, which you can manually edit and then publish.

## Project layout

```
src/                  React app (interface, tabs, utils, styles.css)
src-tauri/            Tauri shell: Rust commands (RTM trigger files, settings, device identity, game install)
supabase/migrations/  Backend schema (apply in order)
AGENTS.md             Full project guide — read before making changes
```