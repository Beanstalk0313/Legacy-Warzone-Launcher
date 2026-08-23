/**
 * Asset resolver — currently unused (audio uses Vite imports directly
 * because convertFileSrc URLs don't work with new Audio() in Tauri's
 * WebView). Kept as a placeholder for future image modding support.
 */

export function initAssetResolver() {
  return Promise.resolve()
}
