import React, { useEffect, useRef, useState } from 'react'
import { playSound } from '../utils/audio'
import { useControllerNavigation } from '../utils/controller'
import { useTranslation } from '../utils/i18n'

/**
 * Shared "Quit to Desktop?" confirmation.
 *
 * Props:
 *   isOpen               — controls rendering
 *   showReturnToLauncher — when true (in the game interface) a third
 *                          "Return to Launcher Menu" action appears; the
 *                          launcher itself hides it (there's nothing to
 *                          return to).
 *   onClose              — dismiss (No)
 *   onGoLauncher         — return to the launcher menu (animated)
 *   onQuitDesktop        — confirmed quit (App runs the cleanup + exit)
 */
export default function JupiterQuitModal({
  isOpen,
  showReturnToLauncher = true,
  onClose,
  onGoLauncher,
  onQuitDesktop,
}) {
  const { t } = useTranslation()
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

  // The quit modal plays its signature cue whenever it opens (launcher quit
  // button or the window X — both open this shared instance).
  useEffect(() => {
    if (isOpen) playSound('jupQuit')
  }, [isOpen])

  const handleHover = () => playSound('jupHover')

  const actions = [
    { key: 'yes', label: t('quit.yes'), handler: () => onQuitDesktop?.() },
    { key: 'no', label: t('quit.no'), handler: () => onClose?.() },
    ...(showReturnToLauncher
      ? [{ key: 'return', label: t('quit.returnshell'), handler: () => { onClose?.(); onGoLauncher?.() } }]
      : []),
  ]

  const focusedIndex = useControllerNavigation({
    itemCount: actions.length,
    // Buttons sit in a vertical stack (right side), so up/down moves
    // between them.
    allowedDirections: ['up', 'down'],
    enabled: isOpen,
    onMove: () => {
      handleHover()
      setCurrentInputMode('controller')
    },
    onControllerActivity: () => setCurrentInputMode('controller'),
    onConfirm: (index) => {
      playSound('jupSelect')
      actions[index]?.handler()
    },
    onBack: () => {
      playSound('jupSelect')
      onClose?.()
    },
  })

  if (!isOpen) return null

  return (
    <div className="modal-overlay" onClick={() => { playSound('jupSelect'); onClose?.() }} onMouseMove={handleMouseMove}>
      <div className="jupiter-quit-modal" onClick={(e) => e.stopPropagation()}>
        <div className="jupiter-quit-accent-bar" />

        <div className="jupiter-quit-content">
          <h2 className="jupiter-quit-title">{t('quit.title')}</h2>

          <div className="jupiter-quit-buttons-stack">
            {actions.map((action, index) => (
              <button
                key={action.key}
                className={`jupiter-quit-option-btn ${inputMode === 'controller' && focusedIndex === index ? 'controller-focused' : ''}`}
                onMouseEnter={handleHover}
                onClick={() => { playSound('jupSelect'); action.handler() }}
              >
                {action.label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
