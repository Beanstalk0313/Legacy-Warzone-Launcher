import React, { useEffect, useState } from 'react'
import { playSound } from '../utils/audio'
import { useAuth } from './AuthProvider'
import { useTranslation } from '../utils/i18n'

// Theme-aware toast that warns the user friends + parties are locked until they
// sign in. Mounted by the two interface containers (IW8Interface,
// JupiterInterface). Sits in the top-right of the viewport via position:
// fixed so it doesn't fight the layout or the entrance/exit animations on
// the parent container — it overlays them.
//
// Behavior summary:
//   - Won't render at all when Supabase isn't configured (.env empty): the
//     Sign In button would just throw.
//   - Won't render while `entranceActive` is true (the launcher → mod
//     expansion-into-bg and the mod → launcher collapse). The interface
//     containers pass `isEntering || isLeaving` here. The point is that
//     `.mod-stage.is-entering` has `pointer-events: none` for its full
//     1100 ms window — so a fixed-position child would still *appear*
//     during that window but be uninteractive. Gating on entranceActive
//     ensures the toast is fully clickable the moment it lands.
//   - Slides in from the right with the project's standard
//     `cubic-bezier(0.16, 1, 0.3, 1)` curve ~200 ms after entranceActive
//     clears. Auto-dismisses after 8 s.
//   - Manual × dismisses immediately AND prevents re-show within the
//     same interface mount (current-session reflection of the user's
//     intent). Re-shows on every fresh interface mount unless the
//     localStorage flag below is set.
//   - "Don't show this message again" sets a localStorage flag that
//     persists across app launches. Once set, the notice NEVER shows
//     again — including after the user signs out and back in. Useful for
//     users who explicitly accept the locked-feature limitation for the
//     current run.
//   - Hides the moment `useAuth().user` becomes non-null — covers both
//     sign-ins via this notice's Sign In button AND any other path
//     (e.g., the smoke-test snippet pasted into Launcher).
//
// Sign In button:
//   Previously this button auto-launched the Discord OAuth flow. That
//   felt pushy — it forced a provider choice on the user without giving
//   them a chance to pick the one they wanted (Google, magic-link email).
//   It now just routes the user to the Account tab via the parent's
//   `onSwitchToAccount` callback. The user picks the provider they
//   prefer there. Same audio feedback so it doesn't feel silent.

const AUTO_DISMISS_MS = 8000
const POST_ENTRANCE_DELAY_MS = 200
// Project-scoped key so re-using this toast in another app wouldn't
// accidentally share state.
const SUPPRESS_KEY = 'warzone-lfg-tool-auth-notice-suppressed'
const SUPPRESS_VALUE = '1'

function readSuppressPreference() {
  // Tauri webview localStorage persists across launches on Windows (each
  // app gets its own OS-level appdata directory). Wrap in try/catch
  // because Safari (and some private-browsing modes) throw on `setItem`
  // when storage quota is exceeded or disabled entirely.
  try {
    if (typeof window === 'undefined' || !window.localStorage) return false
    return window.localStorage.getItem(SUPPRESS_KEY) === SUPPRESS_VALUE
  } catch {
    return false
  }
}

// Session-scoped dismissal: once the user clicks × we never resurface the
// toast for the rest of THIS app run — even across interface mounts (Return
// Home → re-enter a mod used to re-pop it every time, which felt buggy).
// Only a full app restart resets it.
let sessionDismissed = false

function writeSuppressPreference(suppress) {
  try {
    if (typeof window === 'undefined' || !window.localStorage) return
    if (suppress) {
      window.localStorage.setItem(SUPPRESS_KEY, SUPPRESS_VALUE)
    } else {
      window.localStorage.removeItem(SUPPRESS_KEY)
    }
  } catch {
    // best-effort — if storage is unavailable we just lose the
    // persistence and the user can re-dismiss on next launch.
  }
}

export default function AuthRequiredNotice({ theme = 'iw8', entranceActive = false, onSwitchToAccount }) {
  const { user, configured } = useAuth()
  const { t } = useTranslation()
  const [visible, setVisible] = useState(false)
  // Persisted flag: once the user clicks "Don't show this message again"
  // we set localStorage and the toast never appears again on this device.
  const [persistentlySuppressed, setPersistentlySuppressed] = useState(() => readSuppressPreference())

  // Theme-aware feedback SFX. Same pattern as IW8/JupiterInterface's other
  // interactive widgets — the notice shouldn't feel silent.
  const isJupiter = theme === 'jupiter'
  const selectSound = isJupiter ? 'jupSelect' : 'iw8Select'

  useEffect(() => {
    // Gate conditions: any of these keeps the toast hidden.
    //   - Supabase isn't configured → toast is useless (button would error)
    //   - User is signed in → toast is irrelevant (features are unlocked)
    //   - An entrance/exit animation is still running → avoid both
    //     pointer-events: none collisions AND visual fight with the
    //     keyframed header/card motion
    //   - User already dismissed it (session-scoped) → respect their choice
    //   - User previously clicked "Don't show this message again" →
    //     honor the persistent flag
    if (!configured || user || entranceActive || sessionDismissed || persistentlySuppressed) {
      setVisible(false)
      return
    }
    const appearTimer = window.setTimeout(() => setVisible(true), POST_ENTRANCE_DELAY_MS)
    const hideTimer = window.setTimeout(() => setVisible(false), AUTO_DISMISS_MS)
    return () => {
      window.clearTimeout(appearTimer)
      window.clearTimeout(hideTimer)
    }
  }, [configured, user, entranceActive, persistentlySuppressed])

  // If the user signs in mid-display (via any callback path — the Social
  // tab CTA, the Account buttons, etc.), dismiss immediately. The effect
  // above already keeps visible=false whenever `user` is truthy on the
  // next re-run, but that re-run only fires the *frame* after the user
  // object swap. Setting it inline here gives instant UI feedback
  // between the two frames.
  useEffect(() => {
    if (user) setVisible(false)
  }, [user])

  if (!visible) return null

  const variantClass = theme === 'jupiter' ? 'jupiter-auth-notice' : 'iw8-auth-notice'

  // Send the user to the Account tab and let them pick the provider they
  // actually want (Discord, Google, or magic-link email). Play the theme's
  // select sound for click feedback so the toast doesn't feel silent in
  // an otherwise noisy interface.
  const handleSignIn = () => {
    playSound(selectSound)
    setVisible(false)
    if (typeof onSwitchToAccount === 'function') onSwitchToAccount()
  }

  const handleDismissThisSession = () => {
    sessionDismissed = true
    setVisible(false)
  }

  const handleSuppressPermanently = () => {
    writeSuppressPreference(true)
    setPersistentlySuppressed(true)
    setVisible(false)
  }

  return (
    <div
      className={`auth-required-notice ${variantClass}`}
      role="status"
      aria-live="polite"
    >
      <div className="auth-required-notice-icon" aria-hidden="true">
        {/* Lock glyph — communicates "access gated" without requiring the
            user to read the text first. Pure SVG so no extra asset. */}
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="4" y="11" width="16" height="10" rx="1.5" />
          <path d="M8 11V8a4 4 0 0 1 8 0v3" />
          <circle cx="12" cy="16" r="1.2" fill="currentColor" stroke="none" />
        </svg>
      </div>
      <div className="auth-required-notice-body">
        <div className="auth-required-notice-title">{t('authnotice.title')}</div>
        <div className="auth-required-notice-message">
          {t('authnotice.msg')}
        </div>
      </div>
      <div className="auth-required-notice-actions">
        <button
          type="button"
          className="auth-required-notice-signin"
          onClick={handleSignIn}
        >
          {t('authnotice.signin')}
        </button>
        <button
          type="button"
          className="auth-required-notice-suppress"
          onClick={handleSuppressPermanently}
        >
          {t('authnotice.dontshow')}
        </button>
        <button
          type="button"
          className="auth-required-notice-dismiss"
          aria-label="Dismiss notice"
          onClick={handleDismissThisSession}
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
    </div>
  )
}
