import React from 'react'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useSettings } from './SettingsProvider'

export default function WindowControls() {
  const { settings, loaded } = useSettings()

  if (!loaded || settings?.display_mode !== 'windowed' || !window.__TAURI_INTERNALS__) {
    return null
  }

  const appWindow = getCurrentWindow()
  const handleMinimize = async () => {
    try {
      // Use the Rust command so this keeps working even when an installed
      // binary was built without the WebView minimize permission.
      await invoke('minimize_window')
    } catch (error) {
      console.warn('[window] native minimize failed; using window API fallback', error)
      try {
        await appWindow.minimize()
      } catch (fallbackError) {
        console.warn('[window] minimize failed', fallbackError)
      }
    }
  }

  const handleClose = async () => {
    // Route the X through the window's close-request event: main.jsx's
    // listener preventDefaults it and opens the shared "Quit to Desktop?"
    // modal — the confirmed quit (cleanup + `exit_app`) runs from there.
    try {
      await appWindow.close()
    } catch (error) {
      console.warn('[window] close request failed', error)
    }
  }

  return (
    <div className="window-controls" aria-label="Window controls">
      <button
        type="button"
        className="window-control-btn window-control-minimize"
        aria-label="Minimize window"
        title="Minimize"
        onClick={() => void handleMinimize()}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M3 8h10" />
        </svg>
      </button>
      <button
        type="button"
        className="window-control-btn window-control-close"
        aria-label="Close window"
        title="Close"
        onClick={() => void handleClose()}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="M4 4l8 8M12 4l-8 8" />
        </svg>
      </button>
    </div>
  )
}
