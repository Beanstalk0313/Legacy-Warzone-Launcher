import React, { useState } from 'react'
import { createPortal } from 'react-dom'
import { playSound } from '../utils/audio'
import { useControllerNavigation } from '../utils/controller'

// Jupiter host-entry prompt (HostMatch): a lightweight three-variant modal that
// opens when the user clicks Host a Match (Jupiter only).
//
//   prompt === 'ask'          → "Prep PHA Client?"  Yes / No
//   prompt === 'prepping'     → prep sequence running (spinner + Cancel)
//   prompt === 'instructions' → PHA Client steps (Local Play → Create
//                               Local Game) with an OK button.
//
// No LAN session is collected here — the host pastes it in the Host a Match
// form itself.
const instructionsSteps = [
  'In the PHA Client, click Local Play.',
  'Click Create Local Game.',
  'Return to the Warzone Legacy Launcher and click OK.',
]

export default function JupiterHostPromptModal({ theme = 'jupiter', prompt, onYes, onNo, onOk, onCancel }) {
  const isJupiter = theme === 'jupiter'
  const hoverSound = isJupiter ? 'jupHover' : 'iw8Hover'
  const selectSound = isJupiter ? 'jupSelect' : 'iw8Select'
  const [inputMode, setInputMode] = useState('mouse')
  const isAsk = prompt === 'ask'
  const isPrepping = prompt === 'prepping'
  const isInstructions = prompt === 'instructions'
  const buttonCount = isAsk ? 2 : 1

  const handleHover = () => playSound(hoverSound)
  const handleSelect = (callback) => {
    playSound(selectSound)
    callback?.()
  }

  const handlePrimary = () => {
    if (isAsk) handleSelect(onYes)
    else if (isPrepping) handleSelect(onCancel)
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
    // as OK.
    onBack: isAsk ? onNo : isPrepping ? onCancel : onOk,
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
        className={`jupiter-host-prompt-modal ${isJupiter ? '' : 'iw8-styled'}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="jupiter-host-prompt-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="jupiter-join-accent-bar" />
        <div className="jupiter-join-content">
          {!isAsk && <span className="jupiter-join-kicker">{isPrepping ? 'PREPARING GAME' : 'PHA CLIENT STEPS'}</span>}
          <h2 id="jupiter-host-prompt-title">
            {isAsk ? 'PREP PHA CLIENT?' : isPrepping ? 'PREPARING THE GAME' : 'SET UP YOUR LOCAL GAME'}
          </h2>

          {isAsk ? (
            <p className="jupiter-join-intro">
              Should the launcher drive the PHA Client menus to prepare your
              local game? If you're already sitting in a local game lobby,
              choose No to skip the prep and configure straight away.
            </p>
          ) : isPrepping ? (
            <div className="jupiter-host-prompt-prepping">
              <div className="jupiter-host-prompt-spinner" aria-hidden="true" />
              <p className="jupiter-join-intro">
                The launcher is driving the local game menus. Keep the game
                visible — this takes a few seconds.
              </p>
            </div>
          ) : (
            <>
              <p className="jupiter-join-intro">
                The launcher has prepared Jupiter. Create the local game in the
                PHA Client, then return here.
              </p>
              <ol className="jupiter-join-steps">
                {instructionsSteps.map((step) => <li key={step}>{step}</li>)}
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
                  Yes
                </button>
                <button
                  type="button"
                  className={`jupiter-join-button secondary ${inputMode === 'controller' && focusedIndex === 1 ? 'controller-focused' : ''}`}
                  onMouseEnter={handleHover}
                  onClick={handleSecondary}
                >
                  No
                </button>
              </>
            ) : (
              <button
                type="button"
                className={`jupiter-join-button ${inputMode === 'controller' && focusedIndex === 0 ? 'controller-focused' : ''}`}
                onMouseEnter={handleHover}
                onClick={handlePrimary}
              >
                {isPrepping ? 'Cancel Prep' : 'OK'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.getElementById('ui-portal-root') || document.body,
  )
}
