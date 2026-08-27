import { invoke } from '@tauri-apps/api/core'

/**
 * Launcher settings — stored in Documents\retdonetskmod\settings.json so
 * users can share / hand-edit them (a settings_default.json template is
 * created on first run; edit it, then delete settings.json and rename the
 * template over it to override the app defaults).
 *
 * Field names are snake_case to match the Rust AppSettings struct. Values
 * mirror the Options tab dropdown labels' internal ids:
 *
 *   dynamic_sounds / dynamic_interfaces: 'enabled' | 'iw8' | 'jupiter'
 *   display_mode: 'fullscreen' | 'windowed'
 *   display_monitor: monitor name (from list_monitors) or '' = default
 *     monitor — which monitor the launcher window lives on
 *   silent_mode: boolean (mute every launcher SFX)
 *   testing_server: boolean (list the local-only test server in the
 *     Server Browser / Quick Play)
 *   rtm_mode: boolean (show the raw RTM DEV TOOL panel on the RTM tab)
 *   auto_load_savedata: boolean (write the loadstatus trigger on Jupiter entry)
 *   dev_server_name / dev_server_map / dev_server_mode /
 *   dev_server_lan_session: test-server metadata (Testing Server only)
 *   glyph_platform: 'auto' | 'keyboard' | 'xbox' | 'playstation' | 'switch'
 *     | 'steam' | 'steamdeck' — which controller/keyboard glyph pack the UI
 *     shows; 'auto' detects the connected controller (keyboard fallback)
 */
export const DEFAULT_SETTINGS = Object.freeze({
  dynamic_sounds: 'enabled',
  dynamic_interfaces: 'enabled',
  display_mode: 'fullscreen',
  display_monitor: '',
  silent_mode: false,
  accent_jupiter: '#028fcc',
  accent_iw8: '#d92323',
  testing_server: false,
  rtm_mode: false,
  auto_load_savedata: false,
  dev_server_name: 'Local Test Server',
  dev_server_map: 'Rebirth Island',
  dev_server_mode: 'Resurgence',
  dev_server_lan_session: '',
  // Where the Jupiter game is installed (empty = not set / not installed yet).
  game_install_path: '',
  // Controller/keyboard glyph pack ('auto' = detect from the connected pad).
  glyph_platform: 'auto',
})

const SETTING_KEYS = ['dynamic_sounds', 'dynamic_interfaces']
const DYNAMIC_SETTING_VALUES = ['enabled', 'iw8', 'jupiter']
const DISPLAY_MODE_VALUES = ['fullscreen', 'windowed']
const GLYPH_PLATFORM_VALUES = ['auto', 'keyboard', 'xbox', 'playstation', 'switch', 'steam', 'steamdeck']

const STORAGE_KEY = 'lwz-settings'

const MAX_DEV_TEXT_LENGTH = 64

export const isTauriRuntime = () => Boolean(window.__TAURI_INTERNALS__ || window.__TAURI__)

/** Validate a hex color (#rrggbb); fall back to default if invalid. */
function cleanHexColor(value, fallback) {
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim()
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) return trimmed.toLowerCase()
  return fallback
}

/** Trim a hand-editable settings string; fall back when empty/too long/invalid. */
function cleanSettingText(value, fallback, maxLength = MAX_DEV_TEXT_LENGTH) {
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim()
  if (trimmed.length > maxLength || /[\p{Cc}]/u.test(trimmed)) return fallback
  return trimmed
}

/** Coerce an arbitrary value into a complete, valid settings object. */
export function normalizeSettings(raw) {
  const source = raw && typeof raw === 'object' ? raw : {}
  const result = { ...DEFAULT_SETTINGS }
  for (const key of SETTING_KEYS) {
    const value = source[key]
    if (typeof value !== 'string') continue
    if (DYNAMIC_SETTING_VALUES.includes(value)) result[key] = value
  }
  if (typeof source.display_mode === 'string' && DISPLAY_MODE_VALUES.includes(source.display_mode)) {
    result.display_mode = source.display_mode
  }
  // The persisted monitor display name — blank means "the system's default
  // monitor". Kept short + control-free so a hand-edited file can't store
  // garbage; an unknown name just no-ops at apply time.
  result.display_monitor = cleanSettingText(source.display_monitor, '', 128)
  if (typeof source.silent_mode === 'boolean') {
    result.silent_mode = source.silent_mode
  }
  result.accent_jupiter = cleanHexColor(source.accent_jupiter, DEFAULT_SETTINGS.accent_jupiter)
  result.accent_iw8 = cleanHexColor(source.accent_iw8, DEFAULT_SETTINGS.accent_iw8)
  if (typeof source.testing_server === 'boolean') {
    result.testing_server = source.testing_server
  }
  if (typeof source.rtm_mode === 'boolean') {
    result.rtm_mode = source.rtm_mode
  }
  // One-time migration: settings written before the split only had a single
  // `developer_mode` flag (it enabled BOTH the test server and the raw RTM
  // tool). Fold a true value into the two new independent toggles.
  if (source.developer_mode === true
    && typeof source.testing_server !== 'boolean'
    && typeof source.rtm_mode !== 'boolean') {
    result.testing_server = true
    result.rtm_mode = true
  }
  if (typeof source.auto_load_savedata === 'boolean') {
    result.auto_load_savedata = source.auto_load_savedata
  }
  result.dev_server_name = cleanSettingText(source.dev_server_name, DEFAULT_SETTINGS.dev_server_name)
  // The old default test-server name was retired — anyone still on it gets
  // the new default.
  if (result.dev_server_name === 'Test Server - NOT REAL') {
    result.dev_server_name = DEFAULT_SETTINGS.dev_server_name
  }
  result.dev_server_map = cleanSettingText(source.dev_server_map, DEFAULT_SETTINGS.dev_server_map)
  result.dev_server_mode = cleanSettingText(source.dev_server_mode, DEFAULT_SETTINGS.dev_server_mode)
  // The dev LAN session is optional — blank is valid (listing-only server).
  result.dev_server_lan_session = cleanSettingText(source.dev_server_lan_session, '')
  // Game install path — an absolute Windows path (longer than most settings).
  result.game_install_path = cleanSettingText(source.game_install_path, '', 512)
  if (typeof source.glyph_platform === 'string' && GLYPH_PLATFORM_VALUES.includes(source.glyph_platform)) {
    result.glyph_platform = source.glyph_platform
  }
  return result
}

/**
 * Load settings. On the desktop this reads settings.json once (the file is
 * released immediately — the app keeps the values in memory and only writes
 * again on change); in plain-browser dev there is no Rust side, so we fall
 * back to localStorage.
 */
export async function loadSettings() {
  if (isTauriRuntime()) {
    try {
      return normalizeSettings(await invoke('load_settings'))
    } catch (error) {
      console.warn('[settings] load failed; using defaults', error)
      return { ...DEFAULT_SETTINGS }
    }
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    return raw ? normalizeSettings(JSON.parse(raw)) : { ...DEFAULT_SETTINGS }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

/** Persist settings (desktop → settings.json, browser dev → localStorage). */
export async function saveSettings(settings) {
  const normalized = normalizeSettings(settings)
  if (isTauriRuntime()) {
    try {
      await invoke('save_settings', { settings: normalized })
      return
    } catch (error) {
      console.warn('[settings] save failed', error)
      return
    }
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized))
  } catch {
    /* storage unavailable — nothing to do */
  }
}
