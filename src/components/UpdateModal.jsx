import React, { useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { playSound } from '../utils/audio'
import { useControllerNavigation } from '../utils/controller'
import { installUpdate } from '../utils/updater'

// Startup auto-update dialog. Appears over the launcher (theme-neutral —
// the user hasn't picked a mod yet) when the GitHub release check finds a
// newer version: Update Now downloads the signed installer (with progress)
// and relaunches into it; Later dismisses until the next app start. Esc /
// controller-B also dismisses. See AUTO_UPDATE.md for the release/signing
// setup on the GitHub side.
export default function UpdateModal({ update, onDismiss }) {
  const [stage, setStage] = useState('prompt') // 'prompt' | 'downloading' | 'error'
  const [progress, setProgress] = useState(0)
  const [errorMessage, setErrorMessage] = useState(null)
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

  // Theme-neutral cues — this dialog sits on the launcher, pre-mod-choice.
  const handleHover = () => playSound('mainSlide', 0.4)
  const handleSelect = () => playSound('mainSlide', 0.4)

  const handleInstall = async () => {
    if (!update || stage === 'downloading') return
    handleSelect()
    setStage('downloading')
    setProgress(0)
    setErrorMessage(null)
    try {
      let contentLength = 0
      let downloaded = 0
      await installUpdate(update, (event) => {
        if (event.event === 'Started') {
          contentLength = event.data.contentLength || 0
        } else if (event.event === 'Progress') {
          downloaded += event.data.chunkLength
          setProgress(contentLength ? Math.min(100, Math.round((downloaded / contentLength) * 100)) : 0)
        }
      })
      // installUpdate() calls relaunch() once the installer finishes — on
      // Windows the app is auto-exited during the install step, so reaching
      // this line usually means the app is already restarting.
    } catch (error) {
      setStage('error')
      setErrorMessage(error?.message || String(error))
    }
  }

  const handleDismiss = () => {
    handleSelect()
    onDismiss?.()
  }

  const focusedIndex = useControllerNavigation({
    itemCount: stage === 'downloading' ? 0 : 2,
    allowedDirections: ['left', 'right'],
    enabled: Boolean(update),
    onControllerActivity: () => setCurrentInputMode('controller'),
    onMove: () => {
      setCurrentInputMode('controller')
      handleHover()
    },
    onConfirm: (index) => {
      setCurrentInputMode('controller')
      if (index === 0) void handleInstall()
      else handleDismiss()
    },
    onBack: handleDismiss,
  })

  if (!update) return null

  const isFocused = (index) => inputMode === 'controller' && focusedIndex === index

  return createPortal(
    <div className="modal-overlay" onMouseMove={handleMouseMove}>
      <div
        className="update-modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="update-modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <span className="update-modal-kicker">AUTO-UPDATE</span>
        <h2 id="update-modal-title">UPDATE AVAILABLE</h2>
        {stage === 'error' ? (
          <p className="update-modal-error">
            The update couldn't be installed — {errorMessage || 'unknown error'}. Try again or install it manually from the release page.
          </p>
        ) : (
          <p>
            Version <strong>{update.version}</strong> is ready to install.
            {update.body ? ` ${update.body.slice(0, 220)}` : ' Download it now to get the latest fixes and features.'}
          </p>
        )}
        {stage === 'downloading' && (
          <div className="update-modal-progress">
            <div className="update-modal-progress-bar">
              <div className="update-modal-progress-fill" style={{ width: `${progress}%` }} />
            </div>
            <span>{progress}%</span>
          </div>
        )}
        {stage !== 'downloading' && (
          <div className="update-modal-actions">
            <button
              type="button"
              className={`update-modal-btn update-modal-btn-primary ${isFocused(0) ? 'controller-focused' : ''}`}
              onMouseEnter={handleHover}
              onClick={() => void handleInstall()}
            >
              {stage === 'error' ? 'Retry' : 'Update Now'}
            </button>
            <button
              type="button"
              className={`update-modal-btn ${isFocused(1) ? 'controller-focused' : ''}`}
              onMouseEnter={handleHover}
              onClick={handleDismiss}
            >
              Later
            </button>
          </div>
        )}
      </div>
    </div>,
    document.getElementById('ui-portal-root') || document.body,
  )
}
