import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { playSound } from '../utils/audio'
import { useControllerNavigation } from '../utils/controller'
import { useTranslation } from '../utils/i18n'

/**
 * Themed confirmation dialog for deleting the Jupiter game install.
 * Follows the Jupiter error-modal shell (accent rail, kicker, stacked buttons)
 * so it reads as part of the same themed family as JupiterErrorModal.
 *
 * Props:
 *   isOpen     — controls rendering
 *   theme      — 'jupiter' (for styling)
 *   onConfirm  — called when the user confirms the uninstall
 *   onCancel   — called when the user cancels / presses Esc
 *   installPath — the game install folder path (shown in the message)
 */
export default function GameUninstallModal({
  isOpen,
  theme = 'jupiter',
  onConfirm,
  onCancel,
  installPath = '',
}) {
  const { t } = useTranslation()
  const isJupiter = theme === 'jupiter'
  const hoverSound = 'jupHover'
  const selectSound = 'jupSelect'
  const [inputMode, setInputMode] = useState('mouse')
  const inputModeRef = useRef('mouse')

  const setCurrentInputMode = (mode) => {
    inputModeRef.current = mode
    setInputMode(mode)
  }

  const handleMouseMove = (event) => {
    if (event.movementX !== 0 || event.movementY !== 0) setCurrentInputMode('mouse')
  }

  const handleClose = () => {
    playSound(selectSound)
    onCancel?.()
  }

  const handleConfirm = () => {
    playSound(selectSound)
    onConfirm?.()
  }

  // Controller nav: [Cancel, Uninstall] — 2 items
  const focusedIndex = useControllerNavigation({
    itemCount: 2,
    enabled: isOpen,
    onControllerActivity: () => setCurrentInputMode('controller'),
    onMove: () => {
      setCurrentInputMode('controller')
      playSound(hoverSound)
    },
    onConfirm: (index) => {
      setCurrentInputMode('controller')
      if (index === 0) handleClose()
      else handleConfirm()
    },
    onBack: handleClose,
  })

  if (!isOpen) return null

  const modalPrefix = 'jupiter'
  const isFocused = (index) => inputMode === 'controller' && focusedIndex === index

  return createPortal(
    <div className="modal-overlay" onClick={handleClose} onMouseMove={handleMouseMove}>
      <div
        className={`${modalPrefix}-error-modal game-uninstall-modal`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="game-uninstall-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className={`${modalPrefix}-error-accent-bar`} />
        <div className={`${modalPrefix}-error-content`}>
          <div className={`${modalPrefix}-error-copy`}>
            <span className={`${modalPrefix}-error-kicker`}>{t('install.kicker')}</span>
            <h2 id="game-uninstall-title">{t('uninstall.title')}</h2>
            <p className="game-uninstall-desc" dangerouslySetInnerHTML={{ __html: t('uninstall.desc', { path: installPath || 'your install folder' }) }} />
            <div className="game-uninstall-actions">
              <button
                type="button"
                className={`${modalPrefix}-error-acknowledge ${isFocused(0) ? 'controller-focused' : ''}`}
                onMouseEnter={() => playSound(hoverSound)}
                onClick={handleClose}
              >
                {t('uninstall.cancel')}
              </button>
              <button
                type="button"
                className={`${modalPrefix}-error-acknowledge game-uninstall-btn-danger ${isFocused(1) ? 'controller-focused' : ''}`}
                onMouseEnter={() => playSound(hoverSound)}
                onClick={handleConfirm}
              >
                {t('uninstall.confirm')}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>,
    // Same portal target as every other themed modal — #ui-portal-root keeps
    // the dialog inside the scaled 16:9 canvas and lets mode-scoped CSS
    // (e.g. the zombies red accent) reach it.
    document.getElementById('ui-portal-root') || document.body,
  )
}
