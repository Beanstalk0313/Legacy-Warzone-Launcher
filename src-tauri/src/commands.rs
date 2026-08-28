use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::Manager;

const MAX_ARG_LENGTH: usize = 4096;

/// The exact cbuf payloads the RTM tool used for BR mode (JUP):
/// EnableBrModeJup sets three dvars, Disable only resets the third.
/// (Mirrored verbatim from the RTM tool recreation guide — note the
/// trailing semicolons and the `#x3` JUP hash prefix.)
const BR_MODE_JUP_ENABLE_CBUF: &str =
    "seta #x37444C1F208994CC5 1;seta #x3FAF1DB5754891B2D 1;seta #x3B5D05C0CBFA8BDC1 1;";
const BR_MODE_JUP_DISABLE_CBUF: &str = "seta #x3B5D05C0CBFA8BDC1 0;";

/// Plain cbuf payloads the RTM tool exposed as flag-only commands.
const CBUF_DISCONNECT: &str = "disconnect";
const CBUF_START_MATCH: &str = "xpartygo";
const CBUF_CREATE_LOBBY: &str = "xstartlobby";

/// Launcher settings, persisted to Documents\retdonetskmod\settings.json so
/// users can share configs (or override them by hand) without touching the
/// bundle. Values are the dropdown labels' internal ids.
fn default_display_mode() -> String {
    "fullscreen".to_string()
}

fn default_dev_server_name() -> String {
    "Local Test Server".to_string()
}

fn default_dev_server_map() -> String {
    "Rebirth Island".to_string()
}

fn default_dev_server_mode() -> String {
    "Resurgence".to_string()
}

fn default_dev_server_lan_session() -> String {
    String::new()
}

fn default_accent_jupiter() -> String {
    "#028fcc".to_string()
}

fn default_glyph_platform() -> String {
    "auto".to_string()
}

/// serde default for the Music toggle — the soundtrack defaults to ON so a
/// settings.json written before the field existed still plays music.
fn default_music_enabled() -> bool {
    true
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct AppSettings {
    #[serde(default = "default_display_mode")]
    pub display_mode: String,
    /// Which monitor the launcher window is shown on — the raw monitor
    /// name from `available_monitors` (e.g. "\\\\.\\DISPLAY1"). Empty
    /// string = the system's default monitor.
    #[serde(default)]
    pub display_monitor: String,
    /// Silent Mode: muting gate for every launcher sound effect.
    #[serde(default)]
    pub silent_mode: bool,
    /// Theme accent color — user-customizable hex value (e.g. "#028fcc").
    #[serde(default = "default_accent_jupiter")]
    pub accent_jupiter: String,
    /// Testing Server: lists a LOCAL-ONLY synthetic test server in the
    /// Server Browser / Quick Play (never touched by Supabase, invisible to
    /// other clients). Metadata comes from the dev_server_* fields below.
    #[serde(default)]
    pub testing_server: bool,
    /// Advanced RTM Mode: shows the raw RTM DEV TOOL panel (every
    /// trigger-file action) on the RTM tab. The guided RTM tools are always
    /// available regardless.
    #[serde(default)]
    pub rtm_mode: bool,
    /// One-time migration field: settings.json files written before the
    /// split only carried a single `developer_mode` flag (which enabled
    /// BOTH the test server and the raw RTM tool). It is read here, folded
    /// into the two new toggles below, and never re-serialized.
    #[serde(default, rename = "developer_mode", skip_serializing)]
    pub legacy_developer_mode: Option<bool>,
    #[serde(default = "default_dev_server_name")]
    pub dev_server_name: String,
    #[serde(default = "default_dev_server_map")]
    pub dev_server_map: String,
    #[serde(default = "default_dev_server_mode")]
    pub dev_server_mode: String,
    /// Optional LAN session for the test server — blank means the test
    /// server is a listing only (not joinable).
    #[serde(default = "default_dev_server_lan_session")]
    pub dev_server_lan_session: String,
    /// Auto-write the `loadstatus` trigger file (the game's Load Data
    /// action) every time the Jupiter interface opens, restoring the
    /// player's classes / operator / settings from savedata.
    #[serde(default)]
    pub auto_load_savedata: bool,
    /// Launcher music: plays the current game mode's soundtrack while the
    /// launcher is open. Independent of Silent Mode (which only mutes
    /// launcher SFX) — its own Music toggle lives in Options > SOUND.
    #[serde(default = "default_music_enabled")]
    pub music_enabled: bool,
    /// Zombies mode only: use the classic Black Ops soundtrack
    /// (zombies_bo1.mp3) instead of the default zombies track.
    #[serde(default)]
    pub zombies_classic_ost: bool,
    /// Where the Jupiter game is installed / should be installed. Empty until
    /// the user sets it in Options — a blank value means "not installed yet".
    #[serde(default)]
    pub game_install_path: String,
    /// Which controller/keyboard glyph pack the UI shows — "auto" detects the
    /// connected controller (keyboard fallback), otherwise one of
    /// keyboard / xbox / playstation / switch / steam / steamdeck.
    #[serde(default = "default_glyph_platform")]
    pub glyph_platform: String,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            display_mode: default_display_mode(),
            display_monitor: String::new(),
            silent_mode: false,
            accent_jupiter: default_accent_jupiter(),
            testing_server: false,
            rtm_mode: false,
            legacy_developer_mode: None,
            dev_server_name: default_dev_server_name(),
            dev_server_map: default_dev_server_map(),
            dev_server_mode: default_dev_server_mode(),
            dev_server_lan_session: default_dev_server_lan_session(),
            auto_load_savedata: false,
            music_enabled: true,
            zombies_classic_ost: false,
            game_install_path: String::new(),
            glyph_platform: default_glyph_platform(),
        }
    }
}

const DISPLAY_MODE_VALUES: [&str; 2] = ["fullscreen", "windowed"];
const GLYPH_PLATFORM_VALUES: [&str; 7] = ["auto", "keyboard", "xbox", "playstation", "switch", "steam", "steamdeck"];

/// Validate a hex color string (#rrggbb). Falls back to `default` when
/// the value is missing or not exactly seven characters (# + six hex).
fn normalize_hex_color(value: &str, default: &str) -> String {
    let trimmed = value.trim();
    if trimmed.len() == 7
        && trimmed.starts_with('#')
        && trimmed[1..].chars().all(|character| character.is_ascii_hexdigit())
    {
        trimmed.to_lowercase()
    } else {
        default.to_string()
    }
}

/// Trim + sanitize a hand-editable settings string. Falls back to `default`
/// when empty, too long, or containing control characters.
fn normalize_setting_text(value: &str, default: &str, max_len: usize) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty()
        || trimmed.chars().count() > max_len
        || trimmed.chars().any(|character| character.is_control())
    {
        return default.to_string();
    }
    trimmed.to_string()
}

fn normalize_settings(settings: AppSettings) -> AppSettings {
    // Fold the retired single `developer_mode` flag into the two new
    // toggles (old files only had that one switch controlling both).
    let migrated_developer_mode = settings.legacy_developer_mode.unwrap_or(false);
    let defaults = AppSettings::default();
    // The dev server LAN session is OPTIONAL — blank is a valid state
    // (listing-only test server), so the empty string is preserved but
    // anything else gets the same sanitization.
    let lan_session = settings.dev_server_lan_session.trim().to_string();
    let lan_session = if lan_session.is_empty()
        || lan_session.chars().count() > 256
        || lan_session.chars().any(|character| character.is_control())
    {
        String::new()
    } else {
        lan_session
    };
    AppSettings {
        display_mode: if DISPLAY_MODE_VALUES.contains(&settings.display_mode.as_str()) {
            settings.display_mode
        } else {
            defaults.display_mode
        },
        display_monitor: normalize_setting_text(&settings.display_monitor, "", 128),
        silent_mode: settings.silent_mode,
        accent_jupiter: normalize_hex_color(&settings.accent_jupiter, &defaults.accent_jupiter),
        testing_server: settings.testing_server || migrated_developer_mode,
        rtm_mode: settings.rtm_mode || migrated_developer_mode,
        legacy_developer_mode: None,
        auto_load_savedata: settings.auto_load_savedata,
        music_enabled: settings.music_enabled,
        zombies_classic_ost: settings.zombies_classic_ost,
        // The old default test-server name was retired — anyone still on it
        // gets the new default.
        dev_server_name: {
            let name = normalize_setting_text(&settings.dev_server_name, &defaults.dev_server_name, 64);
            if name == "Test Server - NOT REAL" {
                defaults.dev_server_name
            } else {
                name
            }
        },
        dev_server_map: normalize_setting_text(&settings.dev_server_map, &defaults.dev_server_map, 64),
        dev_server_mode: normalize_setting_text(&settings.dev_server_mode, &defaults.dev_server_mode, 64),
        dev_server_lan_session: lan_session,
        game_install_path: normalize_setting_text(&settings.game_install_path, "", 512),
        glyph_platform: if GLYPH_PLATFORM_VALUES.contains(&settings.glyph_platform.as_str()) {
            settings.glyph_platform
        } else {
            defaults.glyph_platform
        },
    }
}

/// Documents\retdonetskmod — the same base folder the RTM trigger files
/// live in (their lower-case `rtm` subfolder is created on demand).
fn resolve_settings_folder(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let document_dir = app
        .path()
        .document_dir()
        .map_err(|error| format!("Could not locate your Documents folder: {error}"))?;
    let folder = document_dir.join("retdonetskmod");
    fs::create_dir_all(&folder)
        .map_err(|error| format!("Could not create the settings folder: {error}"))?;
    Ok(folder)
}

fn read_settings_file(app: &tauri::AppHandle) -> Result<AppSettings, String> {
    let path = resolve_settings_folder(app)?.join("settings.json");
    let defaults = AppSettings::default();

    let settings = if path.is_file() {
        let raw = fs::read_to_string(&path)
            .map_err(|error| format!("Could not read settings.json: {error}"))?;
        match serde_json::from_str::<AppSettings>(&raw) {
            Ok(parsed) => normalize_settings(parsed),
            // A hand-edited / partially-copied file shouldn't brick the app:
            // fall back to defaults for the fields that didn't parse.
            Err(_) => defaults,
        }
    } else {
        write_settings_file(app, &defaults)?;
        defaults
    };
    Ok(settings)
}

fn write_settings_file(app: &tauri::AppHandle, settings: &AppSettings) -> Result<(), String> {
    let path = resolve_settings_folder(app)?.join("settings.json");
    let serialized = serde_json::to_string_pretty(settings)
        .map_err(|error| format!("Could not serialize settings: {error}"))?;
    fs::write(&path, serialized)
        .map_err(|error| format!("Could not write settings.json: {error}"))
}

/// Load launcher settings. Reads settings.json once at startup, then the
/// file is released (nothing holds it open) — the frontend keeps the values
/// in memory and only calls save_settings when something changes.
///
/// On first run (neither file exists) this writes settings.json with the
/// built-in defaults AND a settings_default.json template so users can edit
/// the template, then manually swap it in (delete settings.json, rename
/// settings_default.json → settings.json) to override the defaults. The app
/// never reads settings_default.json itself.
#[tauri::command(rename = "load_settings")]
pub fn load_settings_command(app: tauri::AppHandle) -> Result<AppSettings, String> {
    let folder = resolve_settings_folder(&app)?;
    let settings_path = folder.join("settings.json");
    let defaults_path = folder.join("settings_default.json");

    if !settings_path.exists() && !defaults_path.exists() {
        let serialized = serde_json::to_string_pretty(&AppSettings::default())
            .map_err(|error| format!("Could not serialize settings template: {error}"))?;
        fs::write(&defaults_path, serialized)
            .map_err(|error| format!("Could not write settings_default.json: {error}"))?;
    }

    read_settings_file(&app)
}

/// Persist launcher settings to settings.json. Values are validated (an
/// invalid value is silently replaced with the default rather than saved).
///
/// "Reset to defaults" is implemented by the frontend: it saves the settings
/// snapshot captured at load time back through this command, so a manually
/// swapped-in settings_default.json (renamed over settings.json) is honored
/// as the reset baseline.
#[tauri::command(rename = "save_settings")]
pub fn save_settings_command(app: tauri::AppHandle, settings: AppSettings) -> Result<(), String> {
    write_settings_file(&app, &normalize_settings(settings))
}

/// The one active account's identity snapshot — the DEVICE identity behind
/// the pre-sign-in ban check. It is deliberately stored outside the app's
/// own folders, at a location baked into the binary at build time from
/// environment variables (never written as a literal path in this source),
/// so the public repo can't be used to find or remove the file. See
/// `resolve_user_identity_path`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct UserIdentity {
    pub discord_username: String,
    pub gamertag: String,
    pub email: String,
}

/// Resolve the device identity file's path. The folder and file name are
/// baked into the binary at BUILD time from the `LWZ_IDENTITY_DIR` and
/// `LWZ_IDENTITY_FILE` environment variables — set them in the build (e.g.
/// the GitHub Actions release workflow, fed from repo secrets) so every
/// build of a release stores the identity file at one fixed, obfuscated
/// path that never appears in this source tree. The build FAILS if either
/// is unset, so a binary can never ship with a guessable default location.
///
/// The file name is used VERBATIM — no extension (`.json` or otherwise) is
/// ever appended — so the builder can pick any name, with or without one.
fn resolve_user_identity_path() -> Result<PathBuf, String> {
    let folder = env!("LWZ_IDENTITY_DIR").trim();
    let file_name = env!("LWZ_IDENTITY_FILE").trim();
    if folder.is_empty()
        || file_name.is_empty()
        || folder.chars().any(|character| character.is_control())
        || file_name.chars().any(|character| character.is_control())
    {
        return Err(
            "The device identity folder/file were set to empty or invalid values at build time."
                .to_string(),
        );
    }
    let folder_path = PathBuf::from(folder);
    fs::create_dir_all(&folder_path)
        .map_err(|error| format!("Could not create the identity folder: {error}"))?;
    Ok(folder_path.join(file_name))
}

fn validate_identity_value(value: &str, field: &str) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() || trimmed.len() > 320 || trimmed.chars().any(|character| character.is_control()) {
        return Err(format!("The {field} in the device identity file is missing or invalid."));
    }
    Ok(trimmed.to_string())
}

fn normalize_user_identity(identity: UserIdentity) -> Result<UserIdentity, String> {
    Ok(UserIdentity {
        discord_username: validate_identity_value(&identity.discord_username, "Discord username")?,
        gamertag: validate_identity_value(&identity.gamertag, "gamertag")?,
        email: validate_identity_value(&identity.email, "email")?,
    })
}

#[tauri::command(rename = "load_user_identity")]
pub fn load_user_identity_command() -> Result<Option<UserIdentity>, String> {
    let path = resolve_user_identity_path()?;
    if !path.is_file() {
        return Ok(None);
    }

    let raw = fs::read_to_string(&path)
        .map_err(|error| format!("Could not read the device identity file: {error}"))?;
    let identity = serde_json::from_str::<UserIdentity>(&raw)
        .map_err(|error| format!("The device identity file is invalid: {error}"))?;
    Ok(Some(normalize_user_identity(identity)?))
}

#[tauri::command(rename = "save_user_identity")]
pub fn save_user_identity_command(identity: UserIdentity) -> Result<(), String> {
    let identity = normalize_user_identity(identity)?;
    let path = resolve_user_identity_path()?;
    let serialized = serde_json::to_string_pretty(&identity)
        .map_err(|error| format!("Could not serialize the device identity file: {error}"))?;
    fs::write(&path, serialized)
        .map_err(|error| format!("Could not write the device identity file: {error}"))
}

#[tauri::command(rename = "clear_user_identity")]
pub fn clear_user_identity_command() -> Result<(), String> {
    let path = resolve_user_identity_path()?;
    if path.exists() {
        fs::remove_file(&path)
            .map_err(|error| format!("Could not remove the device identity file: {error}"))?;
    }
    Ok(())
}

/// Apply the persisted display mode directly to the native Tauri window.
/// The frontend uses this command first so leaving fullscreen is handled by
/// the Rust window layer rather than only by the WebView bridge.
#[tauri::command(rename = "apply_display_mode")]
pub fn apply_display_mode_command(app: tauri::AppHandle, mode: String) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "Could not find the main launcher window.".to_string())?;

    match mode.as_str() {
        "windowed" => {
            // Windowed means a normal maximized desktop window: it fills the
            // work area but deliberately leaves the Windows taskbar visible.
            // Keep the frameless chrome so the launcher's own controls remain
            // the title bar replacement.
            window
                .set_fullscreen(false)
                .map_err(|error| format!("Could not leave fullscreen: {error}"))?;
            window
                .set_decorations(false)
                .map_err(|error| format!("Could not preserve the frameless window: {error}"))?;
            window
                .set_resizable(true)
                .map_err(|error| format!("Could not enable window resizing: {error}"))?;
            window
                .maximize()
                .map_err(|error| format!("Could not maximize the window: {error}"))?;
            Ok(())
        }
        "fullscreen" => {
            // Clear the maximized state before entering fullscreen so the
            // next transition back to Windowed starts from a clean native
            // window state.
            window
                .unmaximize()
                .map_err(|error| format!("Could not restore the window state: {error}"))?;
            window
                .set_fullscreen(true)
                .map_err(|error| format!("Could not enter fullscreen: {error}"))
        }
        _ => Err("Display mode must be fullscreen or windowed.".to_string()),
    }
}

/// One display, as exposed to the Options tab's Display Monitor dropdown.
/// `name` is the OS monitor identifier (the persisted setting value);
/// `ordinal` is the enumeration index used for the friendly "Display N"
/// label; `primary` marks the system's primary monitor.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub struct MonitorInfo {
    pub name: String,
    pub ordinal: usize,
    pub primary: bool,
}

/// List the displays available to the launcher (Options > Display Monitor).
#[tauri::command(rename = "list_monitors")]
pub fn list_monitors_command(app: tauri::AppHandle) -> Result<Vec<MonitorInfo>, String> {
    let monitors = app
        .available_monitors()
        .map_err(|error| format!("Could not enumerate your monitors: {error}"))?;
    let primary_name = app
        .primary_monitor()
        .ok()
        .flatten()
        .and_then(|monitor| monitor.name().cloned());
    Ok(monitors
        .into_iter()
        .enumerate()
        .map(|(index, monitor)| {
            let name = monitor.name().cloned().unwrap_or_default();
            MonitorInfo {
                name: name.clone(),
                ordinal: index + 1,
                primary: primary_name.as_ref() == Some(&name),
            }
        })
        .collect())
}

/// Move the launcher window onto the named monitor. An empty name means
/// "the system's default monitor" — nothing to do. Fullscreen/maximized
/// states are cleared first so the reposition lands on Windows; the caller
/// re-applies the persisted display mode afterwards so fullscreen fills the
/// new monitor.
#[tauri::command(rename = "apply_display_monitor")]
pub fn apply_display_monitor_command(app: tauri::AppHandle, name: String) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "Could not find the main launcher window.".to_string())?;

    let name = name.trim().to_string();
    // Empty name = "Default" — find the primary monitor and move there.
    let target_name = if name.is_empty() {
        app.primary_monitor()
            .ok()
            .flatten()
            .and_then(|monitor| monitor.name().cloned())
            .unwrap_or_default()
    } else {
        name
    };
    if target_name.is_empty() {
        return Ok(());
    }

    let monitors = app
        .available_monitors()
        .map_err(|error| format!("Could not enumerate your monitors: {error}"))?;
    // `Monitor::name()` is an Option<&String> — compare by reference;
    // headless monitors (no name) can never equal a requested name.
    let monitor = monitors
        .into_iter()
        .find(|monitor| monitor.name().is_some_and(|monitor_name| monitor_name == &target_name))
        .ok_or_else(|| format!("Monitor '{target_name}' is not connected."))?;

    // A fullscreen / maximized window is pinned to its current monitor on
    // Windows — come out of both before repositioning.
    window
        .unmaximize()
        .map_err(|error| format!("Could not restore the window state: {error}"))?;
    window
        .set_fullscreen(false)
        .map_err(|error| format!("Could not leave fullscreen: {error}"))?;

    let monitor_position = monitor.position();
    let monitor_size = monitor.size();
    let window_size = window
        .inner_size()
        .map_err(|error| format!("Could not read the window size: {error}"))?;
    // Center the window on the target monitor (physical pixels).
    let x = monitor_position.x + (monitor_size.width.saturating_sub(window_size.width) / 2) as i32;
    let y = monitor_position.y + (monitor_size.height.saturating_sub(window_size.height) / 2) as i32;
    window
        .set_position(tauri::PhysicalPosition::new(x, y))
        .map_err(|error| format!("Could not move the window onto '{target_name}': {error}"))?;
    Ok(())
}

/// Resolve the game's RTM folder: Documents\retdonetskmod\rtm — the
/// trigger-file directory the modloader inside the game polls. There is no
/// RTM.exe anymore: every RTM action is just one or more file writes here
/// (see `rtm_action_command`). The folder is created before every write.
fn resolve_rtm_folder(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let document_dir = app
        .path()
        .document_dir()
        .map_err(|error| format!("Could not locate your Documents folder: {error}"))?;
    let folder = document_dir.join("retdonetskmod").join("rtm");
    fs::create_dir_all(&folder)
        .map_err(|error| format!("Could not create the RTM folder: {error}"))?;
    Ok(folder)
}

/// Core primitive from the recreation guide: overwrite a trigger file with
/// the exact bytes of `contents` — UTF-8, no BOM, no trailing newline (an
/// empty string writes a 0-byte file). Returns the absolute path written.
fn write_trigger_file(folder: &PathBuf, file_name: &str, contents: &str) -> Result<String, String> {
    let path = folder.join(file_name);
    fs::write(&path, contents.as_bytes()).map_err(|error| {
        format!(
            "Could not write {}: {error}",
            path.to_string_lossy()
        )
    })?;
    Ok(path.to_string_lossy().to_string())
}

/// `cbuf` — write `cbufcmd` with the raw command text (game command buffer).
fn write_cbuf(folder: &PathBuf, command: &str) -> Result<String, String> {
    write_trigger_file(folder, "cbufcmd", command)
}

/// `lua` — write `luacmd` with the LUA menu/function name.
fn write_lua(folder: &PathBuf, function: &str) -> Result<String, String> {
    write_trigger_file(folder, "luacmd", function)
}

/// Toggle system from the recreation guide: each feature has one ON file and
/// one OFF file, both empty. Toggling deletes the opposite state file first,
/// then writes the state file, so only one exists at a time.
///
/// The EXACT filename convention (from the guide's 43-row table, do not
/// normalize): features WITHOUT an underscore append `on` / `off`
/// (`botfix` → `botfixon` / `botfixoff`), features WITH an underscore
/// append `_on` / `_off` (`exec_everyframe_log` → `exec_everyframe_log_on` /
/// `exec_everyframe_log_off`). The modloader reads these exact strings.
fn toggle_file_names(feature: &str) -> (String, String) {
    let (on_suffix, off_suffix) = if feature.contains('_') {
        ("_on", "_off")
    } else {
        ("on", "off")
    };
    (format!("{feature}{on_suffix}"), format!("{feature}{off_suffix}"))
}

fn apply_toggle(folder: &PathBuf, feature: &str, on: bool) -> Result<String, String> {
    let (on_name, off_name) = toggle_file_names(feature);
    let (state_name, opposite_name) = if on { (on_name, off_name) } else { (off_name, on_name) };

    // Delete the opposite state file if it exists (missing is fine).
    match fs::remove_file(folder.join(&opposite_name)) {
        Ok(_) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => {
            return Err(format!(
                "Could not clear {}: {error}",
                folder.join(&opposite_name).to_string_lossy()
            ))
        }
    }

    write_trigger_file(folder, &state_name, "")?;
    Ok(format!("wrote {} ({})", state_name, if on { "on" } else { "off" }))
}

/// Validate a single command argument: non-empty, control-character-free
/// (newlines allowed only for cbuf payloads), length-capped, optionally
/// trimmed. `-rename` passes `trim: false` — the display name is written
/// exactly as provided (the frontend already trims it).
fn validate_arg(value: &str, allow_newlines: bool, trim: bool) -> Result<String, String> {
    let value = if trim { value.trim().to_string() } else { value.to_string() };
    if value.is_empty() {
        return Err("RTM argument is empty.".to_string());
    }
    // cbuf payloads carry the multi-line WZ3 config format (secondary dvars
    // like Plunder's cash-to-win sit on their own line — see wz commands.txt),
    // so `-cbuf` args are allowed newlines; everything else stays
    // control-character-free.
    let has_invalid_control = value.chars().any(|character| {
        character.is_control() && !(allow_newlines && character == '\n')
    });
    if value.len() > MAX_ARG_LENGTH || has_invalid_control {
        return Err("RTM argument contains invalid characters or is too long.".to_string());
    }
    Ok(value)
}

/// Validate a toggle feature name: a safe file-name fragment (alphanumeric +
/// underscore, ≤ 64 chars). The ON/OFF filenames are derived in
/// `toggle_file_names` using the guide's exact convention — nothing is
/// normalized here.
fn validate_toggle_feature(value: &str) -> Result<String, String> {
    let value = value.trim();
    let valid = !value.is_empty()
        && value.len() <= 64
        && value
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || character == '_');
    if !valid {
        return Err("Toggle feature name is invalid.".to_string());
    }
    Ok(value.to_string())
}

/// Return the application's resource directory — where `bundle.resources`
/// places files at install time. The frontend uses this to resolve moddable
/// asset paths (sounds, images) at runtime.
#[tauri::command(rename = "get_resource_dir")]
pub fn get_resource_dir_command(app: tauri::AppHandle) -> Result<String, String> {
    app.path()
        .resource_dir()
        .map(|path| path.to_string_lossy().to_string())
        .map_err(|error| format!("Could not locate the resource directory: {error}"))
}

/// Minimize the launcher window. This is exposed as a small native command
/// for the custom frameless title-bar control; using the Rust window handle
/// avoids depending on a WebView capability being present in an older build.
#[tauri::command(rename = "minimize_window")]
pub fn minimize_window_command(app: tauri::AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "Could not find the main launcher window.".to_string())?;
    window
        .minimize()
        .map_err(|error| format!("Could not minimize the launcher: {error}"))
}

/// Request a native close. The frontend close-requested listener receives
/// this request first, performs server/party cleanup, then calls exit_app.
#[tauri::command(rename = "request_window_close")]
pub fn request_window_close_command(app: tauri::AppHandle) -> Result<(), String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "Could not find the main launcher window.".to_string())?;
    window
        .close()
        .map_err(|error| format!("Could not close the launcher: {error}"))
}

/// Quit the launcher for real. The old approach called `window.destroy()`
/// from the frontend, but that (a) is blocked by the capability ACL
/// (`core:window:default` has no `allow-destroy`) and (b) is unreliable on
/// Windows WebView2 — it can tear down the webview while the OS window
/// lingers, leaving a white screen. `app.exit` terminates the whole process
/// cleanly on every platform and never re-enters the window close-requested
/// handler (that handler is what the frontend uses for OS-level closes).
#[tauri::command(rename = "exit_app")]
pub fn exit_app_command(app: tauri::AppHandle) {
    app.exit(0);
}

/// Run ONE RTM action (replaces the old bundled RTM.exe): the frontend
/// sends the same flag-shaped arguments the tool exposed, and this command
/// translates them into trigger-file writes in
/// `Documents\retdonetskmod\rtm`. No process is spawned — everything is a
/// file write, per the RTM recreation guide:
///
///   -lua "<fn>"   → `luacmd` = fn
///   -cbuf "<cmd>" → `cbufcmd` = cmd (newlines allowed — WZ3 configs)
///   -join "<code>"→ `cbufcmd` + `command.txt` = "connect <code>",
///                  `req_execcmd.ntc` = empty (3 files, in sequence)
///   -savedata      → `savestatus` = empty
///   -loaddata      → `loadstatus` = empty
///   -disconnect    → `cbufcmd` = "disconnect"
///   -startmatch    → `cbufcmd` = "xpartygo"
///   -createlobby   → `cbufcmd` = "xstartlobby"
///   -sendips "<ip>"→ `cbufcmd` = "sendips <ip>"
///   -hotreloadgsc  → `hotreloadgsc` = empty
///   -hotreloadzmgsc → `hotreloadzmgsc` = empty
///   -restoregsc    → `restoregsc` = empty
///   -showinfo      → `showyourinfo` = empty
///   -setzombies    → `setzombiesmode` = empty
///   -loadcustomcamo→ `loadcustomcamo` = empty
///   -rename "<n>" → `rename` = name (exactly as provided)
///   -brmodejup     → `cbufcmd` = Enable BR mode dvars (JUP)
///   -disablebrjup  → `cbufcmd` = Disable BR mode dvar (JUP)
///   -toggle "<f>" on|off → delete `<f>off` then write `<f>on` (or vice versa)
///
/// Returns a short status string (e.g. the path written) for UI status lines.
#[tauri::command(rename = "rtm_action")]
pub fn rtm_action_command(app: tauri::AppHandle, args: Vec<String>) -> Result<String, String> {
    if args.is_empty() {
        return Err("No RTM action provided.".to_string());
    }

    let action = args[0].trim();
    let folder = resolve_rtm_folder(&app)?;

    match action {
        // -lua "<function>" → luacmd
        "-lua" => {
            let function = args
                .get(1)
                .ok_or_else(|| "-lua needs a LUA function name.".to_string())
                .and_then(|value| validate_arg(value, false, true))?;
            write_lua(&folder, &function)
        }
        // -cbuf "<command>" → cbufcmd (the WZ3 config format may span lines)
        "-cbuf" => {
            let command = args
                .get(1)
                .ok_or_else(|| "-cbuf needs a command string.".to_string())
                .and_then(|value| validate_arg(value, true, true))?;
            write_cbuf(&folder, &command)
        }
        // -join "<session>" → the three-file LAN-connect sequence
        "-join" => {
            let session = args
                .get(1)
                .ok_or_else(|| "-join needs a LAN session code.".to_string())
                .and_then(|value| validate_arg(value, false, true))?;
            let connect = format!("connect {session}");
            write_cbuf(&folder, &connect)?;
            write_trigger_file(&folder, "command.txt", &connect)?;
            write_trigger_file(&folder, "req_execcmd.ntc", "")?;
            Ok(format!("wrote join trigger files for session {session}"))
        }
        // -savedata → savestatus (empty)
        "-savedata" => write_trigger_file(&folder, "savestatus", ""),
        // -loaddata → loadstatus (empty)
        "-loaddata" => write_trigger_file(&folder, "loadstatus", ""),
        // -disconnect → cbuf disconnect
        "-disconnect" => write_cbuf(&folder, CBUF_DISCONNECT),
        // -startmatch → cbuf xpartygo
        "-startmatch" => write_cbuf(&folder, CBUF_START_MATCH),
        // -createlobby → cbuf xstartlobby
        "-createlobby" => write_cbuf(&folder, CBUF_CREATE_LOBBY),
        // -sendips "<ip>" → cbuf sendips <ip>
        "-sendips" => {
            let ip = args
                .get(1)
                .ok_or_else(|| "-sendips needs an IP address.".to_string())
                .and_then(|value| validate_arg(value, false, true))?;
            write_cbuf(&folder, &format!("sendips {ip}"))
        }
        // -hotreloadgsc → hotreloadgsc (empty)
        "-hotreloadgsc" => write_trigger_file(&folder, "hotreloadgsc", ""),
        // -hotreloadzmgsc → hotreloadzmgsc (empty)
        "-hotreloadzmgsc" => write_trigger_file(&folder, "hotreloadzmgsc", ""),
        // -restoregsc → restoregsc (empty)
        "-restoregsc" => write_trigger_file(&folder, "restoregsc", ""),
        // -showinfo → showyourinfo (empty)
        "-showinfo" => write_trigger_file(&folder, "showyourinfo", ""),
        // -setzombies → setzombiesmode (empty)
        "-setzombies" => write_trigger_file(&folder, "setzombiesmode", ""),
        // -loadcustomcamo → loadcustomcamo (empty)
        "-loadcustomcamo" => write_trigger_file(&folder, "loadcustomcamo", ""),
        // -rename "<name>" — exactly as provided (no trim, no length edits)
        "-rename" => {
            let name = args
                .get(1)
                .ok_or_else(|| "-rename needs a name.".to_string())
                .and_then(|value| validate_arg(value, false, false))?;
            write_trigger_file(&folder, "rename", &name)
        }
        // -brmodejup → cbuf Enable BR mode (JUP)
        "-brmodejup" => write_cbuf(&folder, BR_MODE_JUP_ENABLE_CBUF),
        // -disablebrjup → cbuf Disable BR mode (JUP)
        "-disablebrjup" => write_cbuf(&folder, BR_MODE_JUP_DISABLE_CBUF),
        // -toggle "<feature>" on|off — delete the opposite file, write the state file
        "-toggle" => {
            let feature = args
                .get(1)
                .ok_or_else(|| "-toggle needs a feature name.".to_string())
                .and_then(|value| validate_toggle_feature(value))?;
            let state = args
                .get(2)
                .ok_or_else(|| "-toggle needs 'on' or 'off'.".to_string())?;
            match state.trim() {
                "on" => apply_toggle(&folder, &feature, true),
                "off" => apply_toggle(&folder, &feature, false),
                _ => Err("-toggle state must be 'on' or 'off'.".to_string()),
            }
        }
        unknown => Err(format!(
            "Unknown RTM action '{unknown}'. Known actions: -lua, -cbuf, -join, -savedata, -loaddata, -disconnect, -startmatch, -createlobby, -sendips, -hotreloadgsc, -hotreloadzmgsc, -restoregsc, -showinfo, -setzombies, -loadcustomcamo, -rename, -brmodejup, -disablebrjup, -toggle."
        )),
    }
}
