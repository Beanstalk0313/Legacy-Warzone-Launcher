import React, { useState } from 'react'
import AccountTab from './AccountTab'
import { exitApp } from '../utils/serverPresence'
import { playSound } from '../utils/audio'

function getInitialTheme() {
  try {
    return window.localStorage.getItem('lwz-last-mod') === 'jupiter' ? 'jupiter' : 'iw8'
  } catch {
    return 'iw8'
  }
}

export default function SecurityGateScreen({ state, onRetry }) {
  const [theme] = useState(getInitialTheme)
  const isJupiter = theme === 'jupiter'
  const prefix = isJupiter ? 'jupiter' : 'iw8'

  const handleQuit = async () => {
    try {
      await exitApp()
    } catch {
      try { window.close() } catch { /* nothing more we can do */ }
    }
  }

  const handleRetry = () => {
    playSound(isJupiter ? 'jupSelect' : 'iw8Select')
    onRetry?.()
  }

  if (state.kind === 'setup') {
    return (
      <div className={`security-gate security-gate-${prefix}`}>
        <header className="security-gate-header">
          <span className="security-gate-kicker">LEGACY WARZONE LAUNCHER</span>
          <h1>ACCOUNT SETUP</h1>
          <p>
            A signed-in account with a complete Discord username is required during the open beta.
          </p>
        </header>
        <main className="security-gate-account">
          <AccountTab theme={theme} onIdentitySaved={onRetry} />
        </main>
        <button
          type="button"
          className="security-gate-quit"
          onMouseEnter={() => playSound(isJupiter ? 'jupHover' : 'iw8Hover')}
          onClick={handleQuit}
        >
          Quit
        </button>
      </div>
    )
  }

  if (state.kind === 'checking') {
    return (
      <div className={`security-gate security-gate-${prefix} security-gate-blocked`}>
        <main className="security-gate-panel" role="status" aria-live="polite">
          <span className="security-gate-kicker">SECURITY VERIFICATION</span>
          <h1>VERIFYING DEVICE</h1>
          <p>Checking this device's identity and linked accounts against the ban records before starting the launcher.</p>
        </main>
      </div>
    )
  }

  const isBanned = state.kind === 'banned'
  return (
    <div className={`security-gate security-gate-${prefix} security-gate-blocked`}>
      <main className="security-gate-panel" role="alert" aria-live="assertive">
        <span className="security-gate-kicker">SECURITY VERIFICATION</span>
        <h1>{isBanned ? 'ACCESS BLOCKED' : 'SECURITY CHECK UNAVAILABLE'}</h1>
        <p>
          {isBanned
            ? 'This device and account have been banned from the Legacy Warzone Launcher open beta. The launcher cannot continue.'
            : 'The launcher could not complete its account security verification. For your protection, it will not continue while verification is unavailable.'}
        </p>
        <div className="security-gate-actions">
          {!isBanned && (
            <button
              type="button"
              className="security-gate-action"
              onMouseEnter={() => playSound(isJupiter ? 'jupHover' : 'iw8Hover')}
              onClick={handleRetry}
            >
              Try Again
            </button>
          )}
          <button
            type="button"
            className="security-gate-action"
            onMouseEnter={() => playSound(isJupiter ? 'jupHover' : 'iw8Hover')}
            onClick={handleQuit}
          >
            Quit
          </button>
        </div>
      </main>
    </div>
  )
}
