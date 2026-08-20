import React, { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { playSound } from '../utils/audio'
import { useControllerNavigation } from '../utils/controller'

// Quick Play's "we searched for a full minute and found nothing" modal —
// Jupiter-only (Quick Play is Jupiter content), so it's always Jupiter
// themed. Mirrors the error modal's overlay/accent-rail/copy pattern, but
// with the quit modal's two-button bottom-right action row (Search Again /
// Cancel). Portaled for the same reason JupiterErrorModal is: the parent
// renders inside the tab-slide container, whose retained slideInTab
// transform would trap a `position: fixed` overlay to the main-body area.
export default function JupiterQuickPlayModal({ isOpen, message, onSearchAgain, onCancel }) {
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

  const handleSearchAgain = () => {
    playSound('jupSelect')
    onSearchAgain?.()
  }

  const handleCancel = () => {
    playSound('jupSelect')
    onCancel?.()
  }

  const focusedIndex = useControllerNavigation({
    itemCount: 2,
    // Buttons sit in a horizontal bottom-right row, so D-pad moves
    // left/right between them.
    allowedDirections: ['left', 'right'],
    enabled: isOpen,
    onMove: () => {
      setCurrentInputMode('controller')
      playSound('jupHover')
    },
    onControllerActivity: () => setCurrentInputMode('controller'),
    onConfirm: (index) => (index === 0 ? handleSearchAgain() : handleCancel()),
    onBack: handleCancel,
  })

  if (!isOpen) return null

  return createPortal(
    <div className="modal-overlay" onClick={handleCancel} onMouseMove={handleMouseMove}>
      <div
        className="jupiter-quickplay-modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="jupiter-quickplay-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="jupiter-quickplay-modal-accent-bar" />
        <div className="jupiter-quickplay-modal-content">
          <div className="jupiter-quickplay-modal-copy">
            <span className="jupiter-quickplay-modal-kicker">SYSTEM MESSAGE</span>
            <h2 id="jupiter-quickplay-title">NO MATCH FOUND</h2>
            <p>{message || 'Quick Play searched for a full minute without finding any open lobbies.'}</p>
          </div>
          <div className="jupiter-quickplay-modal-actions">
            <button
              type="button"
              className={`jupiter-quickplay-modal-btn ${inputMode === 'controller' && focusedIndex === 0 ? 'controller-focused' : ''}`}
              onMouseEnter={() => playSound('jupHover')}
              onClick={handleSearchAgain}
            >
              Search Again
            </button>
            <button
              type="button"
              className={`jupiter-quickplay-modal-btn secondary ${inputMode === 'controller' && focusedIndex === 1 ? 'controller-focused' : ''}`}
              onMouseEnter={() => playSound('jupHover')}
              onClick={handleCancel}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.getElementById('ui-portal-root') || document.body,
  )
}
