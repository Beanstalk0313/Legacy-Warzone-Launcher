import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { playSound } from '../utils/audio'
import { useAuth } from './AuthProvider'
import { getDisplayName } from '../utils/displayName'
import { useControllerNavigation } from '../utils/controller'
import { focusTextInput } from '../utils/keyboard'
import { supabase, SUPABASE_CONFIGURED } from '../lib/supabase'
import { saveUserIdentity } from '../utils/userIdentity'
import CustomSelect from './CustomSelect'

// Account tab — full account management screen.
//
// Two modes:
//   "signin"  – email + password
//   "signup"  – email + password + Discord username + gamertag + confirm password
//
// When signed in: a full account editor with editable gamertag, Discord username,
// region (CustomSelect), and read-only email / member-since. Changes save to
// Supabase immediately on blur/confirm.

const USERNAME_PATTERN = /^[A-Za-z0-9_.]{3,20}$/

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
  if (!USERNAME_PATTERN.test(trimmed)) return '3-20 characters; letters, numbers, underscore, dot only.'
  return null
}

function validateDiscordUsername(value) {
  const trimmed = (value || '').trim()
  if (!trimmed) return 'Discord username is required.'
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

  // ── Form state (sign-in / sign-up) ──────────────────────────────────────
  const [mode, setMode] = useState('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [discordUsername, setDiscordUsername] = useState('')
  const [gamertag, setGamertag] = useState('')
  const [signInError, setSignInError] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [successMessage, setSuccessMessage] = useState(null)
  const [touched, setTouched] = useState(false)

  // ── Signed-in editor state ──────────────────────────────────────────────
  const [editGamertag, setEditGamertag] = useState('')
  const [editDiscord, setEditDiscord] = useState('')
  const [profileRegion, setProfileRegion] = useState('')
  const [savingField, setSavingField] = useState(null) // 'gamertag' | 'discord' | 'region' | null
  const [saveMessage, setSaveMessage] = useState(null)
  const [editError, setEditError] = useState(null)

  // Region dropdown state (CustomSelect)
  const [regionOpen, setRegionOpen] = useState(false)

  // ── Load profile data ───────────────────────────────────────────────────
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
      } catch (err) {
        console.warn('[account] could not load region', err)
      }
    })()
    return () => { mounted = false }
  }, [user?.id])

  // Seed editor fields when user changes
  useEffect(() => {
    if (!user) return
    const meta = user.user_metadata || {}
    setEditGamertag(meta.gamertag || '')
    setEditDiscord(meta.discord_username || '')
  }, [user?.id, user?.user_metadata])

  // Keep desktop identity file aligned
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
      .then(() => { if (active) onIdentitySaved?.(identity) })
      .catch((err) => { if (active) console.warn('[account] identity save failed', err) })
    return () => { active = false }
  }, [user?.id, user?.email, user?.user_metadata, onIdentitySaved])

  // ── Profile field savers ────────────────────────────────────────────────
  const saveGamertag = useCallback(async () => {
    const trimmed = editGamertag.trim()
    const current = (user?.user_metadata?.gamertag || '').trim()
    if (!trimmed || trimmed === current) return
    const err = validateGamertag(trimmed)
    if (err) { setEditError(err); return }
    setSavingField('gamertag')
    setEditError(null)
    try {
      const { error } = await supabase.auth.updateUser({ data: { gamertag: trimmed } })
      if (error) throw error
      setSaveMessage('Gamertag updated.')
      const identity = {
        discord_username: (user?.user_metadata?.discord_username || '').trim(),
        gamertag: trimmed,
        email: user?.email || '',
      }
      if (identity.discord_username && identity.email) {
        saveUserIdentity(identity).catch(() => {})
        onIdentitySaved?.(identity)
      }
    } catch (err) {
      setEditError(err?.message || 'Could not update gamertag.')
    } finally {
      setSavingField(null)
    }
  }, [editGamertag, user, onIdentitySaved])

  const saveDiscord = useCallback(async () => {
    const trimmed = editDiscord.trim()
    const current = (user?.user_metadata?.discord_username || '').trim()
    if (!trimmed || trimmed === current) return
    const err = validateDiscordUsername(trimmed)
    if (err) { setEditError(err); return }
    setSavingField('discord')
    setEditError(null)
    try {
      const { error } = await supabase.auth.updateUser({ data: { discord_username: trimmed } })
      if (error) throw error
      setSaveMessage('Discord username updated.')
      const identity = {
        discord_username: trimmed,
        gamertag: (user?.user_metadata?.gamertag || '').trim(),
        email: user?.email || '',
      }
      if (identity.gamertag && identity.email) {
        saveUserIdentity(identity).catch(() => {})
        onIdentitySaved?.(identity)
      }
    } catch (err) {
      setEditError(err?.message || 'Could not update Discord username.')
    } finally {
      setSavingField(null)
    }
  }, [editDiscord, user, onIdentitySaved])

  const saveRegion = useCallback(async (value) => {
    setProfileRegion(value)
    if (!user?.id || !SUPABASE_CONFIGURED || !supabase) return
    setSavingField('region')
    setEditError(null)
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ region: value || null })
        .eq('user_id', user.id)
      if (error) throw error
      setSaveMessage('Region updated.')
    } catch (err) {
      setEditError(err?.message || 'Could not save region.')
    } finally {
      setSavingField(null)
    }
  }, [user?.id])

  // Auto-clear save messages
  useEffect(() => {
    if (!saveMessage) return
    const id = setTimeout(() => setSaveMessage(null), 3000)
    return () => clearTimeout(id)
  }, [saveMessage])

  // ── Sign-in / sign-up ───────────────────────────────────────────────────
  const switchMode = (newMode) => {
    playSound(hoverSound)
    setMode(newMode)
    setSignInError(null)
    setSuccessMessage(null)
    setTouched(false)
  }

  const handleSubmit = async (event) => {
    event.preventDefault()
    setTouched(true)
    setSignInError(null)
    setSuccessMessage(null)

    const emailErr = validateEmail(email)
    if (emailErr) { setSignInError(emailErr); return }
    const passwordErr = validatePassword(password)
    if (passwordErr) { setSignInError(passwordErr); return }

    if (mode === 'signup') {
      const discordErr = validateDiscordUsername(discordUsername)
      if (discordErr) { setSignInError(discordErr); return }
      const gamertagErr = validateGamertag(gamertag)
      if (gamertagErr) { setSignInError(gamertagErr); return }
      if (password !== confirmPassword) { setSignInError('Passwords do not match.'); return }
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
          throw new Error('This account has no Discord username. Open-beta accounts must provide the complete username.')
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

  const handleSignOut = async () => {
    playSound(selectSound)
    try { await signOut() } catch { /* session expires */ }
  }

  // ── Controller nav (signed-in editor) ───────────────────────────────────
  // Rows: gamertag, discord, region, sign-out
  const signedInItems = useMemo(() => [
    { kind: 'text', key: 'gamertag', label: 'Gamertag' },
    { kind: 'text', key: 'discord', label: 'Discord Username' },
    { kind: 'select', key: 'region', label: 'Region' },
    { kind: 'action', key: 'signout', label: 'Sign Out' },
  ], [])

  const regionDisplay = profileRegion || 'Not set'
  const regionOptions = useMemo(() => ['Not set', ...REGION_OPTIONS], [])

  const signedInFocusedIndex = useControllerNavigation({
    itemCount: signedInItems.length,
    allowedDirections: ['up', 'down'],
    onControllerActivity: () => setInputMode('controller'),
    onMove: () => { setInputMode('controller'); playSound(hoverSound) },
    onConfirm: (index, source) => {
      setInputMode(source === 'gamepad' ? 'controller' : 'mouse')
      const item = signedInItems[index]
      if (!item) return
      if (item.kind === 'text') {
        focusTextInput(`[data-account-field="${item.key}"]`, setInputMode)
      } else if (item.kind === 'select') {
        setRegionOpen(!regionOpen)
      } else if (item.kind === 'action') {
        handleSignOut()
      }
    },
  })

  const signedInFocused = (key) => inputMode === 'controller' && signedInItems[signedInFocusedIndex]?.key === key

  // ── Controller nav (sign-in / sign-up form) ─────────────────────────────
  const formItems = useMemo(() => {
    const items = [{ kind: 'toggle', key: 'mode' }]
    if (mode === 'signup') {
      items.push({ kind: 'text', key: 'discord' })
      items.push({ kind: 'text', key: 'gamertag' })
    }
    items.push({ kind: 'action', key: 'submit' })
    return items
  }, [mode])

  const formFocusedIndex = useControllerNavigation({
    itemCount: formItems.length,
    allowedDirections: ['up', 'down'],
    enabled: !user,
    onControllerActivity: () => setInputMode('controller'),
    onMove: () => { setInputMode('controller'); playSound(hoverSound) },
    onConfirm: (index, source) => {
      setInputMode(source === 'gamepad' ? 'controller' : 'mouse')
      const item = formItems[index]
      if (!item) return
      if (item.kind === 'toggle') {
        switchMode(mode === 'signin' ? 'signup' : 'signin')
      } else if (item.kind === 'text') {
        focusTextInput(`[data-signup-field="${item.key}"]`, setInputMode)
      } else if (item.kind === 'action') {
        handleSubmit({ preventDefault: () => {} })
      }
    },
  })

  const formFocused = (key) => inputMode === 'controller' && formItems[formFocusedIndex]?.key === key

  // ══════════════════════════════════════════════════════════════════════════
  // SIGNED-IN VIEW — full account editor
  // ══════════════════════════════════════════════════════════════════════════
  if (user) {
    const userEmail = user.email || ''
    const meta = user.user_metadata || {}
    const displayName = getDisplayName(user)
    const memberSince = user.created_at
      ? new Date(user.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })
      : '—'

    return (
      <div className={`tab-content-panel ${isJupiter ? 'jupiter-theme' : 'iw8-theme'}`}>
        <div className="tab-header-title">
          <h2>ACCOUNT</h2>
        </div>

        {saveMessage && (
          <div className="account-save-toast">{saveMessage}</div>
        )}

        {/* ── Profile header ────────────────────────────────────────────── */}
        <div className={`account-profile-header ${isJupiter ? 'jupiter-theme' : 'iw8-theme'}`}>
          <div className={`account-avatar-lg ${isJupiter ? 'jupiter-theme' : 'iw8-theme'}`}>
            <span>{(displayName[0] || userEmail[0] || '?').toUpperCase()}</span>
          </div>
          <div className="account-profile-info">
            <h3 className="account-display-name">{displayName}</h3>
            <span className="account-email-line">{userEmail}</span>
            <span className="account-member-since">Member since {memberSince}</span>
          </div>
        </div>

        {/* ── Identity card — editable fields ───────────────────────────── */}
        <div className={`account-editor-card ${isJupiter ? 'jupiter-theme' : 'iw8-theme'}`}>
          <h4 className="account-card-heading">IDENTITY</h4>

          <label className={`account-editor-row ${signedInFocused('gamertag') ? 'controller-focused' : ''}`}>
            <div className="account-editor-label">
              <strong>Gamertag</strong>
              <span>Your in-game name, shown in lobbies and the server browser.</span>
            </div>
            <div className="account-editor-field">
              <input
                type="text"
                data-account-field="gamertag"
                value={editGamertag}
                onChange={(e) => setEditGamertag(e.target.value)}
                onBlur={saveGamertag}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.target.blur(); saveGamertag() } if (e.key === 'Escape') e.target.blur() }}
                placeholder="e.g. beanstalk313"
                maxLength={20}
                spellCheck={false}
                disabled={savingField === 'gamertag'}
                onMouseEnter={() => playSound(hoverSound)}
              />
              {savingField === 'gamertag' && <span className="account-saving-indicator">Saving…</span>}
            </div>
          </label>

          <label className={`account-editor-row ${signedInFocused('discord') ? 'controller-focused' : ''}`}>
            <div className="account-editor-label">
              <strong>Discord Username</strong>
              <span>Your complete Discord username (not display name).</span>
            </div>
            <div className="account-editor-field">
              <input
                type="text"
                data-account-field="discord"
                value={editDiscord}
                onChange={(e) => setEditDiscord(e.target.value)}
                onBlur={saveDiscord}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.target.blur(); saveDiscord() } if (e.key === 'Escape') e.target.blur() }}
                placeholder="e.g. beanstalk313_16060"
                maxLength={32}
                spellCheck={false}
                disabled={savingField === 'discord'}
                onMouseEnter={() => playSound(hoverSound)}
              />
              {savingField === 'discord' && <span className="account-saving-indicator">Saving…</span>}
            </div>
          </label>

          <label className={`account-editor-row ${signedInFocused('region') ? 'controller-focused' : ''}`}>
            <div className="account-editor-label">
              <strong>Region</strong>
              <span>Shown as a flag on your player card.</span>
            </div>
            <div className="account-editor-field">
              <CustomSelect
                value={regionDisplay}
                options={regionOptions}
                onSelect={(display) => saveRegion(display === 'Not set' ? '' : display)}
                isOpen={regionOpen}
                onToggle={() => setRegionOpen(!regionOpen)}
                onClose={() => setRegionOpen(false)}
                focusIndex={regionOpen ? Math.max(0, regionOptions.indexOf(regionDisplay)) : null}
                theme={theme}
                ariaLabel="Region"
              />
            </div>
          </label>
        </div>

        {editError && (
          <div className={`account-edit-error ${isJupiter ? 'jupiter-theme' : 'iw8-theme'}`} role="alert">
            {editError}
          </div>
        )}

        {/* ── Account actions ───────────────────────────────────────────── */}
        <div className={`account-editor-card ${isJupiter ? 'jupiter-theme' : 'iw8-theme'}`}>
          <h4 className="account-card-heading">SESSION</h4>

          <div className={`account-editor-row ${signedInFocused('signout') ? 'controller-focused' : ''}`}>
            <div className="account-editor-label">
              <strong>Sign Out</strong>
              <span>Ends your session. Your device identity is preserved for the ban system.</span>
            </div>
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
            onClick={() => { switchMode('signin'); setEmail(''); setPassword('') }}
            onMouseEnter={() => playSound(hoverSound)}
          >
            Back to Sign In
          </button>
        </div>
      ) : (
        <div className={`account-editor-card account-signin-card ${isJupiter ? 'jupiter-theme' : 'iw8-theme'}`}>
          <form onSubmit={handleSubmit} className="account-signin-email-form">
            {/* ── Mode toggle ─────────────────────────────────────────── */}
            <div className="account-mode-toggle">
              <button
                type="button"
                className={`account-mode-btn ${mode === 'signin' ? 'active' : ''} ${formFocused('mode') ? 'controller-focused' : ''} ${isJupiter ? 'jupiter-theme' : 'iw8-theme'}`}
                onClick={() => switchMode('signin')}
                onMouseEnter={() => playSound(hoverSound)}
                disabled={!configured}
              >
                Sign In
              </button>
              <button
                type="button"
                className={`account-mode-btn ${mode === 'signup' ? 'active' : ''} ${formFocused('mode') ? 'controller-focused' : ''} ${isJupiter ? 'jupiter-theme' : 'iw8-theme'}`}
                onClick={() => switchMode('signup')}
                onMouseEnter={() => playSound(hoverSound)}
                disabled={!configured}
              >
                Sign Up
              </button>
            </div>

            {mode === 'signup' && (
              <div className="account-beta-signup-notice">
                <strong>Account required</strong>
                <span>Your complete Discord username is required. Enter the username from your Discord account, not your display name.</span>
              </div>
            )}

            {/* ── Email ─────────────────────────────────────────────── */}
            <label className="account-field">
              <span>Email</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                disabled={!configured || submitting}
                autoComplete="email"
                onMouseEnter={() => playSound(hoverSound)}
                aria-invalid={emailError ? 'true' : 'false'}
              />
              {emailError && <span className="account-field-error">{emailError}</span>}
            </label>

            {/* ── Password ──────────────────────────────────────────── */}
            <label className="account-field">
              <span>Password</span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 6 characters"
                disabled={!configured || submitting}
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                onMouseEnter={() => playSound(hoverSound)}
                aria-invalid={passwordError ? 'true' : 'false'}
              />
              {passwordError && <span className="account-field-error">{passwordError}</span>}
            </label>

            {/* ── Discord username (sign-up only) ───────────────────── */}
            {mode === 'signup' && (
              <label className={`account-field ${formFocused('discord') ? 'controller-focused' : ''}`}>
                <span>Discord Username <em>Required</em></span>
                <input
                  type="text"
                  data-signup-field="discord"
                  value={discordUsername}
                  onChange={(e) => setDiscordUsername(e.target.value)}
                  placeholder="e.g. beanstalk313_16060"
                  disabled={!configured || submitting}
                  autoComplete="off"
                  spellCheck={false}
                  maxLength={32}
                  onMouseEnter={() => playSound(hoverSound)}
                  aria-invalid={discordUsernameError ? 'true' : 'false'}
                />
                <span className="account-field-hint">
                  {discordUsernameError || 'Use your complete Discord username, not your display name.'}
                </span>
              </label>
            )}

            {/* ── Gamertag (sign-up only) ───────────────────────────── */}
            {mode === 'signup' && (
              <label className={`account-field ${formFocused('gamertag') ? 'controller-focused' : ''}`}>
                <span>Gamertag</span>
                <input
                  type="text"
                  data-signup-field="gamertag"
                  value={gamertag}
                  onChange={(e) => setGamertag(e.target.value)}
                  placeholder="e.g. beanstalk313"
                  disabled={!configured || submitting}
                  autoComplete="username"
                  spellCheck={false}
                  maxLength={20}
                  onMouseEnter={() => playSound(hoverSound)}
                  aria-invalid={gamertagError ? 'true' : 'false'}
                />
                <span className="account-field-hint">
                  {gamertagError || '3-20 characters · letters, numbers, underscore, dot.'}
                </span>
              </label>
            )}

            {/* ── Confirm password (sign-up only) ───────────────────── */}
            {mode === 'signup' && (
              <label className="account-field">
                <span>Confirm Password</span>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Re-enter password"
                  disabled={!configured || submitting}
                  autoComplete="new-password"
                  onMouseEnter={() => playSound(hoverSound)}
                />
              </label>
            )}

            {/* ── Submit ────────────────────────────────────────────── */}
            <button
              type="submit"
              className={`account-email-submit ${isJupiter ? 'jupiter-theme' : 'iw8-theme'} ${formFocused('submit') ? 'controller-focused' : ''}`}
              onMouseEnter={() => playSound(hoverSound)}
              disabled={!configured || submitting}
            >
              {submitting ? 'Please wait…' : mode === 'signin' ? 'Sign In' : 'Create Account'}
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
