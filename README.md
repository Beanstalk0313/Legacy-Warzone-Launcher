# Legacy Warzone Launcher

A desktop LFG (Looking For Group) launcher for private-server Call of Duty communities — primarily **Jupiter Mod** (Warzone III), with a work-in-progress **IW8 Mod** (Warzone 1) shell that is not a current priority.

## Highlights

* **Quick Play / Server Browser / Host a Match** — find or create lobbies, join friends, and get into games fast
* **RTM automation** — the Modding tab drives the game through trigger files (no external exe): prep sequences, config commands, LAN joins, save-data management, guided loadout flows
* **Friends \& parties** — add friends, create/join parties by code, party auto-joins when the leader enters a lobby
* **Theme-aware UI** — console-style menus with keyboard + gamepad navigation, customizable accent colors, theme-aware SFX
* **Display Monitor** — pick which monitor the launcher lives on
* **Device ban system** — pre-sign-in identity check against the backend
* **Auto-updates** — signed installers via GitHub Releases

> \*\*IW8 is very WIP and not a priority.\*\* The Jupiter shell is fully featured; the IW8 shell is a stub that exists for Dynamic Interfaces swaps. Don't expect IW8-specific features to land soon.

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
VITE\_SUPABASE\_URL=https://<project-ref>.supabase.co
VITE\_SUPABASE\_ANON\_KEY=<your anon key>
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

### Jupiter-only variants

Renders only the Warzone III tile, full-screen — no IW8 option.

```bash
npm run dev:jupiter
npm run build:jupiter
npm run tauri:dev:jupiter
npm run tauri:build:jupiter
```

## Environment variables

### Frontend (`.env`)

|Variable|Required|Description|
|-|-|-|
|`VITE\_SUPABASE\_URL`|No|Supabase project URL — enables auth, server browser, friends|
|`VITE\_SUPABASE\_ANON\_KEY`|No|Supabase anon key — safe to ship in the bundle (RLS is the gate)|

### Desktop builds (shell environment)

|Variable|Required|Description|
|-|-|-|
|`LWZ\_IDENTITY\_DIR`|**Yes**|Folder where the device identity file is stored — baked into the binary at build time|
|`LWZ\_IDENTITY\_FILE`|**Yes**|Identity file name (used verbatim, no `.json` appended) — also baked in|

These **must** be set before `npm run tauri:dev` or `npm run tauri:build` — the Rust build fails without them.

## Settings

Settings persist to `Documents/retdonetskmod/settings.json` (desktop). On first run a `settings\_default.json` template is also created — hand-edit it and swap it in to override defaults.

## Auto-updates

The app checks GitHub Releases on startup. One-time setup:

1. Generate a signing key: `npm run tauri signer generate -- -w \~/.tauri/legacy-warzone-launcher.key`
2. Paste the **public key** into `src-tauri/tauri.conf.json` → `plugins.updater.pubkey`
3. Add the **private key** to GitHub Actions secrets (`TAURI\_SIGNING\_PRIVATE\_KEY`)
4. Bump the version in `tauri.conf.json`, `Cargo.toml`, and `package.json`, then `git tag v1.x.x \&\& git push origin v1.x.x`

The workflow builds, signs, and creates a draft release, which you can manually edit and then publish.

## Project layout

```
src/                  React app (interfaces, tabs, utils, styles.css)
src-tauri/            Tauri shell: Rust commands (trigger-file writes, settings, device identity)
supabase/migrations/  Backend schema (apply in order)
AGENTS.md             Full project guide — read before making changes
```

