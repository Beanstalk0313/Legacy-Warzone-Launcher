import React, { createContext, useContext, useEffect, useRef, useState } from 'react'
import { loadSettings, saveSettings, DEFAULT_SETTINGS } from '../utils/settings'
import { setSoundOverride } from '../utils/audio'
import { applyDisplayMode } from '../utils/displayMode'

const SettingsContext = createContext(null)

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
      void applyDisplayMode(loaded.display_mode).catch((error) => {
        console.warn('[display-mode] startup apply failed', error)
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
    if (key === 'display_mode') {
      void applyDisplayMode(value).catch((error) => {
        console.warn('[display-mode] change failed', error)
      })
    }
  }

  const resetSettings = () => {
    const defaults = defaultsRef.current
    settingsRef.current = { ...defaults }
    setSettings(defaults)
    void saveSettings(defaults)
    setSoundOverride(defaults.dynamic_sounds)
    void applyDisplayMode(defaults.display_mode).catch((error) => {
      console.warn('[display-mode] reset failed', error)
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
