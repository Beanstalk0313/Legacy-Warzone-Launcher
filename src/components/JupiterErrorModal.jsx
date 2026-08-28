import React, { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { playSound } from '../utils/audio'
import { useControllerNavigation } from '../utils/controller'
import { useTranslation } from '../utils/i18n'

export default function JupiterErrorModal({ theme = 'jupiter', isOpen, title = 'REQUEST FAILED', message, onClose }) {
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
        className={`${'jupiter'}-error-modal`}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="jupiter-error-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className={`${'jupiter'}-error-accent-bar`} />
        <div className={`${'jupiter'}-error-content`}>
          <div className={`${'jupiter'}-error-copy`}>
            <span className={`${'jupiter'}-error-kicker`}>{t('error.kicker')}</span>
            <h2 id="jupiter-error-title">{title}</h2>
            <p>{message || t('error.default')}</p>
          </div>
          <button
            type="button"
            className={`${'jupiter'}-error-acknowledge ${inputMode === 'controller' && focusedIndex === 0 ? 'controller-focused' : ''}`}
            onMouseEnter={() => playSound(hoverSound)}
            onClick={handleClose}
          >
            {t('error.acknowledge')}
          </button>
        </div>
      </div>
    </div>,
    document.getElementById('ui-portal-root') || document.body,
  )
}
