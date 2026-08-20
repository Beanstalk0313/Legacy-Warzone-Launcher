import React, { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { playSound } from '../utils/audio'
import { useControllerNavigation } from '../utils/controller'

export const BETA_WELCOME_STORAGE_KEY = 'lwz-beta-welcome-acknowledged'

// Keep a memory fallback so the acknowledgment remains one-time even when a
// browser/webview has storage disabled. localStorage still persists it across
// app launches in the normal Tauri runtime.
let acknowledgedInMemory = false

export function hasBetaWelcomeAcknowledged() {
  if (acknowledgedInMemory) return true
  try {
    return window.localStorage?.getItem(BETA_WELCOME_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

function acknowledgeBetaWelcome() {
  acknowledgedInMemory = true
  try {
    window.localStorage?.setItem(BETA_WELCOME_STORAGE_KEY, '1')
  } catch {
    // The in-memory fallback above still prevents a second modal this run.
  }
}

export default function BetaWelcomeModal({ theme = 'iw8', isOpen, onAcknowledge }) {
  const isJupiter = theme === 'jupiter'
  const hoverSound = isJupiter ? 'jupHover' : 'iw8Hover'
  const selectSound = isJupiter ? 'jupSelect' : 'iw8Select'
  const [inputMode, setInputMode] = useState('mouse')
  const inputModeRef = useRef('mouse')

  const setCurrentInputMode = (mode) => {
    inputModeRef.current = mode
    setInputMode(mode)
  }

  const handleMouseMove = (event) => {
    if (event.movementX !== 0 || event.movementY !== 0) {
      setCurrentInputMode('mouse')
    }
  }

  const handleAcknowledge = () => {
    playSound(selectSound)
    acknowledgeBetaWelcome()
    onAcknowledge?.()
  }

  const focusedIndex = useControllerNavigation({
    itemCount: 1,
    enabled: isOpen,
    onControllerActivity: () => setCurrentInputMode('controller'),
    onMove: () => {
      setCurrentInputMode('controller')
      playSound(hoverSound)
    },
    onConfirm: handleAcknowledge,
  })

  if (!isOpen) return null

  const modalPrefix = isJupiter ? 'jupiter' : 'iw8'

  return createPortal(
    <div className="modal-overlay" onMouseMove={handleMouseMove}>
      <div
        className={`${modalPrefix}-error-modal beta-welcome-modal`}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="beta-welcome-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className={`${modalPrefix}-error-accent-bar`} />
        <div className={`${modalPrefix}-error-content beta-welcome-content`}>
          <div className={`${modalPrefix}-error-copy beta-welcome-copy`}>
            <span className={`${modalPrefix}-error-kicker`}>OPEN BETA</span>
            <h2 id="beta-welcome-title">Welcome to the Legacy Warzone Launcher Open Beta</h2>
            <p>
              Thank you for participating in the Legacy Warzone Launcher beta. This is a phase for
              us to discover and patch bugs, implement critical features, and polish the app before
              our public release. Your account and associated data will likely be wiped periodically
              as there are backend changes (this will cease when we go public), so please do not be
              surprised if you have to sign up for an account again. At this phase of our testing,
              an account is <em>required</em> to use the Legacy Warzone Launcher, and you must provide
              your Discord username. During the public release, all accounts and account data will
              be wiped one more time, and an account will become highly recommended, but not
              required. Thank you for your participation and understanding.
            </p>
          </div>
          <button
            type="button"
            className={`${modalPrefix}-error-acknowledge beta-welcome-acknowledge ${inputMode === 'controller' && focusedIndex === 0 ? 'controller-focused' : ''}`}
            onMouseEnter={() => playSound(hoverSound)}
            onClick={handleAcknowledge}
          >
            I Understand
          </button>
        </div>
      </div>
    </div>,
    document.getElementById('ui-portal-root') || document.body,
  )
}
