import React, { useState } from 'react'
import { createPortal } from 'react-dom'
import { playSound } from '../utils/audio'
import { useControllerNavigation } from '../utils/controller'
import { useTranslation } from '../utils/i18n'

// Jupiter host-entry prompt (HostMatch): a lightweight multi-variant modal
// that opens when the user clicks Host a Match (Jupiter only).
//
//   prompt === 'ask'          → "Prep PHA Client?"  Yes / No (warzone)
//   prompt === 'prepping'     → prep sequence running (spinner + Cancel)
//   prompt === 'instructions' → PHA Client steps (Local Play → Create
//                               Local Game) with an OK button.
//   prompt === 'localplay'    → zombies: "click Local Play, don't create the
//                               game yet"; Continue switches to zombies mode
//                               before the user publishes.
//
// No LAN session is collected here — the host pastes it in the Host a Match
// form itself.
const instructionsSteps = [
  'hostprompt.step1',
  'hostprompt.step2',
  'hostprompt.step3',
]

export default function JupiterHostPromptModal({ theme = 'jupiter', prompt, gameMode = 'warzone', onYes, onNo, onOk, onCancel, onZombiesContinue }) {
  const { t } = useTranslation()
  const isJupiter = theme === 'jupiter'
  const hoverSound = 'jupHover'
  const selectSound = 'jupSelect'
  const [inputMode, setInputMode] = useState('mouse')
  const isAsk = prompt === 'ask'
  const isPrepping = prompt === 'prepping'
  const isInstructions = prompt === 'instructions'
  const isLocalPlay = prompt === 'localplay' && gameMode === 'zombies'
  const buttonCount = isAsk ? 2 : 1

  const handleHover = () => playSound(hoverSound)
  const handleSelect = (callback) => {
    playSound(selectSound)
    callback?.()
  }

  const handlePrimary = () => {
    if (isAsk) handleSelect(onYes)
    else if (isPrepping) handleSelect(onCancel)
    else if (isLocalPlay) handleSelect(onZombiesContinue)
    else handleSelect(onOk)
  }

  const handleSecondary = () => handleSelect(onNo)

  const focusedIndex = useControllerNavigation({
    itemCount: buttonCount,
    allowedDirections: ['left', 'right'],
    enabled: Boolean(prompt),
    onControllerActivity: () => setInputMode('controller'),
    onMove: () => {
      setInputMode('controller')
      handleHover()
    },
    onConfirm: (index) => {
      if (index === 0) handlePrimary()
      else handleSecondary()
    },
    // Esc / B on the ask prompt safely dismisses to the form (no side
    // effects — the prep is NOT started; No means skip the prep). During
    // prepping it cancels the sequence; on the instructions prompt it acts
    // as OK. On the zombies localplay prompt it dismisses straight to the
    // form (mode switch happens on Continue).
    onBack: isAsk ? onNo : isPrepping ? onCancel : isLocalPlay ? onNo : onOk,
  })

  if (!prompt) return null

  // Portaled to document.body: this modal renders inside the tab-slide
  // container, whose slideInTab animation retains a transform. A retained
  // transform makes it the containing block for `position: fixed`, which
  // would trap the overlay to the main-body area instead of the viewport
  // (a big semi-transparent black box over the Host a Match UI).
  return createPortal(
    <div className="modal-overlay" role="presentation">
      <div
        className={`jupiter-host-prompt-modal `}
        role="dialog"
        aria-modal="true"
        aria-labelledby="jupiter-host-prompt-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="jupiter-join-accent-bar" />
        <div className="jupiter-join-content">
          {!isAsk && (
            <span className="jupiter-join-kicker">
              {isPrepping
                ? t('hostprompt.kicker.prepping')
                : isLocalPlay
                  ? t('hostprompt.kicker.localplay')
                  : t('hostprompt.kicker.instructions')}
            </span>
          )}
          <h2 id="jupiter-host-prompt-title">
            {isAsk
              ? t('hostprompt.title.ask')
              : isPrepping
                ? t('hostprompt.title.prepping')
                : isLocalPlay
                  ? t('hostprompt.title.localplay')
                  : t('hostprompt.title.instructions')}
          </h2>

          {isAsk ? (
            <p className="jupiter-join-intro">
              {t('hostprompt.ask')}
            </p>
          ) : isPrepping ? (
            <div className="jupiter-host-prompt-prepping">
              <div className="jupiter-host-prompt-spinner" aria-hidden="true" />
              <p className="jupiter-join-intro">
                {t('hostprompt.prepping')}
              </p>
            </div>
          ) : isLocalPlay ? (
            <>
              <p className="jupiter-join-intro">
                {t('hostprompt.localplay.zombies')}
              </p>
              <ol className="jupiter-join-steps">
                <li>{t('hostprompt.localplay.step1')}</li>
              </ol>
            </>
          ) : (
            <>
              <p className="jupiter-join-intro">
                {t('hostprompt.instructions')}
              </p>
              <ol className="jupiter-join-steps">
                {instructionsSteps.map((key) => <li key={key}>{t(key)}</li>)}
              </ol>
            </>
          )}

          <div className="jupiter-join-actions">
            {isAsk ? (
              <>
                <button
                  type="button"
                  className={`jupiter-join-button ${inputMode === 'controller' && focusedIndex === 0 ? 'controller-focused' : ''}`}
                  onMouseEnter={handleHover}
                  onClick={handlePrimary}
                >
                  {t('hostprompt.yes')}
                </button>
                <button
                  type="button"
                  className={`jupiter-join-button secondary ${inputMode === 'controller' && focusedIndex === 1 ? 'controller-focused' : ''}`}
                  onMouseEnter={handleHover}
                  onClick={handleSecondary}
                >
                  {t('hostprompt.no')}
                </button>
              </>
            ) : (
              <button
                type="button"
                className={`jupiter-join-button ${inputMode === 'controller' && focusedIndex === 0 ? 'controller-focused' : ''}`}
                onMouseEnter={handleHover}
                onClick={handlePrimary}
              >
                {isPrepping
                  ? t('hostprompt.cancelPrep')
                  : isLocalPlay
                    ? t('hostprompt.localplay.continue')
                    : t('hostprompt.ok')}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.getElementById('ui-portal-root') || document.body,
  )
}
