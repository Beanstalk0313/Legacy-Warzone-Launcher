import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    // Disable asset inlining — every file (even small MP3s) is emitted
    // as a separate file so new Audio() loads them via normal HTTP.
    // Data-URL inlining breaks in Tauri's custom-protocol WebView.
    assetsInlineLimit: 0,
    rollupOptions: {
      output: {
        // Predictable asset filenames (no content hash) so the app can
        // resolve them from the filesystem at runtime — users can swap
        // files in the installed assets/ folder to mod sounds and images.
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
})