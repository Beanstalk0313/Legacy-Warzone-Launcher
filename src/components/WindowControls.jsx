import React from 'react'
import { invoke } from '@tauri-apps/api/core'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useAuth } from './AuthProvider'
import { useSettings } from './SettingsProvider'
import { destroyAppWithServerCleanup } from '../utils/serverPresence'

export default function WindowControls() {
  const { settings, loaded } = useSettings()
  const { user } = useAuth()

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
    // Reuse the same cleanup-aware path as the themed Quit confirmation.
    // Calling appWindow.close() directly can race the close-requested
    // listener; this path deletes owned servers and parties before exiting.
    await destroyAppWithServerCleanup(user?.id)
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
