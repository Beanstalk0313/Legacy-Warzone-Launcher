//! Keyboard input automation for the Jupiter game.
//!
//! The join flow used to stop at a manual guided modal ("in the PHA Client,
//! click Local Play → click Create Local Game"). Now, once the prep sequence
//! has parked the game at its offline main menu, the launcher focuses the
//! game window ("Call of Duty© HQ") and drives the menu with real keyboard
//! input via SendInput — then the config cbuf + `-join` run exactly as
//! before.
//!
//! Design notes:
//!   • Scancodes (`KEYEVENTF_SCANCODE`), not virtual keys — CoD reads raw
//!     input by scancode, and scancodes are layout-proof (WASD works on any
//!     keyboard layout).
//!   • NO process is ever spawned in this module — it is pure user32 API
//!     calls (SendInput / FindWindowW / SetForegroundWindow), so no console
//!     window can ever flash while the menu is being driven.
//!   • Non-Windows builds are inert (the commands exist but report "not
//!     focused" / reject keys) so the crate still compiles cross-platform.

use std::time::Duration;

/// Exact window title of the Jupiter game (as shown on the taskbar). Used
/// verbatim by FindWindowW — keep it exactly as the game sets it.
const GAME_WINDOW_TITLE: &str = "Call of Duty© HQ";

const INPUT_KEYBOARD: u32 = 1;
const KEYEVENTF_EXTENDEDKEY: u32 = 0x0001;
const KEYEVENTF_KEYUP: u32 = 0x0002;
const KEYEVENTF_SCANCODE: u32 = 0x0008;

// ── Win32 FFI (user32). Same raw-extern style as the ShellExecuteW call in
//    game_install.rs — no extra crate dependency.
#[cfg(target_os = "windows")]
mod win {
    #[repr(C)]
    #[derive(Copy, Clone)]
    pub struct KeybdInput {
        pub w_vk: u16,
        pub w_scan: u16,
        pub dw_flags: u32,
        pub time: u32,
        pub dw_extra_info: usize,
    }

    #[repr(C)]
    #[derive(Copy, Clone)]
    #[allow(dead_code)]
    pub struct MouseInput {
        pub dx: i32,
        pub dy: i32,
        pub mouse_data: u32,
        pub dw_flags: u32,
        pub time: u32,
        pub dw_extra_info: usize,
    }

    #[repr(C)]
    #[derive(Copy, Clone)]
    #[allow(dead_code)]
    pub struct HardwareInput {
        pub u_msg: u32,
        pub w_param_l: u16,
        pub w_param_h: u16,
    }

    #[repr(C)]
    pub union InputUnion {
        pub ki: KeybdInput,
        #[allow(dead_code)]
        pub mi: MouseInput,
        #[allow(dead_code)]
        pub hi: HardwareInput,
    }

    #[repr(C)]
    pub struct Input {
        pub ty: u32,
        pub u: InputUnion,
    }

    #[link(name = "user32")]
    extern "system" {
        pub fn SendInput(c_inputs: u32, p_inputs: *const Input, cb_size: i32) -> u32;
        pub fn FindWindowW(lp_class_name: *const u16, lp_window_name: *const u16) -> isize;
        pub fn SetForegroundWindow(h_wnd: isize) -> i32;
        pub fn GetForegroundWindow() -> isize;
    }
}

/// Translate a semantic key name into its PC/AT scancode + whether it is an
/// "extended" key (arrows etc. need `KEYEVENTF_EXTENDEDKEY` so they are
/// distinguishable from the numpad / legacy equivalents).
#[cfg(target_os = "windows")]
fn key_to_scancode(name: &str) -> Result<(u16, bool), String> {
    // Single letters a–z (a = scancode 0x1E) and digits 1–9, 0.
    if name.len() == 1 {
        let byte = name.as_bytes()[0];
        if byte.is_ascii_lowercase() {
            return Ok((0x1E + (byte - b'a') as u16, false));
        }
        if byte.is_ascii_digit() {
            let scan = if byte == b'0' { 0x0B } else { 0x02 + (byte - b'1') as u16 };
            return Ok((scan, false));
        }
    }
    let (scan, extended) = match name {
        "right" => (0x4D, true),
        "left" => (0x4B, true),
        "up" => (0x48, true),
        "down" => (0x50, true),
        "space" => (0x39, false),
        "enter" | "return" => (0x1C, false),
        "escape" | "esc" => (0x01, false),
        "tab" => (0x0F, false),
        "backspace" => (0x0E, false),
        "shift" => (0x2A, false),
        "ctrl" => (0x1D, false),
        "alt" => (0x38, false),
        _ => return Err(format!("Unknown game key '{name}'.")),
    };
    Ok((scan, extended))
}

/// Send one key event (down or up) for a scancode. `dw_extra_info` is left
/// zero; the OS still marks SendInput events as injected, which is fine for
/// this game (no anti-cheat is involved).
#[cfg(target_os = "windows")]
fn send_key_input(scan: u16, extended: bool, key_up: bool) {
    let mut flags = KEYEVENTF_SCANCODE;
    if extended {
        flags |= KEYEVENTF_EXTENDEDKEY;
    }
    if key_up {
        flags |= KEYEVENTF_KEYUP;
    }
    let input = win::Input {
        ty: INPUT_KEYBOARD,
        u: win::InputUnion {
            ki: win::KeybdInput {
                w_vk: 0,
                w_scan: scan,
                dw_flags: flags,
                time: 0,
                dw_extra_info: 0,
            },
        },
    };
    unsafe {
        win::SendInput(1, &input, std::mem::size_of::<win::Input>() as i32);
    }
}

/// Windows implementation: focus the game window, then send the key down/up
/// pair with a small gap so the game's menu code sees a real key-down edge
/// (some CoD menus ignore instant down+up pairs).
#[cfg(target_os = "windows")]
fn send_key_inner(name: &str) -> Result<(), String> {
    let (scan, extended) = key_to_scancode(name)?;
    send_key_input(scan, extended, false);
    std::thread::sleep(Duration::from_millis(20));
    send_key_input(scan, extended, true);
    Ok(())
}

#[cfg(not(target_os = "windows"))]
fn send_key_inner(_name: &str) -> Result<(), String> {
    Err("Keyboard input is only available on Windows.".to_string())
}

/// Windows implementation: find the game window by exact title and bring it
/// to the foreground. `SetForegroundWindow` can transiently fail under
/// Windows' foreground-lock rules, so retry for up to ~2 s. Returns whether
/// focus was actually secured.
#[cfg(target_os = "windows")]
fn focus_game_window_inner() -> bool {
    let title: Vec<u16> = GAME_WINDOW_TITLE
        .encode_utf16()
        .chain(std::iter::once(0))
        .collect();
    let hwnd = unsafe { win::FindWindowW(std::ptr::null(), title.as_ptr()) };
    if hwnd == 0 {
        return false;
    }
    for _ in 0..20 {
        unsafe {
            win::SetForegroundWindow(hwnd);
        }
        std::thread::sleep(Duration::from_millis(100));
        if unsafe { win::GetForegroundWindow() } == hwnd {
            return true;
        }
    }
    false
}

#[cfg(not(target_os = "windows"))]
fn focus_game_window_inner() -> bool {
    false
}

/// Bring the Jupiter game window ("Call of Duty© HQ") to the foreground so
/// the injected keys land in the game. Returns whether focus was secured —
/// the frontend falls back to the manual guided modal when it's false (e.g.
/// the game isn't running yet).
#[tauri::command(rename = "focus_game_window")]
pub async fn focus_game_window_command() -> Result<bool, String> {
    Ok(focus_game_window_inner())
}

/// Send a single named keypress to the foreground window (right, space, x,
/// enter, escape, up/down/left/right, a–z, 0–9, …). The frontend orchestrates
/// the delays between keys, mirroring how the RTM prep sequence is driven.
#[tauri::command(rename = "send_game_key")]
pub async fn send_game_key_command(key: String) -> Result<(), String> {
    send_key_inner(key.trim().to_lowercase().as_str())
}
