import React, { useRef, useState } from 'react'
import { playSound } from '../utils/audio'
import { useControllerNavigation } from '../utils/controller'

export default function JupiterQuitModal({ isOpen, onClose, onGoLauncher, onQuitDesktop }) {
  // Tracking input mode matches the pattern used by every other screen in the
  // app. Without this, the `useControllerNavigation` hook's default
  // focusedIndex of 0 paints `.controller-focused` on the Yes button even
  // when the user is on a mouse — making Yes look permanently selected.
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

  const handleHover = () => playSound('jupHover')

  const handleYes = () => {
    playSound('jupSelect')
    onQuitDesktop()
  }

  const handleNo = () => {
    playSound('jupSelect')
    onClose()
  }

  const handleReturnHome = () => {
    playSound('jupSelect')
    onClose()
    onGoLauncher?.()
  }

  const focusedIndex = useControllerNavigation({
    itemCount: 3,
    // Buttons sit in a horizontal row (bottom-right, like the host-prompt
    // modal's action row), so D-pad moves left/right between them.
    allowedDirections: ['left', 'right'],
    enabled: isOpen,
    onMove: () => {
      handleHover()
      setCurrentInputMode('controller')
    },
    onControllerActivity: () => setCurrentInputMode('controller'),
    onConfirm: (index) => [handleYes, handleNo, handleReturnHome][index]?.(),
    onBack: onClose,
  })

  if (!isOpen) return null

  return (
    <div className="modal-overlay" onClick={handleNo} onMouseMove={handleMouseMove}>
      <div className="jupiter-quit-modal" onClick={(e) => e.stopPropagation()}>
        <div className="jupiter-quit-accent-bar" />

        <div className="jupiter-quit-content">
          <h2 className="jupiter-quit-title">Quit to Desktop?</h2>

          <div className="jupiter-quit-buttons-stack">
            {['Yes', 'No', 'Return Home'].map((label, index) => (
              <button
                key={label}
                className={`jupiter-quit-option-btn ${inputMode === 'controller' && focusedIndex === index ? 'controller-focused' : ''}`}
                onMouseEnter={handleHover}
                onClick={[handleYes, handleNo, handleReturnHome][index]}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
