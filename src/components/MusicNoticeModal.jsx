import React, { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { playSound } from '../utils/audio'
import { useControllerNavigation } from '../utils/controller'
import { useTranslation } from '../utils/i18n'

// First-launch "music is playing" notice: the launcher starts playing the
// current mode's soundtrack the moment the game interface opens, so the
// first time the user launches a mode (and audio begins playing) this modal
// explains how to avoid doubled audio — turn off the in-game music inside
// the game, or turn off Music in the Options tab. Shown ONCE ever; the
// localStorage flag lives in the WebView's appdata, so wiping appdata (or
// clearing browser storage in dev) brings it back.
//
// Portaled for the same reason the other modals are: the parent renders
// inside the tab-slide container, whose retained slideInTab transform would
// trap a `position: fixed` overlay to the main-body area.
export default function MusicNoticeModal({ isOpen, onClose }) {
  const { t } = useTranslation()
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
    playSound('jupSelect')
    onClose?.()
  }

  const focusedIndex = useControllerNavigation({
    itemCount: 1,
    // Single button in the bottom-right action column.
    allowedDirections: ['left', 'right'],
    enabled: isOpen,
    onMove: () => {
      setCurrentInputMode('controller')
      playSound('jupHover')
    },
    onControllerActivity: () => setCurrentInputMode('controller'),
    onConfirm: handleClose,
    onBack: handleClose,
  })

  if (!isOpen) return null

  return createPortal(
    <div className="modal-overlay" onClick={handleClose} onMouseMove={handleMouseMove}>
      <div
        className="jupiter-quickplay-modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="music-notice-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="jupiter-quickplay-modal-accent-bar" />
        <div className="jupiter-quickplay-modal-content">
          <div className="jupiter-quickplay-modal-copy">
            <span className="jupiter-quickplay-modal-kicker">{t('music.notice.kicker')}</span>
            <h2 id="music-notice-title">{t('music.notice.title')}</h2>
            <p>{t('music.notice.body')}</p>
          </div>
          <div className="jupiter-quickplay-modal-actions">
            <button
              type="button"
              className={`jupiter-quickplay-modal-btn ${inputMode === 'controller' && focusedIndex === 0 ? 'controller-focused' : ''}`}
              onMouseEnter={() => playSound('jupHover')}
              onClick={handleClose}
            >
              {t('music.notice.ok')}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.getElementById('ui-portal-root') || document.body,
  )
}
