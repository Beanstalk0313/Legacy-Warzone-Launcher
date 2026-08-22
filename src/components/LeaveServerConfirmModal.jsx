import React, { useState } from 'react'
import { createPortal } from 'react-dom'
import { playSound } from '../utils/audio'
import { useControllerNavigation } from '../utils/controller'

// Themed confirmation shown before leaving a server — Esc on the in-game
// screen or the Leave Server button. "Leave Server" runs the full leave
// flow (-disconnect + MainMenuOffline + membership cleanup via the session
// provider); Cancel stays connected. Reuses the jupiter-host-prompt-modal
// surface (with the iw8-styled variant) so both themes come for free.
export default function LeaveServerConfirmModal({ theme = 'jupiter', isOpen, onConfirm, onCancel }) {
  const isJupiter = theme === 'jupiter'
  const hoverSound = isJupiter ? 'jupHover' : 'iw8Hover'
  const selectSound = isJupiter ? 'jupSelect' : 'iw8Select'
  const [inputMode, setInputMode] = useState('mouse')

  const handleHover = () => playSound(hoverSound)
  const handleSelect = (callback) => {
    playSound(selectSound)
    callback?.()
  }

  const focusedIndex = useControllerNavigation({
    itemCount: 2,
    allowedDirections: ['left', 'right'],
    enabled: Boolean(isOpen),
    onControllerActivity: () => setInputMode('controller'),
    onMove: () => {
      setInputMode('controller')
      handleHover()
    },
    onConfirm: (index) => {
      if (index === 0) handleSelect(onConfirm)
      else handleSelect(onCancel)
    },
    // Esc / controller-B cancels — stays connected.
    onBack: onCancel,
  })

  if (!isOpen) return null

  return createPortal(
    <div className="modal-overlay" role="presentation">
      <div
        className={`jupiter-host-prompt-modal ${isJupiter ? '' : 'iw8-styled'}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="leave-server-confirm-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="jupiter-join-accent-bar" />
        <div className="jupiter-join-content">
          <span className="jupiter-join-kicker">CONNECTED</span>
          <h2 id="leave-server-confirm-title">RETURN TO MAIN MENU?</h2>
          <p className="jupiter-join-intro">
            Are you sure you want to leave the server and return to the main menu? You'll be disconnected from the lobby.
          </p>
          <div className="jupiter-join-actions">
            <button
              type="button"
              className={`jupiter-join-button ${inputMode === 'controller' && focusedIndex === 0 ? 'controller-focused' : ''}`}
              onMouseEnter={handleHover}
              onClick={() => handleSelect(onConfirm)}
            >
              Leave Server
            </button>
            <button
              type="button"
              className={`jupiter-join-button secondary ${inputMode === 'controller' && focusedIndex === 1 ? 'controller-focused' : ''}`}
              onMouseEnter={handleHover}
              onClick={() => handleSelect(onCancel)}
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
