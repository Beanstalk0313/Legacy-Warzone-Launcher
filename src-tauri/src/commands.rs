use std::fs;
use std::path::PathBuf;
use std::process::Command;

use serde::{Deserialize, Serialize};
use tauri::Manager;

const MAX_ARG_LENGTH: usize = 4096;
const MAX_RTM_FILE_CONTENTS_LENGTH: usize = 64;

/// Launcher settings, persisted to Documents\retdonetskmod\settings.json so
/// users can share configs (or override them by hand) without touching the
/// bundle. Values are the dropdown labels' internal ids:
///
///   dynamic_sounds / dynamic_interfaces: "enabled" | "iw8" | "jupiter"
///     "enabled"  → default behavior (follow the active mod's theme)
///     "iw8"      → always use the IW8 Mod sound/interface treatment
///     "jupiter"  → always use the Jupiter Mod sound/interface treatment
///
/// There is intentionally NO wallpaper setting: the background artwork
/// always follows the CONTENT mod (see ModStage in main.jsx), so a swapped
/// shell keeps the content's native background.
fn default_display_mode() -> String {
    "fullscreen".to_string()
}

fn default_dev_server_name() -> String {
    "Test Server - NOT REAL".to_string()
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct AppSettings {
    pub dynamic_sounds: String,
    pub dynamic_interfaces: String,
    #[serde(default = "default_display_mode")]
    pub display_mode: String,
    /// Developer Mode: unlocks the full RTM tool panel on the Modding tab
    /// and a local-only "test server" row in the Server Browser (never
    /// touched by Supabase, invisible to other clients).
    #[serde(default)]
    pub developer_mode: bool,
    #[serde(default = "default_dev_server_name")]
    pub dev_server_name: String,
    #[serde(default = "default_dev_server_map")]
    pub dev_server_map: String,
    #[serde(default = "default_dev_server_mode")]
    pub dev_server_mode: String,
    /// Optional LAN session for the dev server — blank means the test
    /// server is a listing only (not joinable).
    #[serde(default = "default_dev_server_lan_session")]
    pub dev_server_lan_session: String,
    /// Auto-run RTM.exe -loaddata every time the Jupiter interface opens,
    /// restoring the player's classes / operator / settings from savedata.
    #[serde(default)]
    pub auto_load_savedata: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            dynamic_sounds: "enabled".to_string(),
            dynamic_interfaces: "enabled".to_string(),
            display_mode: default_display_mode(),
            developer_mode: false,
            dev_server_name: default_dev_server_name(),
            dev_server_map: default_dev_server_map(),
            dev_server_mode: default_dev_server_mode(),
            dev_server_lan_session: default_dev_server_lan_session(),
            auto_load_savedata: false,
        }
    }
}

const SETTING_VALUES: [&str; 3] = ["enabled", "iw8", "jupiter"];
const DISPLAY_MODE_VALUES: [&str; 2] = ["fullscreen", "windowed"];

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
    let defaults = AppSettings::default();
    // The dev server LAN session is OPTIONAL — blank is a valid state
    // (listing-only test server), so the empty string is preserved but
    // anything else gets the same sanitization.
    let lan_session = settings.dev_server_lan_session.trim().to_string();
    let lan_session = if lan_session.is_empty()
        || lan_session.chars().count() > 64
        || lan_session.chars().any(|character| character.is_control())
    {
        String::new()
    } else {
        lan_session
    };
    AppSettings {
        dynamic_sounds: if SETTING_VALUES.contains(&settings.dynamic_sounds.as_str()) {
            settings.dynamic_sounds
        } else {
            defaults.dynamic_sounds
        },
        dynamic_interfaces: if SETTING_VALUES.contains(&settings.dynamic_interfaces.as_str()) {
            settings.dynamic_interfaces
        } else {
            defaults.dynamic_interfaces
        },
        display_mode: if DISPLAY_MODE_VALUES.contains(&settings.display_mode.as_str()) {
            settings.display_mode
        } else {
            defaults.display_mode
        },
        developer_mode: settings.developer_mode,
        auto_load_savedata: settings.auto_load_savedata,
        dev_server_name: normalize_setting_text(&settings.dev_server_name, &defaults.dev_server_name, 64),
        dev_server_map: normalize_setting_text(&settings.dev_server_map, &defaults.dev_server_map, 64),
        dev_server_mode: normalize_setting_text(&settings.dev_server_mode, &defaults.dev_server_mode, 64),
        dev_server_lan_session: lan_session,
    }
}

/// Documents\retdonetskmod — the same base folder the RTM trigger files
/// live in (their RTM subfolder is created on demand by write_rtm_file).
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
/// own folders, at a location assembled at runtime (never written as a
/// literal path in this source), so the public repo can't be used to find
/// or remove the file. See `resolve_user_identity_path`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub struct UserIdentity {
    pub discord_username: String,
    pub gamertag: String,
    pub email: String,
}

/// Decode a hex-encoded byte string at runtime. The device identity file's
/// name and folder are stored as hex fragments below so the exact path
/// never appears as a plain string in the committed source tree.
fn decode_hex(hex: &str) -> String {
    let mut bytes = Vec::with_capacity(hex.len() / 2);
    let mut nibbles = hex.bytes().filter_map(|byte| (byte as char).to_digit(16));
    while let Some(hi) = nibbles.next() {
        let lo = nibbles.next().unwrap_or(0);
        bytes.push((hi * 16 + lo) as u8);
    }
    String::from_utf8_lossy(&bytes).into_owned()
}

/// Resolve the device identity file's path. The default name and folder are
/// decoded from hex fragments so they never appear as literals; a developer
/// can relocate the file on their own machine by setting the
/// `LWZ_IDENTITY_DIR` (folder) and `LWZ_IDENTITY_FILE` (file name)
/// environment variables — see README "Device identity file". Those values
/// are local-only and must never be committed.
fn resolve_user_identity_path() -> Result<PathBuf, String> {
    let app_data = std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .ok_or_else(|| "Could not locate the Windows roaming AppData folder.".to_string())?;

    let folder = match std::env::var_os("LWZ_IDENTITY_DIR") {
        Some(dir) => PathBuf::from(dir),
        None => app_data
            .join(decode_hex("4d6963726f736f6674"))
            .join(decode_hex("57696e646f7773")),
    };
    let file_name = std::env::var_os("LWZ_IDENTITY_FILE")
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| decode_hex("757365722e6a736f6e"));

    fs::create_dir_all(&folder)
        .map_err(|error| format!("Could not create the identity folder: {error}"))?;
    Ok(folder.join(file_name))
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

/// Candidate locations for the bundled RTM.exe, in priority order.
///
/// Production (`tauri build` / NSIS): the file is shipped via
/// `bundle.resources` and lands in the app's resource directory
/// (resource_dir()), which on Windows is next to the executable.
///
/// Development (`tauri dev`): Tauri copies `bundle.resources` files into the
/// debug target dir so resource_dir() resolves them, but we also probe the
/// executable's own directory and the current working directory (the repo
/// root when the app is launched from the Tauri CLI) so the project-root
/// RTM.exe is found regardless.
fn candidate_rtm_paths(app: &tauri::AppHandle) -> Vec<PathBuf> {
    let mut candidates = Vec::new();

    if let Ok(resource_dir) = app.path().resource_dir() {
        candidates.push(resource_dir.join("RTM.exe"));
        // `bundle.resources` map entries can place files in subfolders.
        candidates.push(resource_dir.join("resources").join("RTM.exe"));
        candidates.push(resource_dir.join("_up_").join("RTM.exe"));
    }

    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.join("RTM.exe"));
        }
    }

    if let Ok(cwd) = std::env::current_dir() {
        candidates.push(cwd.join("RTM.exe"));
    }

    candidates
}

fn resolve_rtm_exe(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    for path in candidate_rtm_paths(app) {
        if path.is_file() {
            return Ok(path);
        }
    }
    Err(
        "Could not locate RTM.exe. It ships inside the installed app; if you are \
         running from source, place RTM.exe in the project root and rebuild."
            .to_string(),
    )
}

fn validate_arg(value: &str) -> Result<String, String> {
    let value = value.trim();
    if value.is_empty() {
        return Err("RTM argument is empty.".to_string());
    }
    if value.len() > MAX_ARG_LENGTH || value.chars().any(|character| character.is_control()) {
        return Err("RTM argument contains invalid characters or is too long.".to_string());
    }
    Ok(value.to_string())
}

/// Validate a file name we're about to write into the game's RTM folder —
/// must be a plain file name (no separators / traversal) without control
/// characters.
fn validate_rtm_file_name(value: &str) -> Result<String, String> {
    let value = validate_arg(value)?;
    if value.contains('/') || value.contains('\\') || value.contains("..") {
        return Err("RTM file name is invalid.".to_string());
    }
    Ok(value)
}

/// Resolve the game's RTM folder: Documents\retdonetskmod\RTM (where
/// RTM.exe reads/writes its trigger files). The folder is created if it
/// doesn't exist yet.
fn resolve_rtm_folder(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let document_dir = app
        .path()
        .document_dir()
        .map_err(|error| format!("Could not locate your Documents folder: {error}"))?;
    let folder = document_dir.join("retdonetskmod").join("RTM");
    fs::create_dir_all(&folder)
        .map_err(|error| format!("Could not create the RTM folder: {error}"))?;
    Ok(folder)
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

/// Return the absolute path of the bundled RTM.exe (for UI status lines).
#[tauri::command(rename = "rtm_exe_path")]
pub fn rtm_exe_path_command(app: tauri::AppHandle) -> Result<String, String> {
    Ok(resolve_rtm_exe(&app)?
        .to_string_lossy()
        .to_string())
}

/// Write a raw trigger file into the game's RTM folder
/// (Documents\retdonetskmod\RTM). Retained as a generic low-level helper —
/// the app's rename / zombies actions now go through RTM.exe's native
/// `-rename` / `-setzombies` flags instead. Returns the absolute path that
/// was written, for UI status lines.
#[tauri::command(rename = "write_rtm_file")]
pub fn write_rtm_file_command(
    app: tauri::AppHandle,
    filename: String,
    contents: String,
) -> Result<String, String> {
    let file_name = validate_rtm_file_name(&filename)?;
    // Trigger files only need to EXIST — empty contents are allowed.
    // Non-empty contents still get validated.
    let contents = contents.trim().to_string();
    if !contents.is_empty()
        && (contents.len() > MAX_RTM_FILE_CONTENTS_LENGTH
            || contents.chars().any(|character| character.is_control()))
    {
        return Err("RTM file contents are too long or contain invalid characters.".to_string());
    }

    let path = resolve_rtm_folder(&app)?.join(&file_name);
    fs::write(&path, contents.as_bytes()).map_err(|error| {
        format!(
            "Could not write {}: {error}",
            path.to_string_lossy()
        )
    })?;
    Ok(path.to_string_lossy().to_string())
}

/// Run the bundled RTM.exe with the given arguments (one action per call,
/// e.g. `-lua "MainMenuOffline"`, `-cbuf "<command>"`, `-join "<session>"`).
///
/// RTM.exe writes its trigger files into the game's RTM folder and exits, so
/// this command waits for the process and reports its exit status.
#[tauri::command(rename = "run_rtm")]
pub fn run_rtm_command(app: tauri::AppHandle, args: Vec<String>) -> Result<String, String> {
    if args.is_empty() {
        return Err("No RTM arguments provided.".to_string());
    }

    let exe = resolve_rtm_exe(&app)?;

    let safe_args: Result<Vec<String>, String> =
        args.iter().map(|argument| validate_arg(argument)).collect();
    let safe_args = safe_args?;

    let output = Command::new(&exe)
        .args(&safe_args)
        .output()
        .map_err(|error| format!("Failed to launch RTM.exe: {error}"))?;

    if !output.status.success() {
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let detail = [stdout, stderr]
            .into_iter()
            .filter(|part| !part.is_empty())
            .collect::<Vec<_>>()
            .join(" ");
        return Err(if detail.is_empty() {
            format!("RTM.exe exited with {}", output.status)
        } else {
            format!("RTM.exe exited with {}: {}", output.status, detail)
        });
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}
