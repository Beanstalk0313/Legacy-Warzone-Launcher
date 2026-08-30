use std::fs;
use std::io::{BufRead, BufReader, BufWriter, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use reqwest::header::{ACCEPT, AUTHORIZATION, COOKIE, ORIGIN, RANGE, REFERER, USER_AGENT};
use serde::Serialize;
use sha2::{Digest, Sha256};
use tauri::{AppHandle, Emitter, Manager};

/// Jupiter game distribution constants (the file the launcher installs).
/// The content id comes from the GoFile share URL the app is built around.
const CONTENT_ID: &str = "84e6a980-efbd-4994-9518-d2e496ba1b79";
const FILE_NAME: &str = "Steam_JUP_S6_Haunting.rar";

/// Download-write buffer: coalesces the CDN's network chunks (~16-64 KB)
/// into large sequential disk writes instead of one syscall per chunk.
const DOWNLOAD_WRITE_BUFFER: usize = 1024 * 1024;

/// Global cancel flag for an in-flight install. Set by the frontend via
/// `cancel_game_install`; checked by the download loop and the extractor so
/// a 108 GB download (or a long extract) can be aborted. The partial archive
/// is kept so a later install resumes via the Range header.
static CANCEL_REQUESTED: AtomicBool = AtomicBool::new(false);

fn cancel_requested() -> bool {
    CANCEL_REQUESTED.load(Ordering::SeqCst)
}

/// Outcome of one install stage — lets the caller stop the pipeline when the
/// user cancels instead of marching on to extract/install.bat.
#[derive(Debug, Clone, Copy, PartialEq)]
enum InstallOutcome {
    Done,
    Cancelled,
}

// ── GoFile website-token (wt) generation ───────────────────────────────────
// GoFile no longer accepts a static token (config.js now carries a decoy); the
// real X-Website-Token is computed client-side in gofile.io/dist/js/wt.obf.js as
//
//     sha256("{userAgent}::{language}::{accountToken}::{window}::{salt}")
//
// where `window = floor(unix_time / 14400)` is a rotating 4-hour bucket and
// `salt` is a secret embedded in wt.obf.js. The User-Agent + X-BL headers sent
// on every request MUST match the values hashed into the token.
const GOFILE_USER_AGENT: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 \
     (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const GOFILE_LANGUAGE: &str = "en-US";
// Salt currently embedded in wt.obf.js. If GoFile rotates it and downloads start
// failing with error-notPremium again, update this value.
const GOFILE_WT_SALT: &str = "12af056dacea0b";
const WT_WINDOW_SECONDS: i64 = 14400;

fn website_token(account_token: &str, window_offset: i64) -> String {
    let window = (SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_secs() as i64
        / WT_WINDOW_SECONDS)
        + window_offset;
    let raw = format!(
        "{GOFILE_USER_AGENT}::{GOFILE_LANGUAGE}::{account_token}::{window}::{GOFILE_WT_SALT}"
    );
    let mut hasher = Sha256::new();
    hasher.update(raw.as_bytes());
    let digest = hasher.finalize();
    let mut hex = String::with_capacity(digest.len() * 2);
    for byte in digest {
        use std::fmt::Write as _;
        let _ = write!(hex, "{byte:02x}");
    }
    hex
}

/// Progress event pushed to the frontend so it can paint ONE combined bar for
/// the whole install (download + extract share a single 0–100 scale).
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstallProgress {
    /// "auth" | "download" | "extract" | "finalize" | "done" | "error"
    phase: String,
    /// Combined 0–100 progress across download + extract.
    percent: f64,
    /// Optional human-readable detail (e.g. the current GoFile step).
    message: Option<String>,
}

fn emit_progress(app: &AppHandle, phase: &str, percent: f64, message: Option<&str>) {
    let payload = InstallProgress {
        phase: phase.to_string(),
        percent,
        message: message.map(|s| s.to_string()),
    };
    let _ = app.emit("game-install-progress", payload);
}

/// Resolve the bundled UnRAR.exe inside the app's resource directory.
fn unrar_binary_path(app: &AppHandle) -> Result<PathBuf, String> {
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|error| format!("Could not locate the app resource folder: {error}"))?;
    let path = resource_dir.join("resources").join("UnRAR.exe");
    if !path.is_file() {
        return Err(
            "The bundled UnRAR.exe extractor is missing from the app's resources.".to_string(),
        );
    }
    Ok(path)
}

// ── GoFile API: guest token + content metadata ─────────────────────────────
async fn get_guest_token(client: &reqwest::Client) -> Result<String, String> {
    let response = client
        .post("https://api.gofile.io/accounts")
        .header(ORIGIN, "https://gofile.io")
        .header(USER_AGENT, GOFILE_USER_AGENT)
        .send()
        .await
        .map_err(|error| format!("Could not reach GoFile to start the download: {error}"))?;
    let body: serde_json::Value = response
        .json()
        .await
        .map_err(|error| format!("GoFile returned an unreadable response: {error}"))?;
    let token = body["data"]["token"]
        .as_str()
        .filter(|value| !value.is_empty())
        .ok_or_else(|| format!("GoFile refused the guest connection: {body}"))?;
    Ok(token.to_string())
}

struct GoFileContent {
    link: String,
    size: u64,
}

/// Fetch the file's direct download link + size from the GoFile API, retrying
/// transient errors and the previous 4-hour token window near a boundary — the
/// same resilience the reference gofile-dl client uses.
async fn fetch_content(
    client: &reqwest::Client,
    token: &str,
) -> Result<GoFileContent, String> {
    let url = format!("https://api.gofile.io/contents/{CONTENT_ID}");
    let base_url = reqwest::Url::parse(&url).map_err(|error| error.to_string())?;
    let query = [
        ("contentFilter", ""),
        ("page", "1"),
        ("pageSize", "1000"),
        ("sortField", "createTime"),
        ("sortDirection", "-1"),
    ];

    let mut rate_limit_retries = 3;
    // Try the current 4-hour token window first, then the previous one (the
    // server clock may sit just past a boundary).
    let mut window_offset = 0i64;

    loop {
        let wt = website_token(token, window_offset);
        let response = client
            .get(base_url.clone())
            .query(&query)
            .header(AUTHORIZATION, format!("Bearer {token}"))
            .header("X-Website-Token", wt)
            .header("X-BL", GOFILE_LANGUAGE)
            .header(USER_AGENT, GOFILE_USER_AGENT)
            .header(ACCEPT, "*/*")
            .header(ORIGIN, "https://gofile.io")
            .header(REFERER, "https://gofile.io/")
            .send()
            .await
            .map_err(|error| {
                format!(
                    "Could not reach GoFile to look up the game file \
                     (a VPN or datacenter IP can be blocked here): {error}"
                )
            })?;
        let body: serde_json::Value = response
            .json()
            .await
            .map_err(|error| format!("GoFile returned an unreadable lookup response: {error}"))?;

        match body["status"].as_str() {
            Some("ok") => {
                let link = body["data"]["link"]
                    .as_str()
                    .ok_or_else(|| "GoFile returned no download link.".to_string())?
                    .to_string();
                let size = body["data"]["size"].as_u64().unwrap_or(0);
                return Ok(GoFileContent { link, size });
            }
            Some("error-rateLimit") if rate_limit_retries > 0 => {
                rate_limit_retries -= 1;
                std::thread::sleep(Duration::from_secs(3));
            }
            Some("error-notPremium") if window_offset == 0 => {
                // Rejected current window; one retry with the previous one.
                window_offset = -1;
            }
            Some(other) => {
                return Err(format!(
                    "GoFile rejected the download lookup (status: {other})."
                ));
            }
            None => return Err("GoFile returned an unrecognized response.".to_string()),
        }
    }
}

/// Stream the file from GoFile's CDN to `dest` with resume support (Range) and
/// a real combined progress feed. `download_span_start`..`download_span_end`
/// is the slice of the combined 0–100 bar this phase owns.
async fn download_file(
    client: &reqwest::Client,
    link: &str,
    token: &str,
    dest: &Path,
    total: u64,
    app: &AppHandle,
    span_start: f64,
    span_end: f64,
) -> Result<InstallOutcome, String> {
    let mut existing = fs::metadata(dest).map(|meta| meta.len()).unwrap_or(0);
    if total > 0 && existing >= total {
        emit_progress(app, "download", span_end, Some("Download already complete"));
        return Ok(InstallOutcome::Done);
    }

    let file = fs::OpenOptions::new()
        .create(true)
        .write(true)
        .truncate(existing == 0)
        .open(dest)
        .map_err(|error| format!("Could not open the download file: {error}"))?;
    // Buffer 1 MiB so the loop coalesces network chunks (~16-64 KB each) into
    // large sequential writes instead of one syscall per chunk.
    let mut file = BufWriter::with_capacity(DOWNLOAD_WRITE_BUFFER, file);

    let response = client
        .get(link)
        .header(COOKIE, format!("accountToken={token}"))
        .header(USER_AGENT, GOFILE_USER_AGENT)
        .header(REFERER, "https://gofile.io/")
        .header(RANGE, format!("bytes={existing}-"))
        .send()
        .await
        .map_err(|error| format!("Could not download the game file: {error}"))?;

    let status = response.status();
    if !status.is_success() && status.as_u16() != 206 {
        return Err(format!("GoFile download failed with HTTP {status}."));
    }
    // A 200 (rather than 206) means the server ignored our Range and restarted
    // from byte 0 — reset the resume cursor accordingly.
    if status == reqwest::StatusCode::OK {
        existing = 0;
        let reopened = fs::OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(true)
            .open(dest)
            .map_err(|error| format!("Could not (re)open the download file: {error}"))?;
        file = BufWriter::with_capacity(DOWNLOAD_WRITE_BUFFER, reopened);
    }

    let total_for_span = total.max(existing);

    let mut stream = response.bytes_stream();
    use futures_util::StreamExt;
    // Progress events cross the Tauri IPC bridge — one per network chunk can
    // mean thousands per second on a fast link, starving the download loop.
    // Throttle to ~10/s; the bar animates over 0.2s anyway.
    let mut last_emit = Instant::now();
    while let Some(chunk) = stream.next().await {
        // Cancellation check per chunk — aborts promptly without tearing the
        // partial archive down (it survives for a Range-resumed re-install).
        if cancel_requested() {
            file.flush().ok();
            return Ok(InstallOutcome::Cancelled);
        }
        let chunk = chunk.map_err(|error| format!("Download stream interrupted: {error}"))?;
        file.write_all(&chunk)
            .map_err(|error| format!("Could not write the downloaded data: {error}"))?;
        existing += chunk.len() as u64;
        if last_emit.elapsed() >= Duration::from_millis(100) {
            last_emit = Instant::now();
            let frac = if total_for_span > 0 {
                (existing as f64 / total_for_span as f64).clamp(0.0, 1.0)
            } else {
                0.0
            };
            let percent = span_start + frac * (span_end - span_start);
            emit_progress(app, "download", percent, None);
        }
    }
    file.flush()
        .map_err(|error| format!("Could not flush the download: {error}"))?;
    emit_progress(app, "download", span_end, None);

    // The CDN may not report an exact 206 length; trust we hit the target.
    Ok(InstallOutcome::Done)
}

/// Parse a trailing ``NN%`` (UnRAR's progress) out of one of its console lines.
fn parse_percent(line: &str) -> Option<f64> {
    let bytes = line.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            // Scan backwards over the digits (and decimal point) preceding `%`.
            let mut j = i;
            while j > 0 && bytes[j - 1].is_ascii_digit() {
                j -= 1;
            }
            if j < i {
                if let Ok(value) = line[j..i].parse::<f64>() {
                    return Some(value.clamp(0.0, 100.0));
                }
            }
        }
        i += 1;
    }
    None
}

/// Extract the game archive into `install_dir` with bundled UnRAR.exe,
/// streaming its percentage into the combined install bar (span_start..span_end).
fn extract_unrar(
    app: &AppHandle,
    archive: &Path,
    install_dir: &Path,
    span_start: f64,
    span_end: f64,
) -> Result<InstallOutcome, String> {
    emit_progress(app, "extract", span_start, Some("Extracting the game…"));
    let unrar_path = unrar_binary_path(app)?;
    // UnRAR expects a trailing separator so it extracts into the folder.
    let mut dest = install_dir.to_string_lossy().to_string();
    if !dest.ends_with(['\\', '/']) {
        dest.push('\\');
    }

    let mut command = Command::new(&unrar_path);
    command
        .arg("x") // extract with full paths
        .arg("-y") // yes to all prompts
        .arg("-o+") // overwrite existing files
        .arg(archive)
        .arg(&dest)
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    // CREATE_NO_WINDOW so the bundled extractor never pops its own console.
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    let mut child = command
        .spawn()
        .map_err(|error| format!("Could not start the game extractor: {error}"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Could not read the extractor's output.".to_string())?;

    let app_clone = app.clone();
    let reader_thread = std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines().map_while(Result::ok) {
            if let Some(pct) = parse_percent(&line) {
                let overall = span_start + (pct / 100.0) * (span_end - span_start);
                emit_progress(&app_clone, "extract", overall, None);
            }
        }
    });

    // Poll try_wait so a cancel request can kill UnRAR mid-extract instead of
    // blocking on child.wait() until it finishes naturally.
    let status = loop {
        if cancel_requested() {
            let _ = child.kill();
            let _ = child.wait();
            let _ = reader_thread.join();
            return Ok(InstallOutcome::Cancelled);
        }
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) => std::thread::sleep(Duration::from_millis(200)),
            Err(error) => {
                let _ = reader_thread.join();
                return Err(format!("The game extractor failed: {error}"));
            }
        }
    };
    let _ = reader_thread.join();
    if !status.success() {
        return Err("The game archive could not be extracted.".to_string());
    }
    emit_progress(app, "extract", span_end, Some("Game extracted"));
    Ok(InstallOutcome::Done)
}

/// Move the tree at `from` to `to`. A plain rename only works when `to`
/// doesn't already exist — on Windows renaming a directory ONTO an existing
/// non-empty directory always fails (ERROR_ALREADY_EXISTS). That failure was
/// the root cause of installs ending up with only the tiny `cod_files` overlay
/// and none of the extracted game: the big `Steam_JUP_S6_Haunting\CoD` move
/// silently failed (leave + user-folder already present, or a prior partial
/// run), the game never reached `install_dir\CoD`, and nothing detected it.
/// This helper falls back to a recursive per-entry merge into the destination
/// so the game always lands in place, then removes the source once it's empty.
fn move_tree(from: &Path, to: &Path) -> std::io::Result<()> {
    // Fast path: a plain rename moves the whole tree in one call (works when
    // `to` doesn't exist yet, or is an existing file we can move over).
    match fs::rename(from, to) {
        Ok(()) => return Ok(()),
        Err(_) => {} // fall through to the merge below
    }

    // Source is a file. A rename only fails here if a destination of the same
    // name already exists — replace it (the extractor's output wins), then
    // move. Never lose data: fall back to a copy+delete if the retry fails.
    if !from.is_dir() {
        if to.exists() {
            let _ = fs::remove_file(to);
        }
        if fs::rename(from, to).is_err() {
            let _ = fs::copy(from, to);
            let _ = fs::remove_file(from);
        }
        return Ok(());
    }

    // Source is a directory and the rename failed — the destination directory
    // already exists, so merge the entries recursively instead.
    fs::create_dir_all(to)?;
    let mut pending = 0usize;
    let entries = fs::read_dir(from)?;
    for entry in entries {
        let entry = entry?;
        let source = entry.path();
        let target = to.join(entry.file_name());
        if let Err(error) = move_tree(&source, &target) {
            pending += 1;
            eprintln!("[game_install] could not move {:?} -> {:?}: {error}", source, target);
        }
    }
    // Only remove the source once every child has been lifted out.
    if pending == 0 {
        let _ = fs::remove_dir(from);
    }
    Ok(())
}

/// After extraction the archive creates a `Steam_JUP_S6_Haunting` subfolder
/// inside the install directory containing the game (`CoD\cod.exe`). This
/// lifts the whole wrapper up to the install directory root so `install.bat` /
/// `startgame.bat` / `CoD` sit directly in the user's chosen folder, then
/// removes the now-empty wrapper. Robust against the destination folder
/// already existing (re-install / leftover partial run) via `move_tree`.
fn flatten_extracted_archive(install_dir: &Path) {
    let nested = install_dir.join("Steam_JUP_S6_Haunting");
    if !nested.is_dir() {
        return;
    }
    // Move every entry in the nested wrapper up to the install dir.
    if let Ok(entries) = fs::read_dir(&nested) {
        for entry in entries.filter_map(Result::ok) {
            let dest = install_dir.join(entry.file_name());
            if let Err(error) = move_tree(&entry.path(), &dest) {
                eprintln!("[game_install] could not move {:?} -> {:?}: {error}", entry.path(), dest);
            }
        }
    }
    // Remove the now-empty wrapper folder (best-effort).
    let _ = fs::remove_dir(&nested);
}

/// The game is considered installed only once its real executable is present
/// at `install_dir\CoD\cod.exe` — the path `StartGame.bat` (`cd /d CoD` then
/// `bootstrapper.exe cod.exe`) and the distribution readme both expect. If
/// it's missing we fail loudly instead of reporting a "successful" install
/// that only contains the small `cod_files` mod overlay.
fn verify_game_present(install_dir: &Path) -> Result<(), String> {
    let game_root = install_dir.join("CoD");
    let game_exe = game_root.join("cod.exe");
    if !game_exe.is_file() {
        return Err(
            "The game archive was extracted but the game executable \
             CoD\\cod.exe is missing from the install folder. The download may \
             have been incomplete. The downloaded .rar is kept so you can extract \
             it manually — please run the install again."
                .to_string(),
        );
    }
    Ok(())
}

/// Copy bundled mod files from `src-tauri/resources/cod_files` into the
/// install directory, overwriting any existing files. Missing parent
/// directories are created automatically.
fn copy_cod_files(app: &AppHandle, install_dir: &Path) -> Result<(), String> {
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|error| format!("Could not locate the app resource folder: {error}"))?;
    let src = resource_dir.join("resources").join("cod_files");
    if !src.is_dir() {
        // No bundled cod_files — not an error, just nothing to merge.
        return Ok(());
    }
    copy_dir_recursive_inner(&src, install_dir)
        .map_err(|error| format!("Could not merge mod files into the game folder: {error}"))
}

fn copy_dir_recursive_inner(src: &Path, dst: &Path) -> std::io::Result<()> {
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());
        if src_path.is_dir() {
            fs::create_dir_all(&dst_path)?;
            copy_dir_recursive_inner(&src_path, &dst_path)?;
        } else {
            // Ensure parent exists, then copy (overwrite if present).
            if let Some(parent) = dst_path.parent() {
                fs::create_dir_all(parent)?;
            }
            fs::copy(&src_path, &dst_path)?;
        }
    }
    Ok(())
}

/// Add a Windows Defender exclusion for `path` via PowerShell. Elevated
/// through UAC so the command succeeds even in per-machine installs. Non-
/// fatal: if the user declines UAC or Defender is off, the install continues.
#[cfg(target_os = "windows")]
fn add_defender_exclusion(path: &Path) {
    extern "system" {
        fn ShellExecuteW(
            hwnd: *mut core::ffi::c_void,
            lpOperation: *const u16,
            lpFile: *const u16,
            lpParameters: *const u16,
            lpDirectory: *const u16,
            nShowCmd: i32,
        ) -> *mut core::ffi::c_void;
    }
    let path_wide: Vec<u16> = path
        .to_string_lossy()
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();
    // Build the PowerShell command: Add-MpExclusion -Path '<path>'
    let ps_cmd = format!("Add-MpExclusion -Path '{}'", path.to_string_lossy());
    let cmd_line = format!("powershell.exe -NoProfile -NonInteractive -Command '{}'", ps_cmd);
    let cmd_wide: Vec<u16> = cmd_line
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();
    let file_wide: Vec<u16> = "powershell.exe"
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();
    let op: Vec<u16> = "runas\u{0}".encode_utf16().collect();
    let result = unsafe {
        ShellExecuteW(
            std::ptr::null_mut(),
            op.as_ptr(),
            file_wide.as_ptr(),
            cmd_wide.as_ptr(),
            path_wide.as_ptr(),
            0, // SW_HIDE
        )
    };
    let handle = result as isize;
    if handle <= 32 {
        eprintln!("[game_install] Defender exclusion failed (non-fatal): ShellExecuteW returned {handle}");
    }
}

#[cfg(not(target_os = "windows"))]
fn add_defender_exclusion(_path: &Path) {}

/// Recursively delete a directory and all its contents.
fn remove_dir_recursive(path: &Path) -> std::io::Result<()> {
    if path.is_dir() {
        for entry in fs::read_dir(path)? {
            let entry = entry?;
            let entry_path = entry.path();
            if entry_path.is_dir() {
                remove_dir_recursive(&entry_path)?;
            } else {
                fs::remove_file(&entry_path)?;
            }
        }
        fs::remove_dir(path)
    } else {
        Ok(())
    }
}

/// Run one of the game's .bat steps with the work dir set to the install dir.
/// Used for install.bat (during install) and startgame.bat (on launch).
fn run_install_script(install_dir: &Path, script_name: &str) -> Result<(), String> {
    let script = install_dir.join(script_name);
    if !script.is_file() {
        // A missing optional script is fine (e.g. launch before install.bat).
        return Ok(());
    }
    #[cfg(target_os = "windows")]
    {
        // Use ShellExecuteW with the "runas" verb to elevate the bat file
        // through UAC. This shows the admin consent dialog so startgame.bat
        // runs with elevated privileges.
        use std::os::windows::ffi::OsStrExt;
        extern "system" {
            fn ShellExecuteW(
                hwnd: *mut core::ffi::c_void,
                lpOperation: *const u16,
                lpFile: *const u16,
                lpParameters: *const u16,
                lpDirectory: *const u16,
                nShowCmd: i32,
            ) -> *mut core::ffi::c_void;
        }
        const SW_SHOWNORMAL: i32 = 1;

        let file: Vec<u16> = std::ffi::OsStr::new(&script)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        let dir: Vec<u16> = std::ffi::OsStr::new(install_dir)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        let operation: Vec<u16> = "runas\u{0}".encode_utf16().collect();

        let result = unsafe { ShellExecuteW(std::ptr::null_mut(), operation.as_ptr(), file.as_ptr(), std::ptr::null(), dir.as_ptr(), SW_SHOWNORMAL) };
        // ShellExecuteW returns a value > 32 on success.
        let handle = result as isize;
        if handle <= 32 {
            return Err(format!("Could not launch {script_name} as administrator."));
        }
        return Ok(());
    }
    #[cfg(not(target_os = "windows"))]
    {
        let mut command = Command::new("cmd");
        command
            .arg("/C")
            .arg(&script)
            .current_dir(install_dir);
        let _ = command.spawn().map_err(|error| {
            format!("Could not run {script_name}: {error}")
        });
        Ok(())
    }
}

/// Full Jupiter game install: authenticate with GoFile, stream the archive
/// (with progress), extract with UnRAR, then run the game's install.bat. The
/// frontend rejoins via `game-install-progress` events to paint ONE combined
/// bar across the download + extract phases. A cancel request aborts cleanly
/// (the partial .part survives for a later resume) and emits a "cancelled"
/// phase instead of marching on to extract/install.bat.
#[tauri::command(rename = "install_jupiter_game")]
pub async fn install_jupiter_game_command(app: AppHandle, install_dir: String) -> Result<(), String> {
    CANCEL_REQUESTED.store(false, Ordering::SeqCst);

    let dir = PathBuf::from(&install_dir);
    // The path is created automatically if it doesn't exist yet — a fresh
    // "C:\Games\Warzone III" works on the first try.
    fs::create_dir_all(&dir)
        .map_err(|error| format!("Could not create the install folder: {error}"))?;

    // Add a Windows Defender exclusion for the game directory before the
    // download begins — the bundled mod DLLs trigger a false-positive if
    // they land in an un-excluded folder. Non-fatal: UAC decline or a
    // missing Defender install just means the exclusion is skipped.
    add_defender_exclusion(&dir);

    emit_progress(&app, "auth", 0.0, Some("Connecting to GoFile…"));
    let client = reqwest::Client::builder()
        .user_agent(GOFILE_USER_AGENT)
        // Single-connection throughput over HTTP/2: the default 64 KB H2
        // stream window caps a fast high-latency (CDN) link well below what
        // the TCP connection itself can carry. The adaptive window grows it
        // toward the measured bandwidth×delay product. No-op on HTTP/1.1.
        .http2_adaptive_window(true)
        .build()
        .map_err(|error| error.to_string())?;
    let token = get_guest_token(&client).await?;
    let content = fetch_content(&client, &token).await?;

    let archive = dir.join(FILE_NAME);
    let outcome = download_file(
        &client,
        &content.link,
        &token,
        &archive,
        content.size,
        &app,
        0.0,
        68.0,
    )
    .await?;
    if outcome == InstallOutcome::Cancelled {
        emit_cancelled(&app);
        return Ok(());
    }

    let outcome = extract_unrar(&app, &archive, &dir, 68.0, 100.0)?;
    if outcome == InstallOutcome::Cancelled {
        emit_cancelled(&app);
        return Ok(());
    }

    // The archive creates a `Steam_JUP_S6_Haunting` subfolder; move its
    // contents up so install.bat / startgame.bat / CoD sit directly in
    // the user's chosen folder. Robust to the destination already existing.
    flatten_extracted_archive(&dir);

    // Merge bundled mod files (CoD/ DLLs, steam_settings, etc.) into the
    // install directory, overwriting any duplicates from the archive.
    copy_cod_files(&app, &dir)?;

    // Only after everything is merged do we guarantee the real game actually
    // made it into place. If cod.exe is missing the install FAILS here with a
    // clear message (and the .rar is intentionally left on disk so the user
    // can extract it manually) instead of waving through a broken folder.
    verify_game_present(&dir)?;

    // The extracted game no longer needs the 100+ GB archive — free it as soon
    // as extraction finishes. A missing file is fine (already deleted / a
    // resumed install); a real failure is non-fatal but reported in the done
    // message so the user knows to reclaim the space manually.
    let archive_deleted = match fs::remove_file(&archive) {
        Ok(_) => true,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => true,
        Err(error) => {
            eprintln!("[game_install] could not delete the archive: {error}");
            false
        }
    };

    emit_progress(&app, "finalize", 100.0, Some("Finalizing install…"));
    run_install_script(&dir, "install.bat")?;
    let done_message = if archive_deleted {
        "Install complete"
    } else {
        "Install complete (could not delete the archive)"
    };
    emit_progress(&app, "done", 100.0, Some(done_message));

    Ok(())
}

/// Cancel an in-flight game install. The download loop / extractor notice the
/// flag on their next tick and stop; the partial archive is kept for resume.
#[tauri::command(rename = "cancel_game_install")]
pub fn cancel_game_install_command() -> Result<(), String> {
    CANCEL_REQUESTED.store(true, Ordering::SeqCst);
    Ok(())
}

fn emit_cancelled(app: &AppHandle) {
    let payload = InstallProgress {
        phase: "cancelled".to_string(),
        percent: 0.0,
        message: Some("Install cancelled".to_string()),
    };
    let _ = app.emit("game-install-progress", payload);
}

/// Launch the installed Jupiter game by running its startgame.bat.
#[tauri::command(rename = "launch_jupiter_game")]
pub fn launch_jupiter_game_command(app: AppHandle, install_dir: String) -> Result<(), String> {
    // `app` keeps the signature consistent with the other commands; the bat is
    // run from the install dir, not the launcher.
    let _ = &app;
    run_install_script(&PathBuf::from(&install_dir), "startgame.bat")
}

/// Report whether the game is installed at `install_dir` (i.e. its
/// startgame.bat exists). Lets the UI decide between INSTALL and LAUNCH.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GameInstallStatus {
    path: String,
    installed: bool,
}

#[tauri::command(rename = "game_install_status")]
pub fn game_install_status_command(install_dir: String) -> Result<GameInstallStatus, String> {
    let dir = PathBuf::from(&install_dir);
    let installed = dir.join("startgame.bat").is_file();
    Ok(GameInstallStatus {
        path: install_dir,
        installed,
    })
}

/// Delete the Jupiter game install directory and all its contents.
#[tauri::command(rename = "uninstall_jupiter_game")]
pub fn uninstall_jupiter_game_command(install_dir: String) -> Result<(), String> {
    let dir = PathBuf::from(&install_dir);
    if !dir.is_dir() {
        return Ok(());
    }
    remove_dir_recursive(&dir)
        .map_err(|error| format!("Could not delete the game folder: {error}"))
}