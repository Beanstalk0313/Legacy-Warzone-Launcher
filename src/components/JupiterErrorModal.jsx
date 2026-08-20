import React, { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { playSound } from '../utils/audio'
import { useControllerNavigation } from '../utils/controller'

export default function JupiterErrorModal({ theme = 'jupiter', isOpen, title = 'REQUEST FAILED', message, onClose }) {
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

  const handleClose = () => {
    playSound(selectSound)
    onClose?.()
  }

  const focusedIndex = useControllerNavigation({
    itemCount: 1,
    enabled: isOpen,
    onControllerActivity: () => setCurrentInputMode('controller'),
    onMove: () => {
      setCurrentInputMode('controller')
      playSound(hoverSound)
    },
    onConfirm: handleClose,
    onBack: handleClose,
  })

  if (!isOpen) return null

  // Portaled to document.body: this modal renders inside the tab-slide
  // container, whose retained slideInTab transform would trap the
  // `position: fixed` overlay to the main-body area instead of the viewport.
  return createPortal(
    <div className="modal-overlay" onClick={handleClose} onMouseMove={handleMouseMove}>
      <div
        className={`${isJupiter ? 'jupiter' : 'iw8'}-error-modal`}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="jupiter-error-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className={`${isJupiter ? 'jupiter' : 'iw8'}-error-accent-bar`} />
        <div className={`${isJupiter ? 'jupiter' : 'iw8'}-error-content`}>
          <div className={`${isJupiter ? 'jupiter' : 'iw8'}-error-copy`}>
            <span className={`${isJupiter ? 'jupiter' : 'iw8'}-error-kicker`}>SYSTEM MESSAGE</span>
            <h2 id="jupiter-error-title">{title}</h2>
            <p>{message || 'The requested operation could not be completed.'}</p>
          </div>
          <button
            type="button"
            className={`${isJupiter ? 'jupiter' : 'iw8'}-error-acknowledge ${inputMode === 'controller' && focusedIndex === 0 ? 'controller-focused' : ''}`}
            onMouseEnter={() => playSound(hoverSound)}
            onClick={handleClose}
          >
            Acknowledge
          </button>
        </div>
      </div>
    </div>,
    document.getElementById('ui-portal-root') || document.body,
  )
}
