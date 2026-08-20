# AGENTS.md

Project guide for the **Legacy Warzone Launcher** (a.k.a. "IW8 Mod–Jupiter Mod LFG Tool").
Read this file first — it explains what the app does, how it's built, and the conventions
the codebase follows so you don't have to dig through every file.

## What this app is

A desktop **LFG (Looking For Group) launcher** for two private-server Call of Duty communities:

- **IW8 Mod** — Warzone 1 (2019) private-server mod.
- **Jupiter Mod** — Warzone III private-server mod.

Users pick a mod on the launch screen, get a themed "command center" interface with a Play
menu (Quick Play / Server Browser / Host a Match), and tabs for Account (sign-in), Social
(friends/parties), Help (community Discord servers + support cards), and Options (real
launcher settings) — plus a Jupiter-only Modding tab (RTM automation). The quit flow and sign-in features
are real; the server list / friends list are placeholders waiting on the Supabase backend.

**Launcher settings:** Options tab edits two settings — **Dynamic Sound Effects** (force one
mod's SFX everywhere) and **Dynamic Interfaces** (force the *other* mod's whole shell while
keeping the content's functionality) — plus a Reset to Defaults button, and a **Developer
Mode** toggle (see below). Settings persist to
`Documents/retdonetskmod/settings.json` (see "Settings persistence" below). There is **no
wallpaper setting**: the background artwork always follows the CONTENT mod (`wallpaper-${mod}`
container class), so a swapped shell keeps the content's native background.

**Developer Mode** (Options > Developer, persisted as `developer_mode`): flips the PHA Client
(Modding) tab into the **raw RTM tool surface** — every flag from `RTM.exe -h` as buttons
(flag-only commands), text fields (commands with args: `-join`/`-cbuf`/`-lua`/`-sendips`/
`-rename`/`-level`/`-xp`/`-file`), and a checkbox per `-toggle` feature (from `-toggles`). It
also lists a **local-only test server** at the top of the Jupiter Server Browser: a synthetic
row built from settings (`dev_server_name`, default `Test Server - NOT REAL`, plus
`dev_server_map` / `dev_server_mode` / `dev_server_lan_session`), never written to Supabase,
invisible to other clients. It is treated **exactly like a real lobby** everywhere — the
Server Browser and **Quick Play** both find and join it (Quick Play requires a LAN session,
like any other lobby) — with exactly one behavioral difference: without a configured LAN
session the app runs the full join flow (prep sequence, guided modal, result, HUD) but
**skips the map/mode config cbuf and the `-join`** (nothing to send or connect to); with a
LAN session every RTM command runs normally. The dev row is built by the shared
`buildDevServer()` helper in `src/utils/devServer.js` so every entry point agrees on it.

Supabase steps stay skipped for dev joins (no `server_members` registration, no party
broadcast, no `leaveMembership` cleanup — there is no real row), the right-side roster
shows a local self-card instead of polling, and the map/mode-change watcher is driven by
the Options settings rather than a host row (still cbuf-gated on the LAN session).

The UI is a console-style game menu: keyboard + gamepad (controller) navigation, theme-aware
SFX, and heavy CSS keyframe animations.

**Live backend (migration 0003+):** Host a Match publishes lobbies to the Supabase `servers`
table (requires sign-in), including the **LAN Session** code (`lan_session`, text) that the host
pastes and the game client needs when connecting. The Server Browser reads those live lobbies
(public ones are browsable without signing in; host names come from the `profile_names` view).
Migration 0007 adds `servers.mod` (`'iw8' | 'jupiter'` — each interface only lists its own mod's
lobbies), `servers.instance_id` (a per-launch id so stale lobbies from a force-killed process are
swept on startup), `server_members` (who is sitting in each lobby — signed-in users by user_id,
guests as `Player#123456` codes), and `parties` / `party_members` / `party_invites`.

**RTM automation (Jupiter only):** The launcher drives the game through the bundled **RTM.exe**
(74 MB, shipped via `bundle.resources`), a cmd-driven build of the RTM tool. The Rust side
spawns it per action: `-lua "<function>"` (menu calls like `MainMenuOffline`),
`-cbuf "<command>"` (game config commands from `WZ3 Commands.txt`), and `-join "<session>"`
(the LAN connect — RTM.exe writes the trigger files itself: `req_execcmd.ntc` empty,
`command.txt` with `connect <session>`, and `cbufcmd` with the same contents — all into
`Documents/retdonetskmod/rtm`, then exits). The Modding tab's **Change Username** and **Switch
to Zombies** use the tool's native `-rename "<name>"` / `-setzombies` flags, and the
launch-time username sync (`main.jsx`) re-runs `-rename "<gamertag>"` when a session is known.
(A `write_rtm_file` Tauri command still exists for raw trigger-file writes, but no UI path uses
it anymore.) The old in-repo C# RTM tool source (`RTM_TOOL_SOURCE_CODE`) is deleted.

## Tech stack

- **Frontend**: React 18 + Vite 5 (plain JSX, no TypeScript). Single stylesheet: `src/styles.css` (~3,200 lines).
- **Desktop shell**: Tauri 2 (Rust in `src-tauri/`). Window is frameless, fullscreen, 1280×720.
- **Backend**: Supabase — auth (email/password + gamertag) plus the server-browser pipeline: hosting writes rows to `public.servers` (RLS: insert/update/delete require sign-in; public lobbies are SELECT-able by anyone), and browsing reads live rows + host labels from the `profile_names` view. OAuth Discord/Google creds exist in `info.txt` but the UI is email-first. Friends/parties data is still **not wired** (Social tab placeholder).
- **Icons**: `lucide-react` is a dependency but most icons are inline SVG. Fonts: Rajdhani/Teko (+ a local "Hitmarker" fallback) loaded via Google Fonts in `index.html`.
- **Audio**: plain `new Audio()` calls — no Web Audio API. `setSoundOverride()` in `src/utils/audio.js` rewires every cue to the other mod's files when Dynamic Sound Effects is set.
- **Settings**: `src/utils/settings.js` (load/save/normalize) + `src/components/SettingsProvider.jsx` (context: `settings`, `setSetting`, `resetSettings`). Desktop persists to `Documents/retdonetskmod/settings.json` via the `load_settings` / `save_settings` Rust commands; plain-browser dev falls back to `localStorage['lwz-settings']`.

## Project layout

```
src/
  main.jsx                      App root + view state machine (launcher ⇄ iw8/jupiter) + close/stale-server cleanup + per-launch party-session cleanup (desktop AND browser)
  styles.css                    ALL styling, theme variables, keyframe animations
  components/
    Launcher.jsx                Landing screen — split-screen Jupiter | IW8 tiles
    IW8Interface.jsx            Warzone 1 shell: header tabs, play menu, quit button (accepts `mod` for Dynamic Interfaces swaps)
    JupiterInterface.jsx        Warzone III shell: header tabs, card menu (incl. Quick Play auto-matchmaking), quit button (accepts `mod` for Dynamic Interfaces swaps)
    OptionsTab.jsx              Launcher settings: Dynamic Sound Effects / Dynamic Interfaces dropdowns + Auto-Load Save Data + Reset to Defaults + Developer Mode toggle + dev-server metadata fields
    CustomSelect.jsx            Shared controller-friendly dropdown (used by Host a Match + Options instead of native <select>, which fights the gamepad)
    SettingsProvider.jsx        useSettings() context: loads settings at startup, saves on change, applies sound override, reset baseline
    ModdingTab.jsx              Jupiter-only RTM tab: Save Data / Load Data (-savedata / -loaddata) + Switch to Warzone Mode (prep sequence) + Switch to Zombies (runs -setzombies) + Change Username (runs -rename) + guided flows (Loadout and Operator Editing / Loadout Display Bug Fix) + full RTM tool panel in Developer Mode
    IW8QuitModal.jsx            "Quit to Desktop?" modal (IW8 theme)
    JupiterQuitModal.jsx        "Quit to Desktop?" modal (Jupiter theme)
    ServerBrowser.jsx           Play > Server Browser (live lobbies, mod-filtered, search/region filter; Jupiter joins route through JupiterSessionProvider; local-only dev server row in Developer Mode)
    HostMatch.jsx               Play > Host a Match (Jupiter: auto-prep modal + live LOBBY CONTROL dashboard; IW8: classic form; map/mode/version/publicity/region are CustomSelect dropdowns the controller opens into an option list)
    JupiterMapBadge.jsx         Bottom-right CURRENT MAP HUD (Jupiter only): map artwork + name + mode, shown by JupiterSessionProvider while connected and pinned under the player list on the host LOBBY CONTROL dashboard
    JupiterJoinModal.jsx        Join/host guided modal (PHA steps, LAN session input in host mode; result stage offers Finish / Retry)
    JupiterErrorModal.jsx       Themed error dialog
    InterfaceReloadModal.jsx    Themed confirmation shown when Options > Dynamic Interfaces (or Reset) would swap the whole interface shell
    AccountTab.jsx              Sign in / sign up (email + password + gamertag)
    SocialTab.jsx               Friends (add/search/requests + right-click context menu: invite / remove / set nickname) + parties (create/join-code/leave/invites)
    PlayerRoster.jsx            Right-side player HUD: everyone in the joined lobby (server_members, polled by JupiterSessionProvider) with PARTY tags on party members — or the party squad when not in a lobby. Pinned below the header's user chip (persists across tabs)
    RegionFlag.jsx              Inline-SVG horizontal flags per region (Windows can't render emoji flags)
    HelpTab.jsx                 Merged Discord + Help tab: the CONTENT mod's Discord server cards (openExternal) + game-mod support + launcher-help card at the bottom (controller-navigable)
    AuthProvider.jsx            useAuth() context wrapping the whole app
    AuthRequiredNotice.jsx      "Sign In Required" toast (top-right; session-scoped dismissal)
  lib/supabase.js               Singleton Supabase client (guarded by env vars)
  utils/
    audio.js                    playSound() + sound map + duplicate guards + setSoundOverride() (Dynamic Sound Effects remap)
    settings.js                 Settings load/save/normalize — desktop → settings.json via Tauri, browser dev → localStorage
    displayName.js              getDisplayName(user) — shared username fallback chain
    controller.js               useControllerNavigation hook (keyboard + gamepad)
    jupiterRtm.js               RTM.exe runner (-lua / -cbuf / -join) + runJupiterPrepSequence()
    jupiterCommands.js          WZ3 Commands.txt → cbuf config builders (mode/map → gametype + exec hash)
    jupiterSession.jsx          JupiterSessionProvider: join flow state machine, member heartbeat, server watcher, party auto-join, invite toasts
    serverPresence.js           appInstanceId + owned-server registry + stale cleanup on launch/quit + cleanupStalePartyMemberships (parties are session-scoped — dissolved on launch/quit)
    keyboard.jsx                focusTextInput() + ControllerKeyboardHint (on-screen keyboard)
    openExternal.js             Open URLs in OS browser (Tauri opener plugin / window.open fallback)
  assets/                       All images + mp3 SFX (see Audio conventions below)
src-tauri/
  tauri.conf.json               App config (window, bundle + resources: RTM.exe, build hooks)
  capabilities/default.json     Permissions (core + opener plugin)
  src/commands.rs               run_rtm + rtm_exe_path (resolve bundled RTM.exe, spawn per action) + write_rtm_file (write trigger files into Documents/retdonetskmod/RTM, e.g. rename) + load_settings/save_settings (AppSettings ↔ Documents/retdonetskmod/settings.json)
  src/lib.rs                    Tauri builder: single-instance + opener plugins + command handler
supabase/migrations/            0001_initial.sql … 0006_server_grants.sql + 0007_mod_filters_members_parties.sql (servers.mod/instance_id, server_members, parties, party_members, party_invites) + 0008_social_fixes.sql (join-by-code RLS on parties, gamertag→username trigger + backfill) + 0009_profile_region.sql (profiles.region + profile_names view exposes it for player-card flags) + 0010_lobby_member_roster.sql (joined players can SELECT server_members of public lobbies — needed by the right-side roster) + 0011_friendships_profiles_grants.sql (authenticated grants for friendships + profiles — 0001 never GRANTed them) + 0012_friend_nicknames.sql (friend_nicknames table: per-viewer friend nicknames) + 0013_advanced_banning.sql (profiles.is_banned + check_identity_ban RPC) + 0014_server_lifecycle_failsafe.sql + 0015_ban_check_anon_grant.sql (anon execute on check_identity_ban — required for the pre-sign-in device ban check) + 0016_ban_check_gamertag_match.sql (device check also matches the local identity file's gamertag against profiles.username)
scripts/boost-iw8-audio.mjs     One-off ffmpeg helper (loudness tweak) — not part of the app
info.txt                        Dev credentials (Supabase anon key, Discord/Google secrets) — do not print into code
WZ3 Commands.txt                Reference: every mode/map cbuf config (source of jupiterCommands.js)
```

## How the app flows

1. **Launcher** (`Launcher.jsx`) — user picks a mod tile. Choice persists to `localStorage['lwz-last-mod']`. The only other control is the bottom-right quit button; there is no settings shortcut or back arrow on the launcher.
   - **Jupiter-only build**: `VITE_JUPITER_ONLY=true` (`.env.jupiter`, via `npm run dev:jupiter` / `build:jupiter` / `preview:jupiter`, plus `tauri:dev:jupiter` / `tauri:build:jupiter` which pass `src-tauri/tauri.jupiter.conf.json` to the Tauri CLI via `--config`, overriding `beforeDevCommand`/`beforeBuildCommand` with `vite --mode jupiter` / `vite build --mode jupiter`) renders ONLY the Warzone III tile, full-screen, no IW8 option — `Launcher.jsx` omits the IW8 split from the DOM and locks controller nav to a single item; `.launcher-jupiter-only` CSS overrides the hover shrink/dim and removes the divider. The launch/return choreography (`.is-expanding-jupiter` / `.is-collapsing-jupiter`) is width-neutral on a lone tile, so the existing timing in `main.jsx` is untouched. **Do NOT pass `--mode` after `tauri dev/build -- `** — Tauri forwards those args to the Rust dev command (`cargo run`) too, which rejects them; the `--config` override is the supported path.
2. **Launch transition** (`main.jsx`) — `beginLaunch(mod)` plays a timed choreography:
   - `t=0` tile expansion → `t=480ms` swap `currentView` to the mod stage → `t=1100ms` clear animation classes.
   - Return home mirrors it: `t=0` exit animations → `t=620ms` swap back to launcher → `t=1100ms` clear.
   - **Do not change these timings without re-checking the CSS keyframes** (`main.jsx` comments explain each).
3. **Mod shells** (`IW8Interface.jsx` / `JupiterInterface.jsx`) — both mirror each other. Header tabs:
   `Play | Account | Social | Help | Options` (IW8) and
   `Play | Modding | Account | Social | Help | Options` (Jupiter — Modding is
   RTM-automation, Jupiter-only, right of Play). The Discord and Help tabs were merged into
   one **Help** tab (Discord cards filtered by CONTENT mod: Jupiter → Hina Warzone Mods only;
   IW8 → IW8 Mod + The 187; the launcher-help card sits at the bottom). Play view swaps
   between menu / Server Browser / Host a Match.
   - **Dynamic Interfaces swaps the whole shell** — `main.jsx`'s `ModStage` computes the
     `shell` (from `settings.dynamic_interfaces`, default `'enabled'` = follow the content
     mod) and passes the content mod through as `mod`. Each interface renders the *other*
     shell's chrome for the same content: Jupiter content in the IW8 shell keeps the Modding
     tab + full RTM join flow (wrapped in `JupiterSessionProvider theme="iw8"`) with IW8
     styling and the Jupiter logo; IW8 content in the Jupiter shell drops the Modding tab /
     provider, uses the IW8 logo, and runs the IW8 stub join with Jupiter styling. Inner
     screens (`ServerBrowser` / `HostMatch`) receive both `theme` (shell style → CSS/sounds)
     and `mod` (content → maps, join flow, version column, dashboard).
     - **Header logos are sized per ASSET, not per shell**: each `<img>` gets
       `header-logo-img-iw8` / `header-logo-img-jup` based on which logo it shows, and each
       header context sizes both assets (`styles.css` — the IW8 PNG has big transparent
       padding, so it needs a tall canvas; the Jupiter PNG is tight).
     - **The background follows the CONTENT mod**: each interface container paints
       `wallpaper-${mod}` (IW8 content → `iw8_bg.jpg`, Jupiter content → `jup_bg.jpg`), so a
       swapped shell (Dynamic Interfaces) keeps the content's native artwork.
     - **The Jupiter shell drops its red-tinted gradient** when rendering IW8 content
       (`.content-iw8` modifier) so Warzone 1 doesn't sit under a red haze.
   - **OptionsTab.jsx** — two dropdowns (Dynamic Sound Effects / Dynamic Interfaces, each
     with the per-mod options) + Reset to Defaults + a **Developer Mode** switch. Dynamic
     Sound Effects persists immediately through the SettingsProvider. Dynamic Interfaces
     (and a Reset that would swap the shell) is deferred behind `InterfaceReloadModal` — a
     themed confirm dialog (portaled, controller-aware, gates the parent interface's nav via
     `onModalChange`) because the swap re-renders the whole shell on the spot. Reset uses
     `getResetDefaults()` to peek whether the reset would swap the shell before committing.
     With Developer Mode on, a second card exposes the dev-server metadata (name / map /
     mode / optional LAN session — map & mode selects come from `JUPITER_MAPS` /
     `JUPITER_MODES` in `utils/jupiterCommands.js`). The GENERAL card also has an
     **Auto-Load Save Data** toggle (`auto_load_savedata`): when on, the
     `JupiterSessionProvider` runs `RTM.exe -loaddata` on every Jupiter interface entry
     (both shells — the provider wraps all Jupiter content) so classes / operator /
     settings come back automatically.
   - **IW8 modals match the IW8 quit modal**: every modal rendered with `theme="iw8"` (error
     dialog, interface-reload confirm, Jupiter join / host-prompt modals in an IW8 shell)
     restyles via the "IW8 MODAL VARIANTS" CSS block to the quit modal's look — square dark
     panel, no accent rail, centered title, full-width stacked buttons that flip white.
   - **ModdingTab.jsx** (Jupiter only) — "Save Data" / "Load Data" run `RTM.exe -savedata` /
     `-loaddata` (snapshot / restore classes, operator, settings, loadouts); "Switch to
     Warzone Mode" runs the same `runJupiterPrepSequence()` the join/host flows use
     (`MainMenuOffline` → 1.5 s → `WarzonePrivateMatchLobby` → 1.5 s → `MainMenuOffline`);
     "Switch to Zombies" runs `RTM.exe -setzombies` (note: be in the Local Game server
     browser menu); "Change Username" runs `RTM.exe -rename "<name>"` — all with cancel +
     themed error modal. The two `kind: 'flow'` tools are guided multi-step flows driven
     by `ModdingFlowModal` (portaled, controller-aware, gates the interface nav via
     `onModalChange`): **Loadout and Operator Editing** and **Loadout Display Bug Fix**.
     Both start with an "ARE YOU IN A WARZONE LOBBY?" Yes/No ask. **Yes** = already in a
     Warzone lobby → skips the prep AND the Local Play → Create Local Game guided modal,
     jumping straight to the flow's next RTM step (what Continue would have run). **No** =
     runs the prep sequence, then shows the Local Play → Create Local Game guided modal.
     Loadout editing's Continue re-runs `-lua WarzonePrivateMatchLobby`, then an
     instruction modal ("edit your classes and operators…") whose Finish runs
     `-lua MainMenuOffline`. Bug fix's Continue runs `-brmodejup`, an instruction modal
     tells the user to create 10 BLANK loadouts once (they don't define
     classes — they just unlock all 10 custom slots, fixing the
     only-custom-loadout-1 bug), and the final Continue runs `-disablebrjup`
     then `-savedata`. Esc/controller-B abandons a flow at any stage.
     In Developer Mode an extra **RTM DEV TOOL** card renders the whole tool surface:
     flag-only command buttons, argument text fields, and `-toggle` checkboxes — one RTM
     action at a time (shared busy gating), errors surface in the themed error modal, and
     failed toggles roll their checkbox back.
   - **Controller-nav indices are derived from the `tabs` and `playItems`/`cardKeys` arrays** — keep derived `firstMenuIdx`/`quitIdx` math in sync if you edit those arrays (comments explain the layout).
   - **Signed-in user chip**: when `useAuth().user` is set, each header shows the username chip (IW8 top-right inside the header, Jupiter top-right in the 80px bar) — clicking it just switches to the Account tab (`handleTabClick('Account')`). Mouse-only, deliberately NOT in the controller focus stack. Name comes from `getDisplayName(user)` in `utils/displayName.js` (also used by AccountTab).
   - **Non-Play tabs are transparent**: `Account/Social/Help` render inside a `.tab-content-panel` whose background is transparent (no blur/border) so the mod's bg artwork shows through — matching the Server Browser / Host a Match theming. Only the inner cards keep subtle translucent surfaces + theme accent borders.
   - **Quick Play (Jupiter, auto-matchmaking)**: clicking the Quick Play card starts matchmaking, hides the other two tiles, and searches for a joinable Jupiter lobby (`servers.mod === 'jupiter'` with a valid `lan_session`) for a **full minute** — polling every 5 s (client-side filter like ServerBrowser). The Quick Play tile wears a subtle breathing glow (`.is-quickplay-active` on the card wrapper → `quickplayTilePulse` keyframe) while the flow is active — the tile itself is the indicator (the old `.jupiter-quickplay-panel` was removed). The tile's IMAGE morphs: `jup_quick.jpg` and `jup_searching.png` are stacked layers (`.jupiter-card-image-quick` / `.jupiter-card-image-searching`) that crossfade via `.is-quickplay-searching`, and the searching decal breathes (`quickplaySearchPulse`) for the whole search — held for a minimum `QUICK_PLAY_MIN_SEARCH_MS` so even an instantly-found lobby (e.g. the dev server) shows the morph. The first lobby found morphs the decal back out and runs a 3 s auto-join countdown with a **JOINING IN n pill** (`.jupiter-card-quickplay-countdown`) overlaid on the tile, then auto-calls `session.beginJoin(server, 'quickplay')` — the same prep sequence + guided join modal as the browser. If the whole minute elapses with nothing found, `JupiterQuickPlayModal` (portaled, Jupiter-themed, controller-aware) offers **Search Again / Cancel**. The search/countdown **keeps running across tab switches** — the state lives in `JupiterInterfaceContent`, not the tab content — so deliberate cancels only: Esc / controller-back or the back arrow on the **Play tab**, picking another card, or leaving the interface (unmount cleanup); token-invalidated timers so a stale tick can't fire `beginJoin`. With no Supabase config it skips straight to the modal instead of searching blind. IW8 content (no session provider) treats the card as a no-op — matchmaking is Jupiter-only. **Developer Mode**: the dev server (built by
`buildDevServer()`) is a first-class matchmaking candidate — it tops the pool when it has a
LAN session (and is the only candidate when the backend is unreachable, so Quick Play still
works fully offline with dev mode on), and the 3 s countdown + auto-join run exactly like a
real lobby.
   - **Server Browser (Jupiter) → join flow**: `ServerBrowser` lists only this mod's lobbies (`servers.mod` filter). Clicking a Jupiter lobby calls `beginJoin(server)` on the **JupiterSessionProvider** (wraps all of `JupiterInterface`; renders the join modal + error modal + toasts globally, so party auto-joins work from any screen). The exact sequence is `RTM.exe -lua "MainMenuOffline"` → wait 1.5 s → `RTM.exe -lua "WarzonePrivateMatchLobby"` → wait 1.5 s → `RTM.exe -lua "MainMenuOffline"` → guided modal (PHA Client → Local Play → Create Local Game → Continue) → `RTM.exe -cbuf "<config>"` → wait 1.5 s → connect (`RTM.exe -join "<session>"` — the tool writes the trigger files itself: `req_execcmd.ntc` empty, `command.txt` with `connect <session>`, and `cbufcmd` with the same contents — into `Documents/retdonetskmod/rtm`). On Continue the player registers in `server_members` (signed-in users store their display name; guests get `Player#123456`), and if they lead a party, `parties.leader_server_id` is set (the auto-join broadcast). While joined, the provider polls the server row every 5 s: a map/mode change from the host triggers a new config cbuf on the member's client (+ themed toast), and a deleted server row ends the session. `finishJoin` removes the member row and clears `leader_server_id`. IW8's join is still a stub status line. The result modal's secondary button is **Retry** (re-runs the config + connect without repeating the prep — the old "It didn't work" CLI manual-fallback view was removed). **While connected to a server** (`connected` = join result stage or a persisted `lastLobby`) the Play menu swaps the cards for a `ConnectedServerPanel` (lobby name + current map/mode + Leave Server button), Server Browser / Host a Match are hidden (`!inServer`), the right-side `PlayerRoster` lists **everyone in the lobby from `server_members`** (per the launcher's database) with a Leave Server button under the list, and the bottom-right `JupiterMapBadge` shows the current map/mode. **Leave Server** runs `RTM.exe -disconnect` → `RTM.exe -lua "MainMenuOffline"` → clears the membership row (host's player count drops), the roster, the badge, and returns to the Play main menu. Tabs stay switchable the whole time. **Developer Mode** prepends a local-only test server row (amber DEV badge, host `LOCAL DEV`): its metadata comes from settings, it appears even with no Supabase config, and clicking it runs the same join flow as any real lobby — `JupiterSessionProvider` flags it `isDevServer` and skips the Supabase presence steps (registration, `setLeaderServer`, `leaveMembership` cleanup; the roster shows a local self-card, and the map/mode watcher reads the Options settings instead of a server row). The ONLY command-level difference: without a LAN session the config cbuf and the `-join` are skipped (prep + guided modal + result still run); with one, every RTM step is identical to a real join.
   - **Host a Match (Jupiter)**: entering Host a Match runs the same lua prep sequence and shows a host-mode guided modal — steps include *copy the LAN Session code from the game's command window* and a code input; Continue runs the config cbuf, publishes the row (with `mod` + `instance_id`), and switches to the **LOBBY CONTROL dashboard**: live player list (polled from `server_members`, stale guests pruned after 10 min), map/mode selects (update the row + the host's client; members auto-update via their watcher), a **CURRENT MAP badge** (map artwork + name + mode, pinned under the player list in a thinner right column — text left of the image, driven live by the selects), and Close Server (deletes the row → cascades members → clears `leader_server_id`). IW8 HostMatch keeps the classic form + publish + status.
   - **Friends & parties (SocialTab)**: `friendships` (migration 0001) with a search-over-`profile_names` Add Friend flow; accepting an incoming request deletes the sender's pending row and inserts our own accepted row (RLS only lets you touch your own rows). Parties: leader creates (6-char invite code), anyone can join by code, leaders can invite friends (`party_invites`). Pending invites surface both as a themed toast (Jupiter, polled by the provider) and in the Social tab. When the party leader joins a lobby, every member's client auto-runs the join flow (~8 s poll on `parties.leader_server_id`). **Parties are session-scoped**: `cleanupStalePartyMemberships()` in `serverPresence.js` runs once per app launch (desktop AND browser — a page load is a launch) and on graceful quit — parties the user leads are dissolved (row deleted, members cascade) and their memberships in other parties are dropped, so closing the app/tab and coming back never resurrects last session's squad.
4. **Quit flow & back navigation** — Quit button opens the themed quit modal: bottom-right text button on IW8, top-left square back-arrow on Jupiter. Confirm invokes the Rust `exit_app` command (`app.exit(0)` in `commands.rs`) via `exitApp()` in `utils/serverPresence.js` (falls back to `window.close()` in plain-browser dev). `app.exit` was chosen over `getCurrentWindow().destroy()`, which the capability ACL blocks (`core:window:default` has no `allow-destroy`) and which can leave a white window on Windows WebView2 when it does run. Uses `window.__TAURI_INTERNALS__` to detect the Tauri runtime.
   - **Jupiter's back arrow is context-aware** (`handleQuitArrowClick`): inside Server Browser / Host a Match it returns to the Play main menu (Jupiter shells hide those views' own in-view Back buttons — `ServerBrowser.jsx` / `HostMatch.jsx` render them only when the SHELL is not Jupiter); on any non-Play tab it jumps back to the Play tab; everywhere else it opens the quit modal. A pending Quick Play countdown is cancelled first (both here and in `handleBack`) instead of opening the quit modal mid-countdown.
   - **Esc / controller-Back (both interfaces)**: on any non-Play tab, Esc or controller-Back jumps back to the Play tab (the parent interface hook's `onBack` → `handleBack` → `handleTabClick('Play')`); on the Play tab, a further press opens the quit modal. Inside Server Browser / Host a Match, Esc or controller-Back first returns to the Play menu (the child's `useControllerNavigation` `onBack` → parent's `handleBackToMenu`), and only then would another press reach the parent's quit modal. The parent hook is `enabled` only when `playView === 'menu'`, so the steps never fire together.
5. **Auth** — `AuthProvider` wraps everything. `useAuth()` gives `{ user, session, configured, signUp, signIn, signOut }`. When `VITE_SUPABASE_URL`/`VITE_SUPABASE_ANON_KEY` are unset, `SUPABASE_CONFIGURED` is false and the app runs fully offline (no auth UI, no toast; hosting is local-only and the browser shows its pending state).
   - **Apply migrations in order** — `0003_servers_lan_and_browse.sql` must run after 0001/0002 (it alters `servers` and builds a view over `profiles`). `0007_mod_filters_members_parties.sql` adds `servers.mod` + `instance_id`, `server_members`, and the party tables — until it's applied, the mod-filtered browser, hosting dashboard, and social tabs will error on "relation does not exist". `0008_social_fixes.sql` must run before party join-by-code works (RLS only let the leader/members SELECT a party row) and before friend search finds gamertags (the sign-up trigger only read `raw_user_meta_data->>'username'`, never the `gamertag` key the launcher sends; 0008 accepts both and backfills existing rows). `0009_profile_region.sql` adds `profiles.region` (set from the Account tab) and exposes it via `profile_names` — without it the player-card flags all render the neutral globe. `0010_lobby_member_roster.sql` lets any anon/authenticated client SELECT `server_members` rows of a public lobby (0007 only let the HOST read them) — without it the right-side roster stays empty after you join a server. `0011_friendships_profiles_grants.sql` grants the `authenticated` role privileges on `friendships` (all four ops + its bigserial sequence) and `profiles` (select/insert/update) — 0001 created both tables with RLS policies but never GRANTed them, so add-friend/accept/list all fail with "permission denied for table friendships" and the Account-tab region save silently fails (flags stay gray). `0012_friend_nicknames.sql` adds the `friend_nicknames` table (per-viewer nicknames keyed by (user_id, friend_id), RLS = own rows only, authenticated grants) — needed by the Social tab's right-click Set/Edit Nickname.

## Conventions to follow

### Theme-aware components
Tab components receive `theme="iw8" | "jupiter"` and derive sounds, e.g.:
```js
const isJupiter = theme === 'jupiter'
const hoverSound = isJupiter ? 'jupHover' : 'iw8Hover'
const selectSound = isJupiter ? 'jupSelect' : 'iw8Select'
```
CSS variants are modifier classes (`jupiter-theme`, `server-browser-jupiter`, etc.) — see `styles.css`. Never fork a component per theme; retune via theme props/classes.

### Audio
`src/utils/audio.js` maps sound names → imported mp3s. Cue names are **theme-prefixed**: `iw8*` for Warzone 1, `jup*` for Jupiter, plus shared `mainSlide` (launcher side-slide / hovers).
- Current cues: `iw8Hover`, `iw8Select`, `iw8Quit`, `jupHover`, `jupSelect`, `jupQuit`, `mainSlide`.
- Play with `playSound('cueName', volume = 0.5)`.
- **Adding a new SFX**: drop the mp3 in `src/assets/`, import it, add to `audioMap`, and give it a `duplicateGuardMs` entry (hovers ~60ms, selects/quits ~160ms) so repeat events can't stack the cue.
- The quit modals play `iw8Quit` / `jupQuit` **when opened** (in each interface's `handleOpenQuitModal`); button hovers inside the modals use the theme hover cue.
- **Dynamic Sound Effects** (`setSoundOverride('enabled' | 'iw8' | 'jupiter')`) remaps `jup*` → `iw8*` (or vice versa) before lookup, so a forced theme's cues play everywhere. The SettingsProvider calls it on load and on every sound-setting change. `mainSlide` is never remapped.

### Controller / keyboard navigation
Everything interactive uses `useControllerNavigation` from `src/utils/controller.js` (arrow keys + WASD-likes `Q`/`E` bumpers + `Enter`/`Space` confirm + `Esc`/`Backspace` back, plus Gamepad API). Each screen:
- Tracks `inputMode` state (`'mouse' | 'controller'`) and only paints `.controller-focused` when inputMode is `'controller'` — otherwise the default focused index would highlight a button while the user is on a mouse.
- Passes `onControllerActivity` to flip inputMode, and `onMove` for hover SFX.
- The hook has a "baseline sample" on mount so the input that opened a screen isn't re-fired by the newly mounted hook.
- **Coverage**: every screen has controller nav — launcher, both interfaces, Server Browser, Host a Match (fields + dashboard), and all tabs (Account, Social, Options, Modding/PHA Client, Help) and modals. **Dropdowns use `CustomSelect.jsx`, NOT native `<select>`**: a native select responds to up/down by scrolling every option while the hook also moves — A just flips options instead of confirming. With CustomSelect the PARENT hook swaps its nav target to the option list when a dropdown opens (A on the field opens, up/down moves options, A picks, B/Esc cancels), so the pattern is: one hook for the rows, one for the open dropdown's options. Mouse picks close the dropdown immediately (`onClose` after `onSelect` inside CustomSelect) — no outside-click needed. Sub-tab hooks run alongside the interface hook (AccountTab-style): the interface hook stays quiet on arrows (its `onNavigate` returns the current index on non-Play tabs), handles Esc (jump to Play) + bumpers (tab switch), and its Enter re-click of the active tab is a harmless no-op. While a sub-tab modal or dropdown is open, the tab gates the interface hook via `onModalChange` (OptionsTab gates for BOTH the InterfaceReloadModal and open dropdowns). The right-click friend context menu on Social stays mouse-driven.
- **Play subviews (Server Browser / Host a Match)**: the child screen owns arrows/A/B, and the interface hook runs in `bumpersOnly` mode (`useControllerNavigation` option) — LB/RB (and Q/E) still switch tabs without backing out, while arrows/Enter/Esc pass through to the child. **Host a Match uses GRID navigation**, not a vertical stack: the 2-column form's left/right follows the reading order (Map → Mode sit side by side) and up/down stays in the same visual column (the full-width Server Name row matches either column) via `navigateField`/`fieldGrid` in `HostMatch.jsx`; the LOBBY CONTROL dashboard's map/mode selects hop left/right and Close Server sits below via up/down. Focused fields wear a strong accent highlight (label tint + outline + glowing 2px control border) so the hovered row reads clearly on a gamepad.

### Settings persistence
- Options edits save to `Documents/retdonetskmod/settings.json` (same base folder as the RTM trigger files) via `load_settings` / `save_settings` in `src-tauri/src/commands.rs`. The Rust `AppSettings` struct validates values (`dynamic_sounds` / `dynamic_interfaces`: `'enabled' | 'iw8' | 'jupiter'`; `developer_mode` / `auto_load_savedata` bools; `dev_server_*` strings trimmed + length-capped, LAN session allowed blank), normalizing anything invalid back to defaults. Older files with a `wallpaper` key are parsed fine (the field is simply ignored); new fields carry `#[serde(default)]` so old files load cleanly.
- **The app reads settings.json once at startup, then releases it** — nothing holds the file open; it's only re-written when a setting changes (or Reset is pressed).
- On first run the app also writes a `settings_default.json` template. The app **never reads** that file — it exists so users can edit it and manually swap it in (delete `settings.json`, rename `settings_default.json` → `settings.json`) to override the defaults. Because Reset restores the startup snapshot (kept by `SettingsProvider` in `defaultsRef`), a swapped-in file's values are honored as the reset baseline.
- Plain-browser dev (no Tauri) falls back to `localStorage['lwz-settings']`.

### LocalStorage keys
- `lwz-last-mod` — last mod chosen (`'iw8' | 'jupiter'`).
- `warzone-lfg-tool-auth-notice-suppressed` — "Don't show the sign-in toast again".
- `lwz-settings` — settings JSON (browser-dev fallback only; desktop uses settings.json).
- All reads are wrapped in try/catch (Tauri webview / Safari storage edge cases).

## Commands

```bash
npm install          # setup
npm run dev          # Vite dev server (http://localhost:5173) — browser-only mode
npm run build        # production frontend build (into dist/)
npm run tauri:dev    # Tauri dev (opens the desktop window; needs Rust toolchain)
npm run tauri:build  # production desktop build (NSIS installer)

# Jupiter-only launcher variants (no IW8 tile; Warzone III fills the screen)
npm run dev:jupiter          # browser preview of the Jupiter-only launcher
npm run build:jupiter        # frontend build (dist/) with the Jupiter-only launcher
npm run tauri:dev:jupiter    # Tauri dev window with the Jupiter-only launcher
npm run tauri:build:jupiter  # desktop installer with the Jupiter-only launcher
```

## Environment & secrets

- Supabase creds live in `.env` (gitignored) as `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY`. Vite inlines them at build time — restart/rebuild after editing.
- `info.txt` contains real dev credentials (anon key, Discord/Google OAuth secrets). **Never hardcode these into source**; they're meant for manual setup, not the bundle.
- `SUPABASE_SETUP.md` has the full walkthrough for applying the SQL migrations.

## Gotchas

- The app targets a **frameless, non-decorated window** — don't add OS chrome; quit is the in-app Quit button.
- `scripts/boost-iw8-audio.mjs` re-encodes audio in place with cumulative gain — a dev-only helper, not part of the app.
- Some Tauri build artifacts still carry the old crate name `warzone-lfg-tool` (stale `target/` dirs); the current crate is `legacy-warzone-launcher`. Ignore the stale dirs.
