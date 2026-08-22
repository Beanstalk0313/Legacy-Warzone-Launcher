# Legacy Warzone Launcher

A desktop **LFG (Looking For Group) launcher** for two private-server Call of Duty
communities:

- **IW8 Mod** — Warzone 1 (2019) private-server mod
- **Jupiter Mod** — Warzone III private-server mod

Pick a mod on the launch screen and get a themed "command center" interface with a
Play menu (Quick Play / Server Browser / Host a Match), tabs for Account (sign-in),
Social (friends & parties), community Discord servers, Help, Options (real launcher
settings — Dynamic Sound Effects, Dynamic Interfaces, Developer Mode), and a
Jupiter-only Modding tab that automates the game through the bundled **RTM.exe**
(prep sequences, config commands, LAN joins, save-data management).

## Tech stack

- **Frontend**: React 18 + Vite 5 (plain JSX, no TypeScript). Console-style menu UI
  with keyboard + gamepad controller navigation and theme-aware SFX.
- **Desktop shell**: Tauri 2 (Rust in `src-tauri/`) — frameless, fullscreen
  1280×720 window; spawns the bundled `RTM.exe` for game automation.
- **Backend**: Supabase — email/password auth, a live Server Browser pipeline
  (`servers` / `server_members` / `parties` tables, SQL migrations in
  `supabase/migrations/`), and friends/parties.

## Prerequisites

- Node.js 18+
- npm
- Rust toolchain + platform build deps (only for the Tauri desktop builds)
- `RTM.exe` at the repo root (bundled into the installer via
  `src-tauri/tauri.conf.json` resources — a fresh clone must include it to build)

## Setup

```bash
npm install
```

Copy `.env.example` to `.env` and fill in your Supabase project credentials:

```
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<your anon key>
```

Vite inlines these at build time — restart/rebuild after editing. Without them the
app runs fully offline (no auth UI, server browser is local-only). See
`supabase/migrations/` for the backend schema; apply them in order.

> **Secrets stay local.** `.env`, `.env.*` and `info.txt` (dev credentials —
> Supabase anon key, Discord/Google OAuth secrets) are gitignored and must never be
> committed or pasted into source.

## Running

```bash
npm run dev            # Vite dev server (browser-only mode) — http://localhost:5173
npm run build          # production frontend build (dist/)
npm run preview        # preview the production build
npm run tauri:dev      # Tauri dev (desktop window; needs Rust toolchain)
npm run tauri:build    # production desktop build (NSIS installer)
```

### Jupiter-only launcher variants

The `--mode jupiter` builds (`.env.jupiter`) render only the Warzone III tile,
full-screen — no IW8 option.

```bash
npm run dev:jupiter           # browser preview of the Jupiter-only launcher
npm run build:jupiter         # frontend build with the Jupiter-only launcher
npm run tauri:dev:jupiter     # Tauri dev window with the Jupiter-only launcher
npm run tauri:build:jupiter   # desktop installer with the Jupiter-only launcher
```

## Project layout

```
src/                  React app (interfaces, tabs, utils, styles.css)
src-tauri/            Tauri shell: Rust commands (RTM runner, settings persistence)
supabase/migrations/  SQL migrations for the Supabase backend (apply in order)
AGENTS.md             Full project guide — read it before making changes
```

## Device identity file

The launcher stores a **device identity file** (the signed-in account's Discord
username, gamertag, and email) that the pre-sign-in ban check reads. Its exact
file name and location are intentionally **not published** in this repository
— they are baked into the binary at **build time** from two environment
variables, so the source can't be used to locate or remove the file (see
`ADVANCED_BANNING.md` for the ban system itself).

Every build **requires** both variables — the build fails if either is unset,
so a binary never ships with a guessable default location:

```
LWZ_IDENTITY_DIR   # the folder the identity file lives in
LWZ_IDENTITY_FILE  # the identity file's name — used VERBATIM, no
                   # extension (e.g. .json) is ever appended
```

Set them wherever you build the desktop app. In the GitHub Actions release
workflow (`release.yml`) they are read from the `LWZ_IDENTITY_DIR` and
`LWZ_IDENTITY_FILE` repo secrets — add those two secrets with the values you
want each release to use (keep them stable across releases, or rotate them now
and then). For local builds, `export` them in the terminal before any
`npm run tauri:*` command. These values are per-build configuration — never
commit them.

## Notes

- Settings persist to `Documents/retdonetskmod/settings.json` (desktop) or
  `localStorage['lwz-settings']` (browser dev).
- `AGENTS.md` is the canonical deep-dive: flows, conventions, controller-nav
  patterns, gotchas.
