// Opens an external URL in the user's OS default browser.
//
// - Inside the Tauri shell, dispatch to the opener plugin so the click goes to
//   the OS shell (handles permissions, never silently no-ops).
// - In `npm run dev` (plain browser via Vite), fall back to `window.open`. This
//   keeps Discord/forum/etc. links usable while iterating on the UI without a
//   Rust rebuild.
//
// Either path is fire-and-forget: errors are swallowed because the user-facing
// UX is "the link either opens or it doesn't" -- we never want a thrown promise
// here to bubble up to a console error noise.

export async function openExternal(url) {
  if (!url) return

  try {
    if (window.__TAURI_INTERNALS__ || window.__TAURI__) {
      const { openUrl } = await import('@tauri-apps/plugin-opener')
      await openUrl(url)
      return
    }
  } catch (_) {
    // fall through to window.open
  }

  try {
    window.open(url, '_blank', 'noopener,noreferrer')
  } catch (_) {
    // last-resort no-op
  }
}
