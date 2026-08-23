import React, { useEffect, useState } from 'react'
import { playSound } from '../utils/audio'
import { useAuth } from './AuthProvider'
import { getDisplayName } from '../utils/displayName'
import { useControllerNavigation } from '../utils/controller'
import { supabase, SUPABASE_CONFIGURED } from '../lib/supabase'
import { saveUserIdentity } from '../utils/userIdentity'

// Account tab — email + password auth with gamertag.
//
// Two modes:
//   "signin"  – email + password
//   "signup"  – email + password + Discord username + gamertag + confirm password
//
// When signed in, displays a card with the user's email, Discord username,
// gamertag, and a sign-out button.
//
// Theme-aware: receives `theme="iw8" | "jupiter"` and adds the matching
// modifier class so CSS variants can retune colors, corners, and hover
// styles without forking the component.

const USERNAME_PATTERN = /^[A-Za-z0-9_.]{3,20}$/

// Region options — same vocabulary the home-screen player-card flags render.
const REGION_OPTIONS = [
  'North America',
  'South America',
  'Europe',
  'Asia Pacific',
  'Middle East',
  'Oceania',
]

function validateGamertag(value) {
  const trimmed = (value || '').trim()
  if (!trimmed) return 'Pick a gamertag (3-20 chars, letters/numbers/underscore/dot).'
  if (!USERNAME_PATTERN.test(trimmed)) {
    return '3-20 characters; letters, numbers, underscore, dot only.'
  }
  return null
}

function validateDiscordUsername(value) {
  const trimmed = (value || '').trim()
  if (!trimmed) return 'Discord username is required during the open beta.'
  if (trimmed.length > 32) return 'Enter your complete Discord username (32 characters max).'
  return null
}

function validateEmail(value) {
  if (!value) return 'Email is required.'
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return 'Enter a valid email address.'
  return null
}

function validatePassword(value) {
  if (!value) return 'Password is required.'
  if (value.length < 6) return 'Password must be at least 6 characters.'
  return null
}

export default function AccountTab({ theme = 'iw8', onIdentitySaved }) {
  const { user, configured, signUp, signIn, signOut } = useAuth()

  const isJupiter = theme === 'jupiter'
  const hoverSound = isJupiter ? 'jupHover' : 'iw8Hover'
  const selectSound = isJupiter ? 'jupSelect' : 'iw8Select'
  const [inputMode, setInputMode] = useState('mouse')

  // ── Form state ──────────────────────────────────────────────────────────
  const [mode, setMode] = useState('signin') // 'signin' | 'signup'
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [discordUsername, setDiscordUsername] = useState('')
  const [gamertag, setGamertag] = useState('')
  const [signInError, setSignInError] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [successMessage, setSuccessMessage] = useState(null)
  // Touched-state: don't show inline hints until the user tries to submit
  const [touched, setTouched] = useState(false)
  // The user's region (stored on public.profiles; shown as a flag on the
  // home-screen player cards). Null until the profile row is loaded.
  const [profileRegion, setProfileRegion] = useState(null)
  const [regionSaving, setRegionSaving] = useState(false)

  // ── Load the signed-in user's region from their profile row ─────────────
  useEffect(() => {
    if (!user?.id || !SUPABASE_CONFIGURED || !supabase) return
    let mounted = true
    ;(async () => {
      try {
        const { data } = await supabase
          .from('profiles')
          .select('region')
          .eq('user_id', user.id)
          .single()
        if (mounted) setProfileRegion(data?.region || '')
      } catch (regionError) {
        console.warn('[account] could not load region', regionError)
      }
    })()
    return () => { mounted = false }
  }, [user?.id])

  // Keep the desktop identity snapshot aligned with the active Supabase
  // session. Browser mode intentionally skips the Windows file helper.
  useEffect(() => {
    if (!user?.id) return undefined
    const metadata = user.user_metadata || {}
    const identity = {
      discord_username: typeof metadata.discord_username === 'string' ? metadata.discord_username.trim() : '',
      gamertag: typeof metadata.gamertag === 'string' ? metadata.gamertag.trim() : '',
      email: user.email || '',
    }
    if (!identity.discord_username || !identity.gamertag || !identity.email) return undefined

    let active = true
    saveUserIdentity(identity)
      .then(() => {
        if (active) onIdentitySaved?.(identity)
      })
      .catch((identityError) => {
        if (active) console.warn('[account] could not save the device identity file', identityError)
      })
    return () => { active = false }
  }, [user?.id, user?.email, user?.user_metadata, onIdentitySaved])

  const handleRegionChange = async (event) => {
    const value = event.target.value
    setProfileRegion(value)
    if (!user?.id || !SUPABASE_CONFIGURED || !supabase) return
    setRegionSaving(true)
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ region: value || null })
        .eq('user_id', user.id)
      if (error) throw error
    } catch (regionError) {
      console.warn('[account] could not save region', regionError)
      setSignInError(regionError?.message || 'Could not save region.')
    } finally {
      setRegionSaving(false)
    }
  }

  // ── Switch mode ─────────────────────────────────────────────────────────
  const switchMode = (newMode) => {
    playSound(hoverSound)
    setMode(newMode)
    setSignInError(null)
    setSuccessMessage(null)
    setTouched(false)
  }

  // ── Submit handler ──────────────────────────────────────────────────────
  const handleSubmit = async (event) => {
    event.preventDefault()
    setTouched(true)
    setSignInError(null)
    setSuccessMessage(null)

    // Validate email + password (both modes)
    const emailErr = validateEmail(email)
    if (emailErr) { setSignInError(emailErr); return }
    const passwordErr = validatePassword(password)
    if (passwordErr) { setSignInError(passwordErr); return }

    if (mode === 'signup') {
      // Discord identity is mandatory during the open beta.
      const discordUsernameErr = validateDiscordUsername(discordUsername)
      if (discordUsernameErr) { setSignInError(discordUsernameErr); return }
      // Validate gamertag
      const gamertagErr = validateGamertag(gamertag)
      if (gamertagErr) { setSignInError(gamertagErr); return }
      // Validate confirm password
      if (password !== confirmPassword) {
        setSignInError('Passwords do not match.')
        return
      }
    }

    playSound(selectSound)
    setSubmitting(true)

    try {
      if (mode === 'signup') {
        const identity = {
          discord_username: discordUsername.trim(),
          gamertag: gamertag.trim(),
          email: email.trim(),
        }
        await signUp(email.trim(), password, identity.gamertag, identity.discord_username)
        await saveUserIdentity(identity)
        onIdentitySaved?.(identity)
        setSuccessMessage(
          `Please verify your email address using the confirmation link sent to ${identity.email}. After verification, return to the launcher and sign in.`
        )
      } else {
        const data = await signIn(email.trim(), password)
        const signedInUser = data?.user
        const metadata = signedInUser?.user_metadata || {}
        const identity = {
          discord_username: typeof metadata.discord_username === 'string' ? metadata.discord_username.trim() : '',
          gamertag: typeof metadata.gamertag === 'string' ? metadata.gamertag.trim() : '',
          email: signedInUser?.email || email.trim(),
        }
        if (!identity.discord_username) {
          throw new Error('This account has no Discord username. Open-beta accounts must provide the complete username, such as beanstalk313_16060, not a display name.')
        }
        if (!identity.gamertag) {
          throw new Error('This account has no gamertag metadata. Please contact the launcher administrator.')
        }
        await saveUserIdentity(identity)
        onIdentitySaved?.(identity)
      }
    } catch (err) {
      setSignInError(err?.message || 'Something went wrong.')
    } finally {
      setSubmitting(false)
    }
  }

  // ── Sign out ────────────────────────────────────────────────────────────
  const handleSignOut = async () => {
    playSound(selectSound)
    try {
      await signOut()
      // Deliberately NOT clearing the device identity file: the local
      // identity file is the DEVICE identity behind the ban system (block
      // the PC, not just the account). Deleting it on sign-out would let
      // anyone erase the device ban by signing out, then signing up fresh.
      // The file is only ever rewritten by the next sign-in AFTER the
      // pre-sign-in ban check.
    } catch {
      // signOut errors are non-critical; the session will expire
    }
  }

  // ── Controller navigation for form actions ──────────────────────────────
  // Two items: toggle mode button + submit button
  const formActions = ['toggle', 'submit']
  const focusedIndex = useControllerNavigation({
    itemCount: formActions.length,
    allowedDirections: ['up', 'down'],
    onControllerActivity: () => setInputMode('controller'),
    onMove: () => {
      setInputMode('controller')
      playSound(hoverSound)
    },
    onConfirm: (index, source) => {
      setInputMode(source === 'gamepad' ? 'controller' : 'mouse')
      const action = formActions[index]
      if (action === 'toggle') switchMode(mode === 'signin' ? 'signup' : 'signin')
      else if (action === 'submit') handleSubmit({ preventDefault: () => {} })
    },
  })

  const isFocused = (action) => inputMode === 'controller' && formActions[focusedIndex] === action

  // ══════════════════════════════════════════════════════════════════════════
  // SIGNED-IN VIEW
  // ══════════════════════════════════════════════════════════════════════════
  if (user) {
    const userEmail = user.email || ''
    const metadata = user.user_metadata || {}
    const displayName = getDisplayName(user)
    const memberSince = user.created_at
      ? new Date(user.created_at).toLocaleDateString()
      : '—'

    return (
      <div className={`tab-content-panel ${isJupiter ? 'jupiter-theme' : 'iw8-theme'}`}>
        <div className="tab-header-title">
          <h2>ACCOUNT</h2>

        </div>
        {successMessage && (
          <div className={`account-email-sent account-email-verification-notice ${isJupiter ? 'jupiter-theme' : 'iw8-theme'}`}>
            <h3>Verify Your Email</h3>
            <p>{successMessage}</p>
          </div>
        )}
        <div className={`account-signed-in-card ${isJupiter ? 'jupiter-theme' : 'iw8-theme'}`}>
          <div className={`account-avatar ${isJupiter ? 'jupiter-theme' : 'iw8-theme'}`}>
            <span>{(displayName[0] || userEmail[0] || '?').toUpperCase()}</span>
          </div>
          <h3 className="account-display-name">{displayName}</h3>
          <ul className="account-meta">
            <li>
              <span>Email</span>
              <strong>{userEmail || '—'}</strong>
            </li>
            <li>
              <span>Discord Username</span>
              <strong>{metadata.discord_username || 'Missing'}</strong>
            </li>
            <li>
              <span>Gamertag</span>
              <strong>{metadata.gamertag || '—'}</strong>
            </li>
            <li>
              <span>Member since</span>
              <strong>{memberSince}</strong>
            </li>
          </ul>
          <label className="account-region-field">
            <span>Region</span>
            <select
              value={profileRegion || ''}
              onChange={handleRegionChange}
              disabled={regionSaving}
              onKeyDown={(event) => event.stopPropagation()}
            >
              <option value="">Not set</option>
              {REGION_OPTIONS.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
            <small>Shown as a flag on your home-screen player card.</small>
          </label>
          <button
            type="button"
            className={`account-signout-btn ${isJupiter ? 'jupiter-theme' : 'iw8-theme'}`}
            onClick={handleSignOut}
            onMouseEnter={() => playSound(hoverSound)}
          >
            Sign Out
          </button>
        </div>
      </div>
    )
  }

  // ══════════════════════════════════════════════════════════════════════════
  // SIGN-IN / SIGN-UP VIEW
  // ══════════════════════════════════════════════════════════════════════════
  const emailError = touched ? validateEmail(email) : null
  const passwordError = touched ? validatePassword(password) : null
  const discordUsernameError = touched && mode === 'signup' ? validateDiscordUsername(discordUsername) : null
  const gamertagError = touched && mode === 'signup' ? validateGamertag(gamertag) : null

  return (
    <div className={`tab-content-panel account-tab-panel ${isJupiter ? 'jupiter-theme' : 'iw8-theme'}`}>
      <div className="tab-header-title">
        <h2>ACCOUNT</h2>

      </div>

      {!configured && (
        <div className="account-not-configured-banner">
          <h4>Backend not configured</h4>
          <p>
            Add <code>VITE_SUPABASE_URL</code> and{' '}
            <code>VITE_SUPABASE_ANON_KEY</code> to <code>.env</code> then
            restart the app. See <code>SUPABASE_SETUP.md</code> for the
            walkthrough.
          </p>
        </div>
      )}

      {successMessage ? (
        <div className={`account-email-sent ${isJupiter ? 'jupiter-theme' : 'iw8-theme'}`}>
          <h3>Verify Your Email</h3>
          <p>{successMessage}</p>
          <button
            type="button"
            className={`account-email-submit ${isJupiter ? 'jupiter-theme' : 'iw8-theme'}`}
            onClick={() => {
              switchMode('signin')
              setEmail('')
              setPassword('')
            }}
            onMouseEnter={() => playSound(hoverSound)}
          >
            Back to Sign In
          </button>
        </div>
      ) : (
        <div className={`account-signin-card ${isJupiter ? 'jupiter-theme' : 'iw8-theme'}`}>
          <form onSubmit={handleSubmit} className="account-signin-email-form">
            {/* ── Mode toggle ─────────────────────────────────────── */}
            <div className="account-mode-toggle">
              <button
                type="button"
                className={`account-mode-btn ${mode === 'signin' ? 'active' : ''} ${isFocused('toggle') ? 'controller-focused' : ''} ${isJupiter ? 'jupiter-theme' : 'iw8-theme'}`}
                onClick={() => switchMode('signin')}
                onMouseEnter={() => playSound(hoverSound)}
                disabled={!configured}
              >
                Sign In
              </button>
              <button
                type="button"
                className={`account-mode-btn ${mode === 'signup' ? 'active' : ''} ${isJupiter ? 'jupiter-theme' : 'iw8-theme'}`}
                onClick={() => switchMode('signup')}
                onMouseEnter={() => playSound(hoverSound)}
                disabled={!configured}
              >
                Sign Up
              </button>
            </div>

            {mode === 'signup' && (
              <div className="account-beta-signup-notice">
                <strong>Open Beta Account</strong>
                <span>Your complete Discord username is required. Enter the username from your Discord account, not your display name.</span>
              </div>
            )}

            {/* ── Email ───────────────────────────────────────────── */}
            <label className="account-email-field">
              <span>Email</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                disabled={!configured || submitting}
                autoComplete="email"
                aria-invalid={emailError ? 'true' : 'false'}
                aria-describedby="account-email-hint"
              />
              <span id="account-email-hint" className={`account-field-hint ${emailError ? 'account-field-hint-error' : ''}`}>
                {emailError || ''}
              </span>
            </label>

            {/* ── Password ────────────────────────────────────────── */}
            <label className="account-email-field">
              <span>Password</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 6 characters"
                disabled={!configured || submitting}
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                aria-invalid={passwordError ? 'true' : 'false'}
                aria-describedby="account-password-hint"
              />
              <span id="account-password-hint" className={`account-field-hint ${passwordError ? 'account-field-hint-error' : ''}`}>
                {passwordError || ''}
              </span>
            </label>

            {/* ── Discord username (sign-up only) ────────────────── */}
            {mode === 'signup' && (
              <label className="account-discord-field">
                <span>Discord Username <em>Required</em></span>
                <input
                  type="text"
                  value={discordUsername}
                  onChange={(e) => setDiscordUsername(e.target.value)}
                  placeholder="e.g. beanstalk313_16060"
                  disabled={!configured || submitting}
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={32}
                  aria-invalid={discordUsernameError ? 'true' : 'false'}
                  aria-describedby="account-discord-hint"
                />
                <span id="account-discord-hint" className={`account-field-hint ${discordUsernameError ? 'account-field-hint-error' : ''}`}>
                  {discordUsernameError || 'Use your complete Discord username, not your display name.'}
                </span>
              </label>
            )}

            {/* ── Gamertag (sign-up only) ─────────────────────────── */}
            {mode === 'signup' && (
              <label className="account-username-field">
                <span>Gamertag</span>
                <input
                  type="text"
                  value={gamertag}
                  onChange={(e) => setGamertag(e.target.value)}
                  placeholder="e.g. beanstalk313"
                  disabled={!configured || submitting}
                  autoComplete="username"
                  spellCheck={false}
                  maxLength={20}
                  aria-invalid={gamertagError ? 'true' : 'false'}
                  aria-describedby="account-gamertag-hint"
                />
                <span id="account-gamertag-hint" className={`account-field-hint ${gamertagError ? 'account-field-hint-error' : ''}`}>
                  {gamertagError || '3-20 characters · letters, numbers, underscore, dot.'}
                </span>
              </label>
            )}

            {/* ── Confirm password (sign-up only) ─────────────────── */}
            {mode === 'signup' && (
              <label className="account-email-field">
                <span>Confirm Password</span>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter password"
                  disabled={!configured || submitting}
                  autoComplete="new-password"
                />
              </label>
            )}

            {/* ── Submit ──────────────────────────────────────────── */}
            <button
              type="submit"
              className={`account-email-submit ${isJupiter ? 'jupiter-theme' : 'iw8-theme'} ${isFocused('submit') ? 'controller-focused' : ''}`}
              onMouseEnter={() => playSound(hoverSound)}
              disabled={!configured || submitting}
            >
              {submitting
                ? 'Please wait…'
                : mode === 'signin'
                  ? 'Sign In'
                  : 'Create Account'}
            </button>
          </form>

          {signInError && !emailError && !passwordError && !discordUsernameError && !gamertagError && (
            <div className={`account-signin-error ${isJupiter ? 'jupiter-theme' : 'iw8-theme'}`} role="alert">
              {signInError}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
