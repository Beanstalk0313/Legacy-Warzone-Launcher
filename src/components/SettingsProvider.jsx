import React, { createContext, useContext, useEffect, useRef, useState } from 'react'
import { loadSettings, saveSettings, DEFAULT_SETTINGS } from '../utils/settings'
import { setSoundOverride, setSilentMode } from '../utils/audio'
import { applyDisplayMode, applyDisplayMonitor } from '../utils/displayMode'

const SettingsContext = createContext(null)

/**
 * Apply user-customized accent colors to the CSS root element, overriding
 * the defaults defined in `:root` in styles.css. A hex string (#rrggbb) is
 * validated upstream (settings normalization); here we just write the custom
 * properties and derive a lighter hover variant by bumping the red/green/blue
 * channels by 20%.
 */
function applyAccents(accentJupiter, accentIw8) {
  const root = document.documentElement
  if (accentJupiter) {
    root.style.setProperty('--jupiter-accent', accentJupiter)
    root.style.setProperty('--jupiter-accent-hover', lightenHex(accentJupiter, 0.2))
  }
  if (accentIw8) {
    root.style.setProperty('--iw8-red-accent', accentIw8)
  }
}

function lightenHex(hex, amount) {
  try {
    const r = parseInt(hex.slice(1, 3), 16)
    const g = parseInt(hex.slice(3, 5), 16)
    const b = parseInt(hex.slice(5, 7), 16)
    const nr = Math.min(255, Math.round(r + (255 - r) * amount))
    const ng = Math.min(255, Math.round(g + (255 - g) * amount))
    const nb = Math.min(255, Math.round(b + (255 - b) * amount))
    return `#${nr.toString(16).padStart(2, '0')}${ng.toString(16).padStart(2, '0')}${nb.toString(16).padStart(2, '0')}`
  } catch {
    return hex
  }
}

/**
 * Global launcher settings. Loaded once at startup from
 * Documents\retdonetskmod\settings.json (the file is read then released —
 * nothing holds it open). The values captured at load are kept as the
 * "reset" baseline, so a manually swapped-in settings_default.json (renamed
 * over settings.json) is honored when the user hits Reset to Defaults.
 *
 * `setSetting(key, value)` saves immediately; changing `dynamic_sounds`
 * also rewires every playSound() cue via setSoundOverride(), while
 * `display_mode` is applied to the current Tauri window.
 */
export default function SettingsProvider({ children }) {
  const [settings, setSettings] = useState(null) // null until the startup load settles
  // Mirrors of the latest settings + the startup snapshot (the reset
  // baseline). Kept in refs so setSetting/resetSettings can compute the next
  // value OUTSIDE the state updater — React requires updaters to be pure,
  // and StrictMode double-invokes them in dev (which would double-save).
  const settingsRef = useRef({ ...DEFAULT_SETTINGS })
  const defaultsRef = useRef({ ...DEFAULT_SETTINGS })

  useEffect(() => {
    let mounted = true
    ;(async () => {
      const loaded = await loadSettings()
      if (!mounted) return
      settingsRef.current = { ...loaded }
      defaultsRef.current = { ...loaded }
      setSettings(loaded)
      setSoundOverride(loaded.dynamic_sounds)
      setSilentMode(loaded.silent_mode)
      applyAccents(loaded.accent_jupiter, loaded.accent_iw8)

      // Monitor first, then the display mode: the monitor move clears
      // fullscreen, so the mode re-apply is what actually fills the
      // chosen display.
      void applyDisplayMonitor(loaded.display_monitor)
        .then(() => applyDisplayMode(loaded.display_mode))
        .catch((error) => {
          console.warn('[display] startup apply failed', error)
        })
    })()
    return () => {
      mounted = false
    }
  }, [])

  const setSetting = (key, value) => {
    const next = { ...settingsRef.current, [key]: value }
    settingsRef.current = next
    setSettings(next)
    void saveSettings(next)
    if (key === 'dynamic_sounds') setSoundOverride(value)
    if (key === 'silent_mode') setSilentMode(value)
    if (key === 'accent_jupiter' || key === 'accent_iw8') {
      applyAccents(next.accent_jupiter, next.accent_iw8)
    }
    if (key === 'display_monitor' || key === 'display_mode') {
      const monitor = key === 'display_monitor' ? value : settingsRef.current.display_monitor
      // Same order as startup: land the monitor, then apply the mode.
      void applyDisplayMonitor(monitor)
        .then(() => applyDisplayMode(settingsRef.current.display_mode))
        .catch((error) => {
          console.warn('[display] change failed', error)
        })
    }
  }

  const resetSettings = () => {
    const defaults = defaultsRef.current
    settingsRef.current = { ...defaults }
    setSettings(defaults)
    void saveSettings(defaults)
    setSoundOverride(defaults.dynamic_sounds)
    setSilentMode(defaults.silent_mode)
    applyAccents(defaults.accent_jupiter, defaults.accent_iw8)
    void applyDisplayMonitor(defaults.display_monitor)
      .then(() => applyDisplayMode(defaults.display_mode))
      .catch((error) => {
        console.warn('[display] reset failed', error)
      })
  }

  // Snapshot of the startup settings (the reset baseline). Exposed so the
  // Options tab can peek at what a Reset WOULD do before committing — e.g.
  // to confirm first when the reset would swap the interface shell.
  const getResetDefaults = () => ({ ...defaultsRef.current })

  return (
    <SettingsContext.Provider
      value={{ settings, loaded: settings !== null, setSetting, resetSettings, getResetDefaults }}
    >
      {children}
    </SettingsContext.Provider>
  )
}

export function useSettings() {
  const context = useContext(SettingsContext)
  if (!context) throw new Error('useSettings must be used inside SettingsProvider')
  return context
}
