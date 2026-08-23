import { check } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'
import { isTauriRuntime } from './jupiterRtm'

// Auto-updater glue for the desktop app (Tauri only — browser dev has no
// updater). The app checks the configured GitHub-releases endpoint on every
// startup (see main.jsx); when a newer version exists, UpdateModal offers
// Download & Install → downloadAndInstall() pulls the signed NSIS installer
// and relaunch() restarts into the new version.
//
// Release/signing setup lives in the README's "Auto-update" section
// (generate the signing key, put the PUBLIC key + repo endpoint into
// src-tauri/tauri.conf.json, and publish releases via the
// .github/workflows/release.yml workflow).

// Returns the Update object when a newer version is available, else null.
// Never throws — a missing/placeholder endpoint, no release yet, or being
// offline all resolve to null so startup is never blocked by the updater.
export async function checkForUpdates() {
  if (!isTauriRuntime()) return null
  try {
    return await check()
  } catch (error) {
    console.warn('[updater] update check failed', error)
    return null
  }
}

// Download + install the pending update, then restart the app. `onEvent` is
// the updater's progress callback (Started / Progress / Finished events) used
// by the modal to show download progress. On Windows the app is exited
// automatically during the install step; relaunch() restarts it afterwards.
export async function installUpdate(update, onEvent) {
  await update.downloadAndInstall(onEvent)
  await relaunch()
}
