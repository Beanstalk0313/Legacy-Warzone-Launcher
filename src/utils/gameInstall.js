import { useCallback, useEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { isTauriRuntime } from './jupiterRtm'

// Frontend glue for the Jupiter game install / launch feature. The heavy
// lifting lives in the Rust command `install_jupiter_game` (see
// src-tauri/src/game_install.rs): it authenticates with GoFile, streams the
// archive with a real progress bar, extracts it natively in Rust (unrar
// crate), and runs the game's install.bat. The launcher's LAUNCH button runs
// startgame.bat in the same folder.
//
// The Rust side pushes `game-install-progress` events with a SINGLE combined
// 0–100 percent across the whole download + extract phases; the two button
// surfaces (Jupiter Play menu card + Options GAME panel) render that one bar.

/**
 * Kick off the Jupiter game install into `installPath`.
 *
 * `onProgress` is called with { phase, percent, message } as the Rust side
 * emits progress (phase: 'auth'|'download'|'extract'|'finalize'|'done'|
 * 'cancelled'). Resolves when the install finishes, rejects on error.
 *
 * Browser dev has no Rust backend — this is a desktop-only action.
 */
export async function installJupiterGame(installPath, onProgress) {
  if (!isTauriRuntime()) {
    throw new Error('Game install is only available in the desktop launcher.')
  }
  if (!installPath || !installPath.trim()) {
    throw new Error('Enter a folder to install the game into first.')
  }

  // Subscribe for the duration of this install, then clean up.
  const unlisten = await listen('game-install-progress', (event) => {
    onProgress?.(event.payload)
  })
  try {
    await invoke('install_jupiter_game', { installDir: installPath.trim() })
  } finally {
    // `await unlisten` so slow listeners don't keep the sub dropped early.
    await unlisten()
  }
}

/**
 * Launch the installed game by running its startgame.bat. Non-blocking.
 */
export async function launchJupiterGame(installPath) {
  if (!isTauriRuntime()) return
  if (!installPath || !installPath.trim()) {
    throw new Error('No game install folder is set.')
  }
  await invoke('launch_jupiter_game', { installDir: installPath.trim() })
}

/**
 * Ask the backend whether the game is ready to launch at `installPath`
 * (i.e. a startgame.bat exists there). Returns { path, installed }.
 */
export async function getGameInstallStatus(installPath) {
  if (!isTauriRuntime() || !installPath || !installPath.trim()) {
    return { path: installPath || '', installed: false }
  }
  try {
    return await invoke('game_install_status', { installDir: installPath.trim() })
  } catch {
    return { path: installPath || '', installed: false }
  }
}

/**
 * Ask the backend to abort the in-flight install. The partial download is
 * kept so a later install resumes from where it stopped.
 */
export async function cancelGameInstall() {
  if (!isTauriRuntime()) return
  try {
    await invoke('cancel_game_install')
  } catch {
    // Nothing else to do — the install loop will notice on its next tick.
  }
}

/**
 * Delete the installed game at `installPath` (the entire folder).
 */
export async function uninstallJupiterGame(installPath) {
  if (!isTauriRuntime()) return
  if (!installPath || !installPath.trim()) {
    throw new Error('No game install folder is set.')
  }
  await invoke('uninstall_jupiter_game', { installDir: installPath.trim() })
}

/**
 * React hook giving a component the full Jupiter install lifecycle for the
 * current `installPath` (usually from `settings.game_install_path`).
 *
 *   installed  — true once startgame.bat exists at the path (refreshed after
 *                an install finishes and when the path changes)
 *   busy       — an install is currently running in this component
 *   percent    — combined 0–100 download+extract progress while busy
 *   phase      — 'auth'|'download'|'extract'|'finalize'|'done'|'' during install
 *   start()    — begin the install (no-op if busy or no path)
 *   launch()   — run startgame.bat (no-op if not installed/busy)
 *   uninstall() — delete the game install folder and refresh status
 */
export function useGameInstall(installPath) {
  const [installed, setInstalled] = useState(false)
  const [busy, setBusy] = useState(false)
  const [percent, setPercent] = useState(0)
  const [phase, setPhase] = useState('')

  // Use a ref for `installed` so async callbacks always read/write the latest
  // value without closure staleness.
  const installedRef = useRef(false)
  const setInstalledState = useCallback((value) => {
    installedRef.current = value
    setInstalled(value)
  }, [])

  // Check whether the game is installed at the given path (or current path).
  // Returns the boolean result for convenience.
  const checkInstalled = useCallback(async (targetPath) => {
    const resolvedPath = (targetPath || installPath || '').trim()
    if (!resolvedPath) {
      setInstalledState(false)
      return false
    }
    const status = await getGameInstallStatus(resolvedPath)
    setInstalledState(Boolean(status.installed))
    return Boolean(status.installed)
  }, [installPath, setInstalledState])

  // Re-check whenever the install path setting changes (e.g. user typed a
  // new path in the Options tab). The old `installed` state is reset to false
  // immediately so the card doesn't show a stale "Launch Game" from a
  // previous path.
  useEffect(() => {
    setInstalledState(false)
    void checkInstalled()
  }, [installPath, checkInstalled, setInstalledState])

  const busyRef = useRef(false)

  // `start` accepts an optional path override so a modal that typed a fresh
  // path doesn't hit the hook's stale captured path.
  const start = useCallback(async (overridePath) => {
    const targetPath = (overridePath || installPath || '').trim()
    if (busyRef.current || !targetPath) return
    busyRef.current = true
    setBusy(true)
    setPercent(0)
    setPhase('auth')
    try {
      // The event listener for progress events. We capture `targetPath` in a
      // local const so even if the component re-renders with a new path while
      // the install runs, the 'done' handler always re-checks THE SAME path
      // that was actually installed to.
      const installPath_local = targetPath

      await installJupiterGame(targetPath, (progress) => {
        const eventPhase = progress?.phase || ''
        setPercent(Number(progress?.percent) || 0)
        setPhase(eventPhase)
        if (eventPhase === 'done') {
          setBusy(false)
          // Re-check the exact path we installed to. Use a short delay so the
          // file system has time to flush after the Rust side finished.
          setTimeout(() => {
            void checkInstalled(installPath_local)
          }, 200)
        } else if (eventPhase === 'cancelled') {
          setBusy(false)
        } else {
          setBusy(true)
        }
      })

      // The invoke resolved — the Rust side finished (either done or error).
      setPhase('')
      // Re-check install status one final time to be absolutely sure.
      await checkInstalled(targetPath)
    } catch (error) {
      // Let the caller surface an error toast/modal; reset the busy flag.
      throw error
    } finally {
      busyRef.current = false
      setBusy(false)
    }
  }, [installPath, checkInstalled])

  const cancel = useCallback(() => {
    void cancelGameInstall()
  }, [])

  const launch = useCallback(async (overridePath) => {
    const targetPath = (overridePath || installPath || '').trim()
    if (!targetPath) return
    await launchJupiterGame(targetPath)
  }, [installPath])

  const uninstall = useCallback(async () => {
    const targetPath = (installPath || '').trim()
    if (!targetPath) return
    await uninstallJupiterGame(targetPath)
    // Re-check after uninstall to update the card.
    await checkInstalled()
  }, [installPath, checkInstalled])

  // Expose a synchronous-looking re-check so callers (e.g. the install modal)
  // can force the hook to re-evaluate after they know the path is valid.
  const checkStatus = useCallback(async () => {
    return await checkInstalled()
  }, [checkInstalled])

  return { installed, busy, percent, phase, start, cancel, launch, uninstall, checkStatus }
}
