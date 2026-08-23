import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'

export const DISPLAY_MODES = ['fullscreen', 'windowed']

export const isTauriRuntime = () => Boolean(window.__TAURI_INTERNALS__ || window.__TAURI__)

async function tryWindowOperation(label, operation, errors) {
  try {
    await operation()
  } catch (error) {
    errors.push(`${label}: ${error?.message || error}`)
    console.warn(`[display-mode] ${label} failed`, error)
  }
}

/**
 * List the displays available to the launcher (Options > Display Monitor).
 * Each entry: { name, ordinal, primary } — `name` is the OS monitor
 * identifier and the persisted setting value; ordinal/primary feed the
 * "Display N (Primary)" labels. Plain-browser dev returns [] (no Rust
 * side), so the dropdown only offers the default monitor.
 */
export async function listMonitors() {
  if (!isTauriRuntime()) return []
  try {
    const monitors = await invoke('list_monitors')
    return Array.isArray(monitors) ? monitors : []
  } catch (error) {
    console.warn('[display-monitor] could not list monitors', error)
    return []
  }
}

/**
 * Move the launcher window onto the named monitor ('' = system default).
 * The move clears fullscreen/maximized, so callers re-apply the display
 * mode afterwards to re-enter it on the new monitor.
 */
export async function applyDisplayMonitor(name) {
  if (!isTauriRuntime()) return
  try {
    await invoke('apply_display_monitor', { name: String(name || '') })
  } catch (error) {
    console.warn('[display-monitor] apply failed', error)
  }
}

/** Apply the persisted display mode to the existing frameless Tauri window. */
export async function applyDisplayMode(mode) {
  if (!isTauriRuntime()) return

  try {
    await invoke('apply_display_mode', { mode })
    return
  } catch (nativeError) {
    // Keep a frontend fallback for development builds using an older binary
    // that does not yet contain the native command.
    console.warn('[display-mode] native command failed; using window API fallback', nativeError)
  }

  const appWindow = getCurrentWindow()
  const errors = []

  if (mode === 'windowed') {
    // Windowed is a maximized desktop window, not a 1280×720 floating box.
    // Maximizing uses the Windows work area, so the taskbar remains visible.
    await tryWindowOperation('leave fullscreen', () => appWindow.setFullscreen(false), errors)
    await tryWindowOperation('leave simple fullscreen', () => appWindow.setSimpleFullscreen(false), errors)
    await tryWindowOperation('restore frameless decorations state', () => appWindow.setDecorations(false), errors)
    await tryWindowOperation('enable resizing', () => appWindow.setResizable(true), errors)
    await tryWindowOperation('maximize window', () => appWindow.setMaximized(true), errors)
  } else {
    await tryWindowOperation('restore normal window state', () => appWindow.setMaximized(false), errors)
    await tryWindowOperation('enter fullscreen', () => appWindow.setFullscreen(true), errors)
  }

  const expectedOperations = mode === 'windowed' ? 5 : 2
  if (errors.length === expectedOperations) {
    throw new Error(errors.join('; '))
  }
}
