import React, { useRef, useState } from 'react'
import { playSound } from '../utils/audio'
import { useControllerNavigation } from '../utils/controller'

export default function IW8QuitModal({ isOpen, onClose, onGoLauncher, onQuitDesktop }) {
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

  const handleHover = () => playSound('iw8Hover')

  const handleYes = () => {
    playSound('iw8Select')
    onQuitDesktop()
  }

  const handleNo = () => {
    playSound('iw8Select')
    onClose()
  }

  const handleReturnHome = () => {
    playSound('iw8Select')
    onClose()
    onGoLauncher?.()
  }

  const focusedIndex = useControllerNavigation({
    itemCount: 3,
    allowedDirections: ['up', 'down'],
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
      <div className="iw8-quit-modal" onClick={(e) => e.stopPropagation()}>
        <h2 className="iw8-quit-title">Quit to Desktop?</h2>

        <div className="iw8-quit-options">
          {['Yes', 'No', 'Return Home'].map((label, index) => (
            <button
              key={label}
              className={`iw8-quit-option-btn ${inputMode === 'controller' && focusedIndex === index ? 'controller-focused' : ''}`}
              onMouseEnter={handleHover}
              onClick={[handleYes, handleNo, handleReturnHome][index]}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
