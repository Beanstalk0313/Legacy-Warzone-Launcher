import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { playSound } from '../utils/audio'
import { useControllerNavigation } from '../utils/controller'
import { focusTextInput } from '../utils/keyboard'
import { getGameInstallStatus } from '../utils/gameInstall'
import { useTranslation } from '../utils/i18n'

// Normalize a user-typed Windows path: trim whitespace, tolerate a trailing
// backslash (C:\Games\Warzone III\) or forward slash, and collapse any doubled
// separators so the stored path is a clean "C:\Games\Warzone III".
export function normalizeInstallPath(value) {
  let path = (value || '').trim()
  // Strip ONE trailing slash type after trimming; keep interior slashes intact.
  path = path.replace(/[\\/]+$/, '')
  // Collapse doubled backslashes elsewhere (accidental C:\\Games -> C:\Games).
  path = path.replace(/\\\\+/g, '\\')
  return path
}

// Jupiter-style modal for the Install & Play card. Stages:
//   choice   — how do you want to get the game? (Local Game / Download and
//              Install / Cancel)
//   setup    — the user types the install path (plain Windows path) + Install;
//              the download + extract runs from here
//   local    — same path field, but for a folder the user ALREADY has: it is
//              verified to contain startgame.bat instead of being downloaded
//   progress — one combined download+extract bar with percent
//   done     — install finished; Launch / Close
// It mirrors the Jupiter error-modal shell (accent rail, kicker, stacked
// buttons) so it reads as part of the same themed family.
export default function JupiterInstallModal({
  theme = 'jupiter',
  isOpen,
  onClose,
  installPath = '',
  onPathChange,
  installState, // { busy, percent, phase, installed, start, cancel, launch }
  onError,
}) {
  const { t } = useTranslation()
  const isJupiter = theme === 'jupiter'
  const hoverSound = 'jupHover'
  const selectSound = 'jupSelect'
  const [inputMode, setInputMode] = useState('mouse')
  const [stage, setStage] = useState('choice') // 'choice'|'setup'|'local'|'progress'|'done'
  const [fieldValue, setFieldValue] = useState('')
  const [localError, setLocalError] = useState(null)
  const inputModeRef = useRef('mouse')
  // Set by the Cancel button so that when the backend finishes processing the
  // cancellation the modal returns to the setup stage instead of "done".
  const cancelRequestedRef = useRef(false)
  // Mirror of the install's busy state for use at reopen time (reading it from
  // the prop in the open-effect would re-run the effect on every progress tick).
  const busyRef = useRef(installState.busy)

  useEffect(() => {
    busyRef.current = installState.busy
  }, [installState.busy])

  const setCurrentInputMode = (mode) => {
    inputModeRef.current = mode
    setInputMode(mode)
  }

  // Every time the modal opens, seed the field with the current install path.
  // If an install is ALREADY running (the user pressed Close mid-install and
  // reopens the tile) jump straight to the progress stage so they can watch it
  // or cancel it — not back to the path-entry form.
  useEffect(() => {
    if (isOpen) {
      cancelRequestedRef.current = false
      setLocalError(null)
      setFieldValue(installPath || '')
      setStage(busyRef.current ? 'progress' : 'choice')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, installPath])

  const handleMouseMove = (event) => {
    if (event.movementX !== 0 || event.movementY !== 0) setCurrentInputMode('mouse')
  }

  const handleClose = () => {
    playSound(selectSound)
    onClose?.()
  }

  // Download and Install: persist the typed path and run the full download +
  // extract pipeline.
  const handleInstall = async () => {
    if (installState.busy) return
    const path = normalizeInstallPath(fieldValue)
    if (!path) return
    onPathChange?.(path) // persist it so the card reflects it too
    playSound(selectSound)
    cancelRequestedRef.current = false
    setStage('progress')
    try {
      // Pass the typed path explicitly — the hook's own path may not have
      // re-rendered from the setting yet on the very first install.
      await installState.start(path)
      setStage(cancelRequestedRef.current ? 'choice' : 'done')
    } catch (error) {
      setStage('choice')
      onError?.(String(error?.message || error))
    }
  }

  // Local Game: the user already has the game files. Verify the folder really
  // contains the game (startgame.bat) and mark it installed — no download.
  const handleUseLocalFolder = async () => {
    if (installState.busy) return
    const path = normalizeInstallPath(fieldValue)
    if (!path) return
    onPathChange?.(path)
    playSound(selectSound)
    setLocalError(null)
    try {
      const status = await getGameInstallStatus(path)
      if (status.installed) {
        // Force the parent hook to re-check immediately so the card
        // updates to "LAUNCH GAME" without waiting for the useEffect.
        if (installState.checkStatus) await installState.checkStatus()
        setStage('done')
      } else {
        setLocalError(t('install.localerror'))
      }
    } catch (error) {
      setLocalError(String(error?.message || error))
    }
  }

  const handleCancel = () => {
    playSound(selectSound)
    cancelRequestedRef.current = true
    installState.cancel()
  }

  const handleLaunch = async () => {
    playSound(selectSound)
    try {
      const path = normalizeInstallPath(installPath) || normalizeInstallPath(fieldValue)
      await installState.launch(path)
      onClose?.()
    } catch (error) {
      onError?.(String(error?.message || error))
    }
  }

  // Controller nav: choice → [Local Game, Download and Install, Cancel];
  // setup/local → [path field, primary, Cancel]; progress → [Cancel, Close];
  // done → [Launch, Close].
  const itemCount = stage === 'choice' || stage === 'setup' || stage === 'local' ? 3 : 2
  const focusedIndex = useControllerNavigation({
    itemCount,
    enabled: isOpen,
    onControllerActivity: () => setCurrentInputMode('controller'),
    onMove: () => {
      setCurrentInputMode('controller')
      playSound(hoverSound)
    },
    onConfirm: (index) => {
      setCurrentInputMode('controller')
      if (stage === 'choice') {
        if (index === 0) setStage('local')
        else if (index === 1) setStage('setup')
        else handleClose()
      } else if (stage === 'setup' || stage === 'local') {
        if (index === 0) focusTextInput('[data-install-path-input]', setInputMode)
        else if (index === 1) {
          if (stage === 'local') void handleUseLocalFolder()
          else void handleInstall()
        } else handleClose()
      } else if (stage === 'done') {
        if (index === 0) void handleLaunch()
        else handleClose()
      } else {
        if (index === 0) handleCancel()
        else handleClose()
      }
    },
    onBack: handleClose,
  })

  if (!isOpen) return null

  const modalPrefix = 'jupiter'
  const phaseLabel = installState.phase === 'extract'
    ? t('install.phase.extract')
    : installState.phase === 'finalize'
      ? t('install.phase.finalize')
      : installState.phase === 'auth'
        ? t('install.phase.auth')
        : t('install.phase.download')
  const isFocused = (index) => inputMode === 'controller' && focusedIndex === index

  return createPortal(
    <div className="modal-overlay" onClick={handleClose} onMouseMove={handleMouseMove}>
      <div
        className={`${modalPrefix}-error-modal jupiter-install-modal`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="jupiter-install-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className={`${modalPrefix}-error-accent-bar`} />
        <div className={`${modalPrefix}-error-content jupiter-install-content`}>
          <div className={`${modalPrefix}-error-copy jupiter-install-copy`}>
            <span className={`${modalPrefix}-error-kicker`}>{t('install.kicker')}</span>
            <h2 id="jupiter-install-title">
              {stage === 'progress' ? t('install.installing') : stage === 'done' ? t('install.complete') : t('install.title')}
            </h2>

            {stage === 'choice' && (
              <>
                <p className="jupiter-install-desc">
                  {t('install.choice')}
                </p>
                <div className="jupiter-install-actions">
                  <button
                    type="button"
                    className={`${modalPrefix}-error-acknowledge jupiter-install-btn-primary ${isFocused(0) ? 'controller-focused' : ''}`}
                    onMouseEnter={() => playSound(hoverSound)}
                    onClick={() => {
                      playSound(selectSound)
                      setStage('local')
                    }}
                  >
                    {t('install.localgame')}
                  </button>
                  <button
                    type="button"
                    className={`${modalPrefix}-error-acknowledge ${isFocused(1) ? 'controller-focused' : ''}`}
                    onMouseEnter={() => playSound(hoverSound)}
                    onClick={() => {
                      playSound(selectSound)
                      setStage('setup')
                    }}
                  >
                    {t('install.download')}
                  </button>
                  <button
                    type="button"
                    className={`${modalPrefix}-error-acknowledge ${isFocused(2) ? 'controller-focused' : ''}`}
                    onMouseEnter={() => playSound(hoverSound)}
                    onClick={handleClose}
                  >
                    {t('install.cancel')}
                  </button>
                </div>
              </>
            )}

            {(stage === 'setup' || stage === 'local') && (
              <>
                <p className="jupiter-install-desc">
                  {stage === 'local' ? (
                    <>
                      Point at the folder that already contains the game. It must include{' '}
                      <code>startgame.bat</code> — no download needed.
                    </>
                  ) : (
                    <>
                      Enter the folder to install the Jupiter game into. Use a normal Windows
                      path (for example <code>C:\Games\Warzone III</code>).
                    </>
                  )}
                </p>
                <input
                  type="text"
                  className={`jupiter-install-path-input ${isFocused(0) ? 'controller-focused' : ''}`}
                  data-install-path-input
                  value={fieldValue}
                  onChange={(event) => {
                    setFieldValue(event.target.value)
                    setLocalError(null)
                  }}
                  onMouseEnter={() => playSound(hoverSound)}
                  onFocus={() => setCurrentInputMode('mouse')}
                  placeholder="C:\Games\Warzone III"
                  maxLength={512}
                  spellCheck={false}
                  autoFocus
                />
                {localError && <p className="jupiter-install-local-error">{localError}</p>}
              </>
            )}

            {stage === 'progress' && (
              <>
                <p className="jupiter-install-desc">{phaseLabel}</p>
                <div className="jupiter-install-progress" role="progressbar" aria-valuenow={Math.round(installState.percent)} aria-valuemin="0" aria-valuemax="100">
                  <div className="jupiter-install-progress-fill" style={{ width: `${installState.percent}%` }} />
                </div>
                <div className="jupiter-install-progress-meta">
                  <span>{Math.round(installState.percent)}%</span>
                </div>
              </>
            )}

            {stage === 'done' && (
              <p className="jupiter-install-desc">
                The game is ready to launch from <code>{normalizeInstallPath(installPath) || 'your chosen folder'}</code>.
              </p>
            )}
          </div>

          {(stage === 'setup' || stage === 'local') && (
            <div className="jupiter-install-actions">
              <button
                type="button"
                className={`${modalPrefix}-error-acknowledge jupiter-install-btn-primary ${isFocused(1) ? 'controller-focused' : ''}`}
                onMouseEnter={() => playSound(hoverSound)}
                onClick={() => {
                  if (stage === 'local') void handleUseLocalFolder()
                  else void handleInstall()
                }}
                disabled={!normalizeInstallPath(fieldValue)}
              >
                {stage === 'local' ? t('install.usefolder') : t('install.installBtn')}
              </button>
              <button
                type="button"
                className={`${modalPrefix}-error-acknowledge ${isFocused(2) ? 'controller-focused' : ''}`}
                onMouseEnter={() => playSound(hoverSound)}
                onClick={() => setStage('choice')}
              >
                {t('install.back')}
              </button>
            </div>
          )}            {stage === 'progress' && (
              <>
                <div className="jupiter-install-progress-actions">
                  <button
                    type="button"
                    className={`${modalPrefix}-error-acknowledge jupiter-install-btn-primary jupiter-install-cancel-btn ${isFocused(0) ? 'controller-focused' : ''}`}
                    onMouseEnter={() => playSound(hoverSound)}
                    onClick={handleCancel}
                    disabled={!installState.busy}
                  >
                    {t('install.cancelDownload')}
                  </button>
                  <button
                    type="button"
                    className={`jupiter-install-close-btn ${isFocused(1) ? 'controller-focused' : ''}`}
                    onMouseEnter={() => playSound(hoverSound)}
                    onClick={handleClose}
                  >
                    {t('install.close')}
                  </button>
                </div>
                <p className="jupiter-install-cancel-hint">
                  {t('install.closeHint')}
                </p>
              </>
            )}            {stage === 'done' && (
              <div className="jupiter-install-actions">
                <button
                  type="button"
                  className={`${modalPrefix}-error-acknowledge jupiter-install-btn-primary ${isFocused(0) ? 'controller-focused' : ''}`}
                  onMouseEnter={() => playSound(hoverSound)}
                  onClick={() => void handleLaunch()}
                >
                  {t('install.launch')}
                </button>
                <button
                  type="button"
                  className={`${modalPrefix}-error-acknowledge ${isFocused(1) ? 'controller-focused' : ''}`}
                  onMouseEnter={() => playSound(hoverSound)}
                  onClick={handleClose}
                >
                  {t('install.close')}
                </button>
              </div>
            )}
        </div>
      </div>
    </div>,
    document.getElementById('ui-portal-root') || document.body,
  )
}
