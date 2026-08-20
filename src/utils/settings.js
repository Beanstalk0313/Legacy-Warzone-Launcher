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
 *   developer_mode: boolean
 *   auto_load_savedata: boolean (run RTM.exe -loaddata on Jupiter entry)
 *   dev_server_name / dev_server_map / dev_server_mode /
 *   dev_server_lan_session: dev test-server metadata (Developer Mode only)
 */
export const DEFAULT_SETTINGS = Object.freeze({
  dynamic_sounds: 'enabled',
  dynamic_interfaces: 'enabled',
  display_mode: 'fullscreen',
  developer_mode: false,
  auto_load_savedata: false,
  dev_server_name: 'Test Server - NOT REAL',
  dev_server_map: 'Rebirth Island',
  dev_server_mode: 'Resurgence',
  dev_server_lan_session: '',
})

const SETTING_KEYS = ['dynamic_sounds', 'dynamic_interfaces']
const DYNAMIC_SETTING_VALUES = ['enabled', 'iw8', 'jupiter']
const DISPLAY_MODE_VALUES = ['fullscreen', 'windowed']

const STORAGE_KEY = 'lwz-settings'

const MAX_DEV_TEXT_LENGTH = 64

export const isTauriRuntime = () => Boolean(window.__TAURI_INTERNALS__ || window.__TAURI__)

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
  if (typeof source.developer_mode === 'boolean') {
    result.developer_mode = source.developer_mode
  }
  if (typeof source.auto_load_savedata === 'boolean') {
    result.auto_load_savedata = source.auto_load_savedata
  }
  result.dev_server_name = cleanSettingText(source.dev_server_name, DEFAULT_SETTINGS.dev_server_name)
  result.dev_server_map = cleanSettingText(source.dev_server_map, DEFAULT_SETTINGS.dev_server_map)
  result.dev_server_mode = cleanSettingText(source.dev_server_mode, DEFAULT_SETTINGS.dev_server_mode)
  // The dev LAN session is optional — blank is valid (listing-only server).
  result.dev_server_lan_session = cleanSettingText(source.dev_server_lan_session, '')
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
