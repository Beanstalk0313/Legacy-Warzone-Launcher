# RTM.exe Commands

The launcher drives the game through the bundled **RTM.exe** — a compiled,
cmd-driven build of the RTM tool (shipped via `bundle.resources`, ~10 MB).

RTM.exe does not show a GUI when launched with arguments: it writes its
trigger files into the game's RTM folder (`Documents\retdonetskmod\rtm\`)
and exits. The game/mod-side component watches and consumes those files.

## CLI usage

```text
Usage: RTM.exe [-cbuf "<command>"] [-join "<session>"] [-lua "<function>"] ...
  (one action per invocation)
  -cbuf "<command>"   Write a cbuf command to the RTM folder and exit (no GUI).
  -join "<session>"   Join a LAN session (writes cbufcmd, command.txt, req_execcmd.ntc).
  -lua "<function>"   Write a Lua menu/function call to the RTM folder and exit.
  -rename "<name>"    Change username.
  -setzombies         Switch to Zombies mode (JUP).
  -file <name> [content]  Write any RTM command file directly.
  -h, --help          Show this help.
  (no arguments)      Open the GUI tool.
```

> The newer RTM tool replaced the raw `rename` / `setzombiesmode` trigger files with the
> native `-rename` / `-setzombies` flags. The Modding tab and the launch-time username sync
> now run those flags through `run_rtm`; no app code writes trigger files directly anymore.

### How the launcher runs it

The Rust side (`src-tauri/src/commands.rs`) resolves the bundled exe
(resource dir → next to the app exe → project root for dev) and spawns it
per action via the `run_rtm` Tauri command. The frontend wrapper lives in
`src/utils/jupiterRtm.js`:

| Helper | RTM.exe invocation | Purpose |
|---|---|---|
| `writeJupiterLuaCommand(name)` | `-lua "<name>"` | Menu calls: `MainMenuOffline`, `WarzonePrivateMatchLobby` |
| `writeJupiterCbufCommand(cmd)` | `-cbuf "<cmd>"` | Game config commands (WZ3 Commands.txt) |
| `joinJupiterLanSession(session)` | `-join "<session>"` | LAN session connect (`connect <session>` + markers) |
| `runJupiterPrepSequence(gapMs)` | `-lua` ×3 with waits | MainMenuOffline → WarzonePrivateMatchLobby → MainMenuOffline |
| `runRtm(['-rename', name])` | `-rename "<name>"` | Change Username (Modding tab + launch-time sync) |
| `runRtm(['-setzombies'])` | `-setzombies` | Switch to Zombies (Modding tab) |
| `runRtm(['-savedata'])` | `-savedata` | Save Data (Modding tab): classes / operator / settings / loadouts |
| `runRtm(['-loaddata'])` | `-loaddata` | Load Data (Modding tab + auto-load on Jupiter entry) |
| `runRtm(['-disconnect'])` | `-disconnect` | Leave Server: disconnect, then `-lua "MainMenuOffline"` |
| `runRtm(['-brmodejup'])` | `-brmodejup` | Loadout Display Bug Fix: enable BR mode (JUP) |
| `runRtm(['-disablebrjup'])` | `-disablebrjup` | Loadout Display Bug Fix: disable BR mode (JUP), then `-savedata` |

## Jupiter join flow (Server Browser)

When a lobby is selected (Jupiter only), the launcher runs, in order:

```text
RTM.exe -lua "MainMenuOffline"          # then wait 1.5 s
RTM.exe -lua "WarzonePrivateMatchLobby" # then wait 1.5 s
RTM.exe -lua "MainMenuOffline"          # then show the guided modal:
                                        #   PHA Client → Local Play →
                                        #   Create Local Game → Continue
RTM.exe -cbuf "<WZ3 config for map/mode>"   # then wait 1.5 s
RTM.exe -join "<LAN session>"
```

Owned by `src/utils/jupiterSession.jsx` (`JupiterSessionProvider`), which also
registers the player in `server_members`, heartbeats it, watches the server
row for host map/mode changes (auto re-runs the config cbuf + shows a toast),
and runs the same flow automatically when a party leader joins a lobby.

## Jupiter host flow (Host a Match)

Entering Host a Match (Jupiter) runs the same `-lua` prep sequence, then shows
a host-mode guided modal whose steps end with *copy the LAN Session code from
the game's command window* and paste it into the modal. Continue runs the
config cbuf for the selected map/mode, publishes the lobby, and opens the
LOBBY CONTROL dashboard (player list, map/mode change → re-cbuf + row update,
Close Server → row delete).

## Game config commands (WZ3 Commands.txt)

`WZ3 Commands.txt` is the reference for every mode/map cbuf config. The
launcher's builders in `src/utils/jupiterCommands.js` translate a
(map, mode) pair into the cbuf text, e.g. Resurgence on Rebirth Island:

```text
ui_gametype resurgence;exec #x441C1E675F5527973;set enable_automation_bot 1;seta #x3116700c9b39c1eba 40;seta #x3E65E9A96EB2FF62B resurgence;
```

Configs are mirrored from the file per (mode, map) in `MODE_MAP_CONFIGS`.
Modes the file marks broken (Loaded Resurgence, Battle Royal, Ranked Battle
Royal) are **not** exposed; POI Resurgence is. Plunder lobbies append the
cash-to-win dvar `seta #x3a07d25d87bb595de <cash>` (default 2000000000,
editable in Host a Match). Purgatory appends `seta #x3279375A0BFB2862F 100`.

Mode → gametype (`MODE_SETTINGS`): Resurgence → `resurgence`,
Plunder → `plunder`, Lockdown → `zonecontrol`, Juggernaut Royal → `jugg`,
Ranked Resurgence → `resranked`, Zombie Royal → `zxp`, Purgatory → `limbo`,
Supreme Resurgence → `resurgsupreme`, Mini Royal → `mini`,
Massive Resurgence → `resurgmass`, POI Resurgence → `poiresurgence`.
(Urzikstan Mini Royal uses `ui_gametype br` per the file.)

Notable map hashes: Rebirth Island `#x441C1E675F5527973`, Fortune's Keep
`#x4614027DCA9FAFA63`, Vondel `#x413DC4D00BF9AEFB3`, Vondel Night runs the
REBIRTH config + `mp_jup_delta_alt` override (per the file's update), Urzikstan
Juggernaut `#x43B0AD900F42FF5D5`, Urzikstan Mini `#x41D0100B4F74A50F9`, Plunder
on the Vondel family `#x41FEDD0BAA22135A8`, Plunder Urzikstan = Rebirth config
+ `mp_jup_bigmap_wz2` override. Hellspawn uses the Rebirth config +
`mp_jup_escape5_hell` override.

## Guided Modding flows (PHA Client tab)

Two tools on the Modding tab are guided multi-step flows (`ModdingFlowModal`):

- **Loadout and Operator Editing** — ask "Are you in a Warzone lobby?" (Yes =
  skip the prep AND the Local Play → Create Game modal, jumping straight to
  the next RTM step; No = prep then Local Play steps) → Continue runs
  `-lua WarzonePrivateMatchLobby` again → "edit your classes and
  operators" modal → Finish runs `-lua MainMenuOffline`.
- **Loadout Display Bug Fix** — same ask (Yes skips prep + Local Play steps),
  otherwise prep + Local Play steps, then
  Continue runs `-brmodejup`, an instruction modal tells the user to create
  10 blank loadouts once (they don't define classes — they just unlock all
  10 custom slots, fixing the only-custom-loadout-1 bug), and the final
  Continue runs `-disablebrjup` then `-savedata` (the loadouts persist — no
  need to create them again).

Esc / controller-B abandons a flow at any stage.

## Connected state (in a server)

Once a join lands (result stage — the modal's secondary button is **Retry**,
which re-runs the config + connect without repeating the prep), the launcher
considers the player **in the server** until they leave:

- The Play menu replaces the Quick Play / Server Browser / Host a Match cards
  with a `ConnectedServerPanel` (lobby name + current map/mode + **Leave
  Server**); Server Browser / Host a Match are hidden entirely (`!inServer`
  gating in both interface shells). Tabs stay switchable.
- The right-side `PlayerRoster` lists **everyone in the lobby** from
  `server_members` (the launcher's database) and adds a **LEAVE SERVER**
  button under the list; the bottom-right map badge keeps showing the
  current map/mode.
- **Leave Server** runs `RTM.exe -disconnect` then `-lua "MainMenuOffline"`,
  deletes the membership row (the host's player count drops), clears the
  roster + map badge, and returns to the Play main menu.

## Auto-Load Save Data

Options > General's **Auto-Load Save Data** toggle (`auto_load_savedata` in
settings.json) runs `RTM.exe -loaddata` every time the Jupiter interface
opens (the session provider wraps all Jupiter content in both shells), so
classes / operator / settings come back automatically.

## Developer Mode

Options > Developer toggles **Developer Mode** (`developer_mode` in settings.json):

- The PHA Client tab gains an **RTM DEV TOOL** panel mirroring the tool's whole CLI
  surface: one button per flag-only command (`-savedata`, `-disconnect`, `-startmatch`,
  `-setzombies`, the GSC/BR-mode commands, …), text fields for argument commands
  (`-join`, `-cbuf`, `-lua`, `-sendips`, `-rename`, `-level`, `-xp`, `-file`), and a
  checkbox per `-toggles` feature that runs `-toggle <feature> on|off`.
- The Server Browser lists a **local-only test server** (default name "Test Server -
  NOT REAL", amber DEV badge) built entirely from settings — `dev_server_name` /
  `dev_server_map` / `dev_server_mode` / `dev_server_lan_session`. It never touches
  Supabase and no other client can see it. It's treated exactly like a real lobby: the
  Server Browser and **Quick Play** both find and join it (Quick Play only when it has a
  LAN session), and joining runs the full RTM flow (prep → guided modal → result → HUD;
  a map/mode edit in Options while connected re-runs the cbuf, mirroring a host change).
  The one difference: without a LAN session the map/mode config cbuf and the `-join` are
  skipped — the flow runs, nothing is sent to the game.
