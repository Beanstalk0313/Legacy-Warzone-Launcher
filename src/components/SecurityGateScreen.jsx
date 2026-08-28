import React from 'react'
import AccountTab from './AccountTab'
import { exitApp } from '../utils/serverPresence'
import { playSound } from '../utils/audio'

export default function SecurityGateScreen({ state, onRetry }) {
  const prefix = 'jupiter'

  const handleQuit = async () => {
    try {
      await exitApp()
    } catch {
      try { window.close() } catch { /* nothing more we can do */ }
    }
  }

  const handleRetry = () => {
    playSound('jupSelect')
    onRetry?.()
  }

  if (state.kind === 'setup') {
    return (
      <div className={`security-gate security-gate-${prefix}`}>
        <header className="security-gate-header">
          <span className="security-gate-kicker">LEGACY MODERN WARFARE III LAUNCHER</span>
          <h1>ACCOUNT SETUP</h1>
          <p>
            A signed-in account with a complete Discord username is required.
          </p>
        </header>
        <main className="security-gate-account">
          <AccountTab theme="jupiter" onIdentitySaved={onRetry} />
        </main>
        <button
          type="button"
          className="security-gate-quit"
          onMouseEnter={() => playSound('jupHover')}
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
            ? 'This device and account have been banned from the Legacy Modern Warfare III Launcher. The launcher cannot continue.'
            : 'The launcher could not complete its account security verification. For your protection, it will not continue while verification is unavailable.'}
        </p>
        <div className="security-gate-actions">
          {!isBanned && (
            <button
              type="button"
              className="security-gate-action"
              onMouseEnter={() => playSound('jupHover')}
              onClick={handleRetry}
            >
              Try Again
            </button>
          )}
          <button
            type="button"
            className="security-gate-action"
            onMouseEnter={() => playSound('jupHover')}
            onClick={handleQuit}
          >
            Quit
          </button>
        </div>
      </main>
    </div>
  )
}
