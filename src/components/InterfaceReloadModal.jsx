import React, { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { playSound } from '../utils/audio'
import { useControllerNavigation } from '../utils/controller'
import { useTranslation } from '../utils/i18n'

const MOD_NAMES = {
  iw8: 'IW8 Mod',
  jupiter: 'Jupiter Mod',
}

/**
 * Themed confirmation shown by the Options tab whenever Options > Dynamic
 * Interfaces (or Reset to Defaults) would swap the WHOLE interface shell.
 * The swap is deferred behind this modal so the screen doesn't snap
 * mid-click; on confirm the shell re-renders in place.
 *
 * Portaled to document.body because the Options tab renders inside the
 * tab-slide container, whose retained slideInTab transform would trap a
 * `position: fixed` overlay to the main-body area instead of the viewport
 * (same reason JupiterErrorModal portals).
 */
export default function InterfaceReloadModal({ theme = 'iw8', targetMod, isOpen, onConfirm, onCancel }) {
  const { t } = useTranslation()
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

  const handleHover = () => playSound(hoverSound)

  const handleConfirm = () => {
    playSound(selectSound)
    onConfirm?.()
  }

  const handleCancel = () => {
    playSound(selectSound)
    onCancel?.()
  }

  const focusedIndex = useControllerNavigation({
    itemCount: 2,
    // Buttons sit in a horizontal action row, so D-pad moves left/right.
    allowedDirections: ['left', 'right'],
    enabled: isOpen,
    onMove: () => {
      setCurrentInputMode('controller')
      handleHover()
    },
    onControllerActivity: () => setCurrentInputMode('controller'),
    onConfirm: (index) => (index === 0 ? handleConfirm : handleCancel)(),
    onBack: handleCancel,
  })

  if (!isOpen) return null

  return createPortal(
    <div className="modal-overlay" onClick={handleCancel} onMouseMove={handleMouseMove}>
      <div
        className={`interface-reload-modal ${isJupiter ? 'jupiter-theme' : 'iw8-theme'}`}
        role="alertdialog"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="interface-reload-accent-bar" />

        <div className="interface-reload-content">
          <div className="interface-reload-copy">
            <span className="interface-reload-kicker">{t('reload.kicker')}</span>
            <h2>{t('reload.title')}</h2>
            <p>
              {t('reload.desc', { mod: MOD_NAMES[targetMod] || 'other' })}
            </p>
          </div>

          <div className="interface-reload-actions">
            {[t('reload.confirm'), t('reload.cancel')].map((label, index) => (
              <button
                key={label}
                type="button"
                className={`interface-reload-btn ${index === 0 ? 'interface-reload-confirm' : 'interface-reload-cancel'} ${inputMode === 'controller' && focusedIndex === index ? 'controller-focused' : ''}`}
                onMouseEnter={handleHover}
                onClick={index === 0 ? handleConfirm : handleCancel}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>,
    document.getElementById('ui-portal-root') || document.body,
  )
}
