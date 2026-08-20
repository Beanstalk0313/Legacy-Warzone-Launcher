// Singleton Supabase client used by the React side. Values are pinned at build
// time from `import.meta.env.VITE_*` — Vite inlines the env vars into the bundle
// when the project is built, so a restart (or rebuild) is required after editing
// the local .env file.

import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// True when both env vars are populated. AuthProvider uses this flag to switch
// between "ready to sign in" and "not yet configured" UI states without
// crashing on a half-set .env.
export const SUPABASE_CONFIGURED = Boolean(url && anonKey)

// Email/password auth with persisted sessions. Tauri sandboxing is more
// lenient than a browser (the webview's localStorage survives across app
// restarts because the OS-level appdata directory persists), so the standard
// browser strategy of "store tokens in localStorage" works here without
// modification.
export const supabase = SUPABASE_CONFIGURED
  ? createClient(url, anonKey, {
      auth: {
        // Don't try to detect sessions from URL fragments — this is a
        // desktop app, not a browser. Without this, Supabase may redirect
        // to localhost:3000 after signup/signin.
        detectSessionInUrl: false,
        persistSession: true,
        autoRefreshToken: true,
      },
    })
  : null
